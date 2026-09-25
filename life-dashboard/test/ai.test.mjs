import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './fake-d1.mjs';
import { ensureSchema, all } from '../src/db.js';
import { chat } from '../src/ai.js';
import { getSettings } from '../src/settings.js';

test('Groq: tool call is executed, model falls back after 404, reply returned', async () => {
  const env = { DB: fakeD1(), GROQ_API_KEY: 'test' };
  await ensureSchema(env.DB);
  const settings = await getSettings(env);
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(init.headers.Authorization, 'Bearer test');
    if (body.model === 'openai/gpt-oss-120b') {
      return new Response(JSON.stringify({ error: { message: 'model decommissioned' } }), { status: 404 });
    }
    const hasToolResult = body.messages.some((m) => m.role === 'tool');
    const message = hasToolResult
      ? { role: 'assistant', content: 'Done, I added "Call the bank" for tomorrow at 10.' }
      : { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'add_task', arguments: '{"title":"Call the bank","due_date":"2030-01-02","due_time":"10:00","priority":"high"}' } }] };
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
  };
  try {
    const r = await chat(env, settings, 'remind me to call the bank tomorrow at 10, it is important');
    assert.match(r.reply, /Call the bank/);
    assert.deepEqual(r.changed, ['tasks']);
    assert.equal(r.actions[0].tool, 'add_task');
    const tasks = await all(env.DB, 'SELECT title, due_date, due_time, priority FROM tasks');
    assert.deepEqual(tasks.map((t) => ({ ...t })), [{ title: 'Call the bank', due_date: '2030-01-02', due_time: '10:00', priority: 3 }]);
    // Tools are sent in OpenAI/JSON-schema form with lowercase types.
    assert.equal(calls[1].tools.find((t) => t.function.name === 'add_task').function.parameters.type, 'object');
    assert.equal(calls[1].model, 'openai/gpt-oss-20b');
    // The tool result is passed back with its call id.
    assert.equal(calls[2].messages.find((m) => m.role === 'tool').tool_call_id, 'c1');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('No AI key: offline parser still acts', async () => {
  const env = { DB: fakeD1() };
  await ensureSchema(env.DB);
  const r = await chat(env, await getSettings(env), 'I spent 50 on coffee');
  assert.match(r.reply, /Logged 50/);
  assert.equal((await all(env.DB, 'SELECT * FROM expenses')).length, 1);
});
