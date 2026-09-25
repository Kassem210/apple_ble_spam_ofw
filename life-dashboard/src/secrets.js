// Secrets the app can make for itself: the session-signing key and the push
// notification (VAPID) key pair. They're generated on first run and kept in the
// private database, so the only secret you have to set by hand is APP_PASSWORD.
// Values set as real Cloudflare secrets always win.

import { getKV } from './db.js';
import { b64url } from './auth.js';

let cached = null;

async function generate() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('raw', kp.publicKey);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return {
    SESSION_SECRET: b64url(crypto.getRandomValues(new Uint8Array(32))),
    VAPID_PUBLIC_KEY: b64url(pub),
    VAPID_PRIVATE_KEY: jwk.d,
  };
}

export async function withSecrets(env) {
  if (env.SESSION_SECRET && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return env;
  if (!cached) {
    cached = await getKV(env.DB, 'auto_secrets', null);
    if (!cached) {
      cached = await generate();
      // Only the first writer wins, so two cold starts can't end up with different keys.
      await env.DB.prepare('INSERT OR IGNORE INTO kv (key, value) VALUES (?, ?)').bind('auto_secrets', JSON.stringify(cached)).run();
      cached = await getKV(env.DB, 'auto_secrets', cached);
    }
  }
  const out = Object.create(env);
  out.SESSION_SECRET = env.SESSION_SECRET || cached.SESSION_SECRET;
  // The VAPID keys only work as a pair.
  const ownPair = env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY;
  out.VAPID_PUBLIC_KEY = ownPair ? env.VAPID_PUBLIC_KEY : cached.VAPID_PUBLIC_KEY;
  out.VAPID_PRIVATE_KEY = ownPair ? env.VAPID_PRIVATE_KEY : cached.VAPID_PRIVATE_KEY;
  return out;
}
