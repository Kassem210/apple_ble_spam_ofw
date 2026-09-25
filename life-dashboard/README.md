# Life — personal dashboard & voice assistant

A private web app you install on your phone's home screen:

- **Daily briefing at 07:30 (Cairo time)**, sent as a push notification and read aloud. It covers weather, calendar, important email, tasks, habits, sleep and steps, spending, news, yesterday's score and a quote. If you add an AI key, the assistant writes the briefing personally for you.
- **Tasks and reminders** with natural language ("call mum tomorrow 6pm"), priorities, `#tags`, and repeats. Weekday repeats skip Friday and Saturday. You get a push reminder before each task, with **Done** and **Snooze** buttons.
- **Voice assistant** ("Nova"; you can rename it). Tap the mic or say **"Hey Nova"** while the app is open. It holds a real conversation, follows up, and can add tasks, log spending, workouts, habits and focus time, check you in, and remember things about you.
- **Daily productivity score (0–100)** built from tasks, activity, habits, sleep, focus and an evening check-in. Anything you don't track is left out of the score.
- **Health**: Fitbit Air data (steps, sleep, resting heart rate, workouts) through the Google Health API, plus manual workout logging.
- **Spending**: quick logging by voice or tap, a monthly budget, categories and a 30-day chart.
- **Habits, a focus timer, prayer times (optional), light and dark themes, and an iPhone home-screen widget.**
- **Password-locked**, just for you. **Costs nothing**: Cloudflare Workers, D1 and cron jobs are all on the free plan, and Gemini's free tier needs no card.

---

## 1. Deploy (about 10 minutes, one time)

You need a computer with [Node.js 20+](https://nodejs.org) installed.

```bash
git clone <this repo> && cd <repo>/life-dashboard
npm install
npm run setup
```

The setup script:
1. Opens a browser so you can log in to Cloudflare, or create a free account.
2. Creates your free database.
3. Deploys the app and prints your link, e.g. `https://life-dashboard.<you>.workers.dev`.
4. Asks for your password and, optionally, your API keys. It also generates the push-notification keys.

## 2. Install it on your phone

1. Open your link on your phone and log in.
2. Fill in **"Let's make this yours"**. The more you write about yourself and your goals, the more personal the assistant gets.
3. Add it to your home screen:
   - **iPhone (Safari):** Share → **Add to Home Screen**.
   - **Android (Chrome):** ⋮ → **Install app**.
4. Open it **from the home screen** and tap **Turn on notifications**. iPhones only allow notifications for apps installed this way.
5. In Settings → Notifications, tap **Send a test** to confirm it works.

Long-press the app icon for shortcuts: talk to the assistant, open the briefing, add a task, or log spending.

## 3. Free AI brain (recommended)

Without a key, the assistant still understands common commands, for example "remind me to…", "done…", "I spent 50 on coffee", "I ran 5 km", "what's my score" and "brief me". With a free Gemini key it becomes a real conversational assistant.

1. Go to https://aistudio.google.com/apikey → **Create API key**. No card is needed.
2. Run `npx wrangler secret put GEMINI_API_KEY` and paste the key.

The free tier covers normal personal use. When a model's daily quota runs out, the app switches to a lighter Gemini model, then to the offline command parser.

## 4. Connect Google: Calendar, Gmail and Fitbit Air (free, about 5 minutes)

One Google Cloud "OAuth client" covers all three services.

1. Go to https://console.cloud.google.com and create a project, e.g. "Life".
2. **APIs & Services → Library** and enable:
   - **Google Calendar API**
   - **Gmail API**
   - **Google Health API**, which carries your Fitbit Air and Google Health app data.
3. **OAuth consent screen** (Google Auth Platform):
   - User type **External**, app name "Life", and your email.
   - Under **Audience**, add your own Gmail as a **test user**, then click **Publish app**. Google shows an "unverified app" warning when you connect. That's fine for a personal app; tap *Advanced → Go to Life*. Publishing matters: apps left in "Testing" mode lose access every 7 days.
4. **Credentials → Create credentials → OAuth client ID**:
   - Type **Web application**.
   - Authorized redirect URI: `https://<your-app>.workers.dev/api/oauth/google/callback`
5. Save the two values as secrets:
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```
6. In the app, go to **Settings → Connections**:
   - Tap **Connect** next to *Google Calendar & Gmail*.
   - Tap **Connect** next to *Google Health · Fitbit Air*.

Health data syncs every hour. You can also tap **Sync** on the Health tab.

> The old Fitbit Web API shuts down after 30 September 2026. This app already uses its replacement, the **Google Health API**.

## 5. iPhone home-screen widget

1. Install **Scriptable** (free) from the App Store.
2. In the app, go to **Settings → Home-screen widget**, tap **iPhone widget script**, and copy all of it.
3. In Scriptable, tap **+**, paste the script and name it `Life`.
4. Add a **Scriptable** widget (small or medium) to your home screen, then long-press it → **Edit Widget**:
   - Script: **Life**
   - Parameter: paste your **widget link** from Settings.

The widget shows your score ring, your next task, weather, steps, habits and today's spending. It refreshes about every 15 minutes.

## Everyday use

| Say or type | What happens |
|---|---|
| "Hey Nova, remind me to call the bank tomorrow at 10am" | Adds the task and pushes a reminder 10 minutes before |
| "I spent 240 on lunch" | Logs 240 EGP under food |
| "I did gym for an hour" / "I ran 5 km" | Logs the workout |
| "Mark the report done" | Completes the task; a repeating task gets its next one |
| "What should I focus on today?" | Answers using your tasks, calendar, goals and energy |
| "Remember I prefer workouts after 7pm" | Saved and used from then on |
| "Brief me" | Reads today's briefing aloud |

Quick-add also accepts `!` for high priority, `#tag` for a category, and `daily`, `weekdays`, `weekly` or `monthly` for repeats.

## Customising

Everything lives under **Settings** in the app:
- your profile, goals and the assistant's name, personality, voice and language (including Arabic)
- briefing and check-in times, reminder lead time, time zone and weekend days
- step, sleep and focus goals, currency and budget
- which briefing sections appear, news feeds and prayer times

**Export all my data** downloads everything as JSON.

To change your password, run `npx wrangler secret put APP_PASSWORD`. Every device gets logged out.

## Development

```bash
cp .dev.vars.example .dev.vars   # then fill in; `npm run keys` prints fresh keys
npm run dev                      # http://localhost:8787
npm test
curl -X POST localhost:8787/api/cron/run -b <cookie>   # run the scheduled job now
```

Code map: `src/worker.js` (API), `src/cron.js` (the 5-minute scheduler), `src/briefing.js`, `src/ai.js` + `src/tools.js` (assistant), `src/intents.js` (offline commands), `src/score.js`, `src/google.js`, `src/push.js` (Web Push), and `public/` (the app).
