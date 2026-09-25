import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import ece from 'http_ece';
import { encryptPayload, vapidJWT } from '../src/push.js';
import { b64url, fromB64url } from '../src/auth.js';

test('aes128gcm payload decrypts with an independent implementation', async () => {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const keys = { p256dh: b64url(ua.getPublicKey()), auth: b64url(auth) };
  const message = JSON.stringify({ title: 'Good morning ☀️', body: 'Your briefing is ready' });
  const body = await encryptPayload(keys, message);
  const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, authSecret: auth });
  assert.equal(plain.toString('utf8'), message);
});

test('VAPID JWT verifies against the public key', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pubJwk = publicKey.export({ format: 'jwk' });
  const privJwk = privateKey.export({ format: 'jwk' });
  const rawPub = Buffer.concat([Buffer.from([4]), fromB64url(pubJwk.x), fromB64url(pubJwk.y)]);
  const env = { VAPID_PUBLIC_KEY: b64url(rawPub), VAPID_PRIVATE_KEY: privJwk.d, VAPID_SUBJECT: 'mailto:a@b.c' };
  const jwt = await vapidJWT(env, 'https://fcm.googleapis.com/fcm/send/abc');
  const [h, c, s] = jwt.split('.');
  const ok = crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, fromB64url(s));
  assert.ok(ok);
  const claims = JSON.parse(Buffer.from(fromB64url(c)).toString());
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'mailto:a@b.c');
});
