// The assistant's brain: Google Gemini on its free tier (no card needed), with
// function calling so it can act on your dashboard. Falls back to the offline
// command parser if no key is set or the free quota is used up.

import { all, run } from './db.js';
import { zonedParts, prettyDate } from './time.js';
import { listTasks, listHabits, scoreFor, spendingSummary } from './data.js';
import { TOOL_DECLARATIONS, runTool } from './tools.js';
import { parseCommand, describeResult, HELP } from './intents.js';

const DEFAULT_MODEL = 'gemini-flash-latest';
const FALLBACK_MODEL = 'gemini-flash-lite-latest';

export function aiConfigured(env) {
  return Boolean(env.GEMINI_API_KEY);
}

async function callGemini(env, body, model = env.GEMINI_MODEL || DEFAULT_MODEL) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  if (res.status === 429 && model !== FALLBACK_MODEL) {
    // Free-tier limits are per model; the lighter model usually still has quota.
    return callGemini(env, body, FALLBACK_MODEL);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${data.error?.message || 'error'}`);
  return data;
}

const textOf = (content) => (content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();

export async function generateText(env, prompt) {
  const data = await callGemini(env, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.8, maxOutputTokens: 1024 },
  });
  return textOf(data.candidates?.[0]?.content);
}

async function systemPrompt(env, settings, now) {
  const today = now.date;
  const [memories, tasks, habits, score, money] = await Promise.all([
    all(env.DB, 'SELECT text FROM memories ORDER BY id DESC LIMIT 60'),
    listTasks(env, { scope: 'today', today, limit: 15 }),
    listHabits(env, today),
    scoreFor(env, today, settings),
    spendingSummary(env, today),
  ]);
  const name = settings.name || 'the user';
  return [
    `You are ${settings.assistantName}, ${name}'s personal assistant living inside their life dashboard. You are ${settings.tone}.`,
    'You talk like a trusted friend who is also extremely organised. Replies are usually spoken aloud, so: 1-4 short sentences, no markdown, no lists with symbols, no emojis, numbers written naturally.',
    'Use your tools to take real actions (tasks, expenses, workouts, habits, focus, check-ins, memory) and to look things up. Never claim you did something without calling the tool. When the user shares a lasting preference or personal fact, save it with `remember` without making a fuss.',
    'If the request is ambiguous, make a sensible assumption and say what you assumed rather than asking many questions.',
    `Right now it is ${now.time} on ${prettyDate(today)} (${today}) in ${settings.city} (${settings.timezone}). The weekend is ${settings.weekendDays.map((d) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]).join(' and ')}. Currency: ${settings.currency}.`,
    `About ${name}: ${settings.about || 'not filled in yet'}.`,
    `Their goals: ${settings.goals || 'not set yet'}.`,
    memories.length ? `Things you know about them: ${memories.map((m) => m.text).join(' | ')}` : '',
    `Snapshot — tasks due today/overdue: ${tasks.length ? tasks.map((t) => `${t.title}${t.due_time ? ` @${t.due_time}` : ''}${t.due_date < today ? ' (overdue)' : ''}`).join('; ') : 'none'}.`,
    `Habits: ${habits.length ? habits.map((h) => `${h.name}${h.doneToday ? ' ✓' : ''}`).join(', ') : 'none set up'}.`,
    `Productivity score so far today: ${score.score}/100 (${score.parts.map((p) => `${p.label} ${p.points}/${p.max}`).join(', ')}).`,
    `Spent today: ${money.today} ${settings.currency}; this month: ${money.month}${settings.monthlyBudget ? ` of ${settings.monthlyBudget} budget` : ''}.`,
  ].filter(Boolean).join('\n');
}

export async function chat(env, settings, message) {
  const now = zonedParts(new Date(), settings.timezone);
  const ctx = { today: now.date, settings };
  const changed = new Set();
  const actions = [];
  await run(env.DB, 'INSERT INTO chat (role, content) VALUES (?, ?)', 'user', String(message).slice(0, 4000));

  let reply = null;
  if (aiConfigured(env)) {
    try {
      reply = await chatWithGemini(env, settings, now, ctx, message, changed, actions);
    } catch (err) {
      console.log('Gemini failed, falling back to offline parser:', err.message);
    }
  }
  if (!reply) reply = await offlineReply(env, ctx, message, changed, actions);

  await run(env.DB, 'INSERT INTO chat (role, content) VALUES (?, ?)', 'assistant', reply);
  // Keep the history table small.
  await run(env.DB, 'DELETE FROM chat WHERE id NOT IN (SELECT id FROM chat ORDER BY id DESC LIMIT 200)');
  return { reply, changed: [...changed], actions, ai: aiConfigured(env) };
}

async function chatWithGemini(env, settings, now, ctx, message, changed, actions) {
  const history = (await all(env.DB, 'SELECT role, content FROM chat ORDER BY id DESC LIMIT 17')).reverse();
  // The last row is the message we just stored.
  const contents = history.map((h) => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content }] }));
  if (!contents.length || contents[contents.length - 1].role !== 'user') contents.push({ role: 'user', parts: [{ text: message }] });

  const body = {
    systemInstruction: { parts: [{ text: await systemPrompt(env, settings, now) }] },
    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
    contents,
  };

  for (let step = 0; step < 6; step++) {
    const data = await callGemini(env, body);
    const content = data.candidates?.[0]?.content;
    if (!content) throw new Error(`Empty response (${data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason || 'unknown'})`);
    const calls = (content.parts || []).filter((p) => p.functionCall);
    if (!calls.length) return textOf(content) || 'Done.';

    // Send the model's turn back verbatim (it may carry thought signatures).
    body.contents.push(content);
    const responses = [];
    for (const { functionCall } of calls) {
      let out;
      try {
        out = await runTool(env, functionCall.name, functionCall.args || {}, ctx);
      } catch (err) {
        out = { result: { ok: false, error: err.message } };
      }
      (out.changed || []).forEach((c) => changed.add(c));
      actions.push({ tool: functionCall.name, args: functionCall.args, ok: out.result?.ok !== false });
      responses.push({ functionResponse: { name: functionCall.name, response: out.result } });
    }
    body.contents.push({ role: 'user', parts: responses });
  }
  return 'I got a bit tangled up there. Could you say that again?';
}

async function offlineReply(env, ctx, message, changed, actions) {
  const cmd = parseCommand(message, ctx.today);
  if (!cmd) {
    if (/^(hi|hello|hey|yo|salam|good (morning|evening|afternoon))\b/i.test(message.trim())) {
      return `Hey${ctx.settings.name ? ` ${ctx.settings.name}` : ''}! ${HELP}`;
    }
    return `I didn't catch a command there. ${HELP}`;
  }
  try {
    const out = await runTool(env, cmd.tool, cmd.args, ctx);
    (out.changed || []).forEach((c) => changed.add(c));
    actions.push({ tool: cmd.tool, args: cmd.args, ok: out.result?.ok !== false });
    return describeResult(cmd.tool, out.result);
  } catch (err) {
    return `Sorry, that didn't work: ${err.message}`;
  }
}

export async function chatHistory(env) {
  return (await all(env.DB, 'SELECT role, content, created_at FROM chat ORDER BY id DESC LIMIT 40')).reverse();
}

export async function clearChat(env) {
  await run(env.DB, 'DELETE FROM chat');
}
