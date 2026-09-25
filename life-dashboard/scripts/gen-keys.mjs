// Prints fresh secrets: VAPID key pair for push notifications + a session secret.
import { webcrypto as crypto } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export async function generateSecrets() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('raw', kp.publicKey);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return {
    VAPID_PUBLIC_KEY: b64url(pub),
    VAPID_PRIVATE_KEY: jwk.d,
    SESSION_SECRET: b64url(crypto.getRandomValues(new Uint8Array(32))),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await generateSecrets();
  for (const [k, v] of Object.entries(s)) console.log(`${k}=${v}`);
}
