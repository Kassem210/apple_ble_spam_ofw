// One-command setup: Cloudflare login -> database -> deploy -> secrets.
// Run from the life-dashboard folder:  npm run setup
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { generateSecrets } from './gen-keys.mjs';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, def = '') => (await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim() || def;
const say = (s) => console.log(`\n\x1b[35m▸\x1b[0m ${s}`);

function wrangler(args, { capture = false } = {}) {
  const r = spawnSync('npx', ['wrangler', ...args], { stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8', shell: process.platform === 'win32' });
  if (capture) return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` };
  return { ok: r.status === 0 };
}

console.log('\n\x1b[1mLife Dashboard setup\x1b[0m — everything here is on Cloudflare\'s free plan.\n');

say('Checking your Cloudflare login…');
if (!wrangler(['whoami'], { capture: true }).out.match(/associated with the email|You are logged in/i)) {
  console.log('A browser window will open — log in (or create a free account) and approve.');
  if (!wrangler(['login']).ok) { console.error('Login failed.'); process.exit(1); }
}

say('Deploying the app (the database is created automatically)…');
const dep = wrangler(['deploy'], { capture: true });
console.log(dep.out.split('\n').filter((l) => /https:\/\/|Uploaded|Deployed|error/i.test(l)).join('\n'));
if (!dep.ok) { console.error(dep.out); process.exit(1); }
const url = dep.out.match(/https:\/\/[\w.-]+\.workers\.dev/)?.[0];

say('Now your secrets (stored encrypted on Cloudflare, never in the code).');
const password = await ask('Choose the password that unlocks your dashboard');
if (password.length < 6) { console.error('Use at least 6 characters.'); process.exit(1); }
const email = await ask('Your email (only used as the contact for push notifications)', 'mailto:me@example.com');
console.log('\nOptional — press Enter to skip any of these, you can add them later with `npx wrangler secret put NAME`.');
console.log('  Free AI key: https://aistudio.google.com/apikey  (Create API key, no card needed)');
const gemini = await ask('GEMINI_API_KEY');
console.log('  Google Calendar/Gmail/Health: see README → "Connect Google" for the 5-minute client setup.');
const gid = await ask('GOOGLE_CLIENT_ID');
const gsecret = gid ? await ask('GOOGLE_CLIENT_SECRET') : '';

const secrets = {
  ...(await generateSecrets()),
  APP_PASSWORD: password,
  VAPID_SUBJECT: email.startsWith('mailto:') || email.startsWith('https:') ? email : `mailto:${email}`,
};
if (gemini) secrets.GEMINI_API_KEY = gemini;
if (gid) { secrets.GOOGLE_CLIENT_ID = gid; secrets.GOOGLE_CLIENT_SECRET = gsecret; }

const file = '.secrets.tmp.json';
writeFileSync(file, JSON.stringify(secrets));
const sec = wrangler(['secret', 'bulk', file]);
unlinkSync(file);
if (!sec.ok) { console.error('Setting secrets failed.'); process.exit(1); }
rl.close();

console.log(`\n\x1b[32m✓ All set!\x1b[0m\n\nOpen: \x1b[1m${url || '(see the URL above)'}\x1b[0m`);
console.log(`
Next:
  1. Open it on your phone → log in → fill in "Let's make this yours".
  2. iPhone: Share → Add to Home Screen.  Android: ⋮ → Install app / Add to Home screen.
  3. Open it from the home screen and tap "Turn on notifications".
  4. Google Cloud redirect URI to register: ${url || 'https://<your-app>.workers.dev'}/api/oauth/google/callback
`);
