import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, parseWhen, parseQuickTask, categorize } from '../src/intents.js';
import { computeScore } from '../src/score.js';
import { zonedParts, localToUtcISO, addDays } from '../src/time.js';
import { nextOccurrence } from '../src/data.js';
import { parseRss } from '../src/briefing.js';

const TODAY = '2026-09-25'; // a Friday

test('parseWhen understands relative days and times', () => {
  assert.deepEqual(parseWhen('call mum tomorrow at 6pm', TODAY), { date: '2026-09-26', time: '18:00', rest: 'call mum' });
  assert.deepEqual(parseWhen('gym tonight', TODAY), { date: TODAY, time: '20:00', rest: 'gym' });
  assert.equal(parseWhen('meeting on sunday 10:30am', TODAY).date, '2026-09-27');
  assert.equal(parseWhen('meeting on sunday 10:30am', TODAY).time, '10:30');
  assert.equal(parseWhen('report friday', TODAY).date, '2026-10-02'); // same weekday means next week
  assert.equal(parseWhen('pay rent at 12am', TODAY).time, '00:00');
  assert.equal(parseWhen('buy milk', TODAY).date, null);
});

test('parseCommand: tasks', () => {
  assert.deepEqual(parseCommand('Remind me to call the dentist tomorrow at 9am', TODAY),
    { tool: 'add_task', args: { title: 'Call the dentist', due_date: '2026-09-26', due_time: '09:00', priority: undefined } });
  const urgent = parseCommand('hey nova add a task submit report today, urgent', TODAY);
  assert.equal(urgent.tool, 'add_task');
  assert.equal(urgent.args.title, 'Submit report');
  assert.equal(urgent.args.priority, 'high');
  assert.deepEqual(parseCommand('mark call the dentist as done', TODAY), { tool: 'complete_task', args: { query: 'call the dentist' } });
  assert.deepEqual(parseCommand('done buy milk', TODAY), { tool: 'complete_task', args: { query: 'buy milk' } });
  assert.deepEqual(parseCommand("I'm done with the laundry", TODAY), { tool: 'complete_task', args: { query: 'laundry' } });
  assert.deepEqual(parseCommand('finished the report', TODAY), { tool: 'complete_task', args: { query: 'report' } });
});

test('parseCommand: money, workouts, memory, queries', () => {
  assert.deepEqual(parseCommand('I spent 120 on lunch', TODAY).args, { amount: 120, category: 'food', note: 'lunch', date: undefined });
  assert.equal(parseCommand('paid 45.5 egp for uber', TODAY).args.category, 'transport');
  assert.deepEqual(parseCommand('I ran 5 km', TODAY), { tool: 'log_workout', args: { type: 'Running', duration_min: 30, distance_km: 5 } });
  assert.deepEqual(parseCommand('gym for 1.5 hours', TODAY).args, { type: 'Gym', duration_min: 90 });
  assert.equal(parseCommand('remember that I hate early meetings', TODAY).args.fact, 'I hate early meetings');
  assert.equal(parseCommand("what's my score", TODAY).tool, 'get_score');
  assert.equal(parseCommand('brief me', TODAY).tool, 'get_briefing');
  assert.equal(parseCommand('how much did I spend this week', TODAY).tool, 'spending_summary');
  assert.equal(parseCommand('what tasks do I have', TODAY).tool, 'list_tasks');
  assert.equal(parseCommand('tell me a joke', TODAY), null);
  assert.equal(categorize('starbucks latte'), 'coffee');
});

test('parseQuickTask handles priority, tags and repeats', () => {
  assert.deepEqual(parseQuickTask('Call mum tomorrow 6pm', TODAY),
    { title: 'Call mum', due_date: '2026-09-26', due_time: '18:00', priority: 2, category: '', recurrence: 'none' });
  const t = parseQuickTask('! pay electricity #bills monthly', TODAY);
  assert.equal(t.priority, 3);
  assert.equal(t.category, 'bills');
  assert.equal(t.recurrence, 'monthly');
  assert.equal(t.due_date, TODAY);
  assert.equal(t.title, 'Pay electricity');
});

test('recurring tasks skip the Egyptian weekend', () => {
  assert.equal(nextOccurrence('2026-09-24', 'weekdays', [5, 6]), '2026-09-27'); // Thu -> Sun
  assert.equal(nextOccurrence('2026-09-25', 'daily'), '2026-09-26');
  assert.equal(nextOccurrence('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(nextOccurrence('2026-12-15', 'monthly'), '2027-01-15');
  assert.equal(nextOccurrence('2026-09-25', 'weekly'), '2026-10-02');
});

test('Cairo time zone incl. daylight saving', () => {
  // Egypt observes DST (UTC+3) in summer and UTC+2 in winter.
  assert.equal(zonedParts(new Date('2026-07-01T04:30:00Z'), 'Africa/Cairo').time, '07:30');
  assert.equal(zonedParts(new Date('2026-12-01T05:30:00Z'), 'Africa/Cairo').time, '07:30');
  assert.equal(localToUtcISO('2026-07-01', '07:30', 'Africa/Cairo'), '2026-07-01T04:30:00.000Z');
  assert.equal(localToUtcISO('2026-12-01', '00:00', 'Africa/Cairo'), '2026-11-30T22:00:00.000Z');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

const SETTINGS = { stepGoal: 8000, sleepGoalMin: 450, focusGoalMin: 120 };

test('score: perfect day is 100', () => {
  const s = computeScore({
    plannedWeight: 6, doneWeight: 6, plannedCount: 3, doneCount: 3, habitsTotal: 2, habitsDone: 2,
    steps: 9000, sleepMin: 480, workouts: 1, focusMin: 150, checkedIn: true,
  }, SETTINGS);
  assert.equal(s.score, 100);
  assert.equal(s.parts.reduce((n, p) => n + p.max, 0), 100);
});

test('score: untracked parts are dropped and the rest rescaled', () => {
  const s = computeScore({ plannedWeight: 0, doneWeight: 0, habitsTotal: 0, steps: null, sleepMin: null, workouts: 0, focusMin: 0, checkedIn: false }, SETTINGS);
  assert.deepEqual(s.parts.map((p) => p.key), ['tasks', 'activity', 'focus', 'checkin']);
  assert.equal(s.parts.find((p) => p.key === 'tasks').points, 27); // 0.5 of 40/75*100
  assert.equal(s.score, 27);
});

test('score: priority weighting', () => {
  const high = computeScore({ plannedWeight: 4, doneWeight: 3, plannedCount: 2, doneCount: 1 }, SETTINGS);
  const low = computeScore({ plannedWeight: 4, doneWeight: 1, plannedCount: 2, doneCount: 1 }, SETTINGS);
  assert.ok(high.score > low.score);
});

test('RSS parsing handles CDATA and entities', () => {
  const xml = '<rss><channel><title>BBC News</title><item><title><![CDATA[Egypt & Sudan talk]]></title><link>https://bbc.co.uk/1</link></item><item><title>Tech &amp; AI</title><link>https://bbc.co.uk/2</link></item></channel></rss>';
  assert.deepEqual(parseRss(xml), { source: 'BBC News', items: [{ title: 'Egypt & Sudan talk', link: 'https://bbc.co.uk/1' }, { title: 'Tech & AI', link: 'https://bbc.co.uk/2' }] });
});
