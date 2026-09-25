// Life — home-screen widget for iPhone (free "Scriptable" app).
//
// Easiest: in Life → Settings → Home-screen widget tap "Copy iPhone widget script"
// (your private link is already filled in), then:
// 1. Install Scriptable from the App Store.
// 2. In Scriptable tap +, paste, and name the script "Life".
// 3. Long-press your home screen → + → Scriptable → pick Small or Medium → Add.
// 4. Long-press the widget → Edit Widget → Script: Life.

const WIDGET_URL = args.widgetParameter || 'PASTE_YOUR_WIDGET_LINK_HERE';

const C = {
  bgTop: new Color('#6c5ce7'), bgBottom: new Color('#1f1a4d'),
  text: Color.white(), dim: new Color('#ffffff', 0.7), faint: new Color('#ffffff', 0.45), teal: new Color('#6ff0da'),
};

async function load() {
  try {
    const req = new Request(WIDGET_URL);
    req.timeoutInterval = 10;
    return await req.loadJSON();
  } catch (e) {
    return { error: String(e) };
  }
}

function ring(score, size) {
  const ctx = new DrawContext();
  ctx.size = new Size(size, size);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const lw = size * 0.11;
  const r = (size - lw) / 2;
  const c = size / 2;
  const arc = (from, to, color) => {
    const p = new Path();
    const steps = 90;
    for (let i = 0; i <= steps; i++) {
      const a = -Math.PI / 2 + (from + (to - from) * (i / steps)) * 2 * Math.PI;
      const pt = new Point(c + r * Math.cos(a), c + r * Math.sin(a));
      i ? p.addLine(pt) : p.move(pt);
    }
    ctx.addPath(p);
    ctx.setStrokeColor(color);
    ctx.setLineWidth(lw);
    ctx.strokePath();
  };
  arc(0, 1, new Color('#ffffff', 0.18));
  if (score > 0) arc(0, Math.min(1, score / 100), C.teal);
  ctx.setFont(Font.boldRoundedSystemFont(size * 0.3));
  ctx.setTextColor(C.text);
  ctx.setTextAlignedCenter();
  ctx.drawTextInRect(String(score), new Rect(0, c - size * 0.19, size, size * 0.4));
  return ctx.getImage();
}

function text(stack, str, font, color = C.text, lines = 1) {
  const t = stack.addText(str);
  t.font = font;
  t.textColor = color;
  t.lineLimit = lines;
  t.minimumScaleFactor = 0.7;
  return t;
}

const d = await load();
const w = new ListWidget();
const g = new LinearGradient();
g.colors = [C.bgTop, C.bgBottom];
g.locations = [0, 1];
w.backgroundGradient = g;
w.setPadding(14, 14, 14, 14);
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
if (!d.error) w.url = WIDGET_URL.split('/api/')[0];

const family = config.widgetFamily || 'medium';

if (d.error || WIDGET_URL.includes('PASTE_')) {
  text(w, 'Life', Font.boldSystemFont(16));
  w.addSpacer(4);
  text(w, WIDGET_URL.includes('PASTE_') ? 'Add your widget link as the widget parameter.' : 'Can\'t reach your dashboard.', Font.systemFont(12), C.dim, 3);
} else if (family === 'small') {
  const top = w.addStack();
  top.centerAlignContent();
  top.addImage(ring(d.score, 58)).imageSize = new Size(52, 52);
  top.addSpacer();
  if (d.weather) {
    const wx = top.addStack();
    wx.layoutVertically();
    text(wx, d.weather.icon, Font.systemFont(18));
    text(wx, `${d.weather.temp}°`, Font.boldRoundedSystemFont(16));
  }
  w.addSpacer();
  text(w, d.next ? d.next.title : 'All clear ✨', Font.semiboldSystemFont(13), C.text, 2);
  text(w, d.next?.time ? `at ${d.next.time}` : `${d.tasksLeft} left · ${d.doneToday} done`, Font.systemFont(11), C.dim);
} else {
  const row = w.addStack();
  row.centerAlignContent();
  row.addImage(ring(d.score, 84)).imageSize = new Size(76, 76);
  row.addSpacer(14);
  const col = row.addStack();
  col.layoutVertically();
  text(col, `${d.greeting}${d.name ? `, ${d.name}` : ''}`, Font.boldSystemFont(15));
  text(col, `${d.scoreLabel} · ${d.tasksLeft} left · ${d.doneToday} done`, Font.systemFont(11), C.dim);
  col.addSpacer(6);
  text(col, d.next ? `${d.next.overdue ? '⚠︎ ' : '→ '}${d.next.title}${d.next.time ? ` · ${d.next.time}` : ''}` : 'Nothing due. Enjoy it ✨', Font.semiboldSystemFont(13), C.text, 2);
  w.addSpacer();
  const bottom = w.addStack();
  const bits = [];
  if (d.weather) bits.push(`${d.weather.icon} ${d.weather.temp}° (${d.weather.high}/${d.weather.low})`);
  if (d.steps != null) bits.push(`👟 ${Number(d.steps).toLocaleString()}`);
  if (d.habits.total) bits.push(`✓ ${d.habits.done}/${d.habits.total}`);
  bits.push(`💸 ${Math.round(d.spentToday)} ${d.currency}`);
  text(bottom, bits.join('   '), Font.mediumSystemFont(11), C.faint);
}

if (config.runsInWidget) Script.setWidget(w);
else await (family === 'small' ? w.presentSmall() : w.presentMedium());
Script.complete();
