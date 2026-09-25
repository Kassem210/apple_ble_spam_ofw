// Single-user password lock. A successful login sets a signed, HttpOnly cookie
// that lasts a year so the home-screen app stays unlocked on your phone.

import { getKV, setKV } from './db.js';

const enc = new TextEncoder();
const COOKIE = 'life_session';
const SESSION_DAYS = 365;
const MAX_FAILS = 8;
const LOCK_MINUTES = 15;

export function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function sign(env, data) {
  return hmac(env.SESSION_SECRET, data);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function digest(str) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(str)));
}

export async function checkPassword(env, password) {
  if (!env.APP_PASSWORD) return false;
  // Compare hashes so the comparison time does not depend on the password length.
  return safeEqual(await digest(String(password || '')), await digest(env.APP_PASSWORD));
}

export async function makeSessionCookie(env) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const payload = `v1.${exp}`;
  const token = `${payload}.${await sessionSig(env, payload)}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function isAuthed(request, env) {
  const cookies = request.headers.get('Cookie') || '';
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return false;
  const parts = match[1].split('.');
  if (parts.length !== 3) return false;
  const [v, exp, sig] = parts;
  if (v !== 'v1' || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await sessionSig(env, `${v}.${exp}`));
}

// The password hash is part of the signature, so changing APP_PASSWORD logs out every device.
async function sessionSig(env, payload) {
  return sign(env, `session:${payload}:${await digest(env.APP_PASSWORD || '')}`);
}

// Brute-force protection: after MAX_FAILS wrong passwords, lock logins for a while.
export async function loginAllowed(env) {
  const state = await getKV(env.DB, 'login_fails', { count: 0, until: 0 });
  return !(state.until && state.until > Date.now());
}

export async function recordLogin(env, ok) {
  if (ok) return setKV(env.DB, 'login_fails', { count: 0, until: 0 });
  const state = await getKV(env.DB, 'login_fails', { count: 0, until: 0 });
  const count = (state.count || 0) + 1;
  const until = count >= MAX_FAILS ? Date.now() + LOCK_MINUTES * 60000 : 0;
  return setKV(env.DB, 'login_fails', { count: until ? 0 : count, until });
}

// Read-only token for the home-screen widget (it cannot send cookies).
export async function widgetToken(env) {
  return (await sign(env, 'widget-v1')).slice(0, 32);
}
