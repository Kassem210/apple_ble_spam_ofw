// Daily productivity score (0-100).
//
//   Tasks     40  priority-weighted share of what was due that you finished
//   Activity  20  steps vs goal (60%) + a logged workout (40%)
//   Habits    15  share of your habits done today
//   Sleep     10  last night's sleep vs goal
//   Focus     10  focus-timer minutes vs goal
//   Check-in   5  did the evening check-in
//
// Parts with no data at all (no habits set up, no sleep tracked) are dropped and
// the rest are scaled up, so you're never punished for something you don't track.

export const WEIGHTS = { tasks: 40, activity: 20, habits: 15, sleep: 10, focus: 10, checkin: 5 };

const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function computeScore(input, settings) {
  const parts = [];

  // Tasks
  const planned = input.plannedWeight || 0;
  const done = input.doneWeight || 0;
  let taskRatio;
  let taskDetail;
  if (planned === 0 && done === 0) {
    taskRatio = 0.5;
    taskDetail = 'Nothing was planned';
  } else {
    taskRatio = clamp01(done / Math.max(planned, done));
    taskDetail = `${input.doneCount || 0} of ${input.plannedCount || 0} done`;
  }
  parts.push({ key: 'tasks', label: 'Tasks', ratio: taskRatio, detail: taskDetail });

  // Activity
  const hasWorkout = (input.workouts || 0) > 0;
  let activityRatio;
  let activityDetail;
  if (input.steps != null) {
    activityRatio = clamp01(input.steps / (settings.stepGoal || 8000)) * 0.6 + (hasWorkout ? 0.4 : 0);
    activityDetail = `${Number(input.steps).toLocaleString('en-US')} steps${hasWorkout ? ' + workout' : ''}`;
  } else {
    activityRatio = hasWorkout ? 1 : 0;
    activityDetail = hasWorkout ? 'Workout logged' : 'No workout yet';
  }
  parts.push({ key: 'activity', label: 'Activity', ratio: activityRatio, detail: activityDetail });

  // Habits
  if ((input.habitsTotal || 0) > 0) {
    parts.push({
      key: 'habits', label: 'Habits',
      ratio: clamp01((input.habitsDone || 0) / input.habitsTotal),
      detail: `${input.habitsDone || 0} of ${input.habitsTotal}`,
    });
  }

  // Sleep
  if (input.sleepMin != null) {
    const goal = settings.sleepGoalMin || 450;
    parts.push({
      key: 'sleep', label: 'Sleep', ratio: clamp01(input.sleepMin / goal),
      detail: `${Math.floor(input.sleepMin / 60)}h ${Math.round(input.sleepMin % 60)}m`,
    });
  }

  // Focus
  parts.push({
    key: 'focus', label: 'Focus',
    ratio: clamp01((input.focusMin || 0) / (settings.focusGoalMin || 120)),
    detail: `${input.focusMin || 0} min`,
  });

  // Check-in
  parts.push({ key: 'checkin', label: 'Check-in', ratio: input.checkedIn ? 1 : 0, detail: input.checkedIn ? 'Done' : 'Not yet' });

  const maxTotal = parts.reduce((n, p) => n + WEIGHTS[p.key], 0);
  const scale = 100 / maxTotal;
  let total = 0;
  for (const p of parts) {
    p.max = Math.round(WEIGHTS[p.key] * scale);
    p.points = Math.round(WEIGHTS[p.key] * scale * p.ratio);
    total += WEIGHTS[p.key] * scale * p.ratio;
    delete p.ratio;
  }
  const score = Math.round(total);
  return { score, label: scoreLabel(score), parts };
}

export function scoreLabel(score) {
  if (score >= 85) return 'Outstanding';
  if (score >= 70) return 'Strong day';
  if (score >= 50) return 'Solid';
  if (score >= 30) return 'Warming up';
  return 'Fresh start';
}
