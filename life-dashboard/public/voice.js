// Voice: speech recognition (push-to-talk + "Hey <name>" wake word) and speech output.
// Uses the browser's built-in engines, so it's free. Works in Chrome/Edge/Android and Safari/iOS.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const voiceSupported = { listen: Boolean(SR), speak: 'speechSynthesis' in window };

let audioCtx;
export function chime(up = true) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    const t = audioCtx.currentTime;
    o.frequency.setValueAtTime(up ? 660 : 880, t);
    o.frequency.exponentialRampToValueAtTime(up ? 990 : 520, t + 0.14);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(audioCtx.destination);
    o.start(t);
    o.stop(t + 0.25);
  } catch { /* audio not available */ }
}

// ---------- Speech output ----------

export function listVoices(lang) {
  if (!voiceSupported.speak) return [];
  const prefix = (lang || 'en').slice(0, 2);
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(prefix));
}

function pickVoice(lang, name) {
  const voices = listVoices(lang);
  if (name) {
    const exact = speechSynthesis.getVoices().find((v) => v.name === name);
    if (exact) return exact;
  }
  const rank = (v) => {
    let s = 0;
    if (/natural|neural|premium|enhanced/i.test(v.name)) s += 5;
    if (/google/i.test(v.name)) s += 3;
    if (/samantha|ava|zoe|serena|daniel|aria|jenny|sonia|libby/i.test(v.name)) s += 2;
    if (v.lang === lang) s += 1;
    if (v.localService === false) s += 1;
    return s;
  };
  return voices.sort((a, b) => rank(b) - rank(a))[0] || null;
}

let speaking = false;
export function isSpeaking() { return speaking; }

export function stopSpeaking() {
  if (voiceSupported.speak) speechSynthesis.cancel();
  speaking = false;
}

// Speak sentence by sentence: avoids Chrome cutting long utterances off.
export function speak(text, { lang = 'en-US', voiceName = '', rate = 1.02, onStart, onEnd } = {}) {
  return new Promise((resolve) => {
    if (!voiceSupported.speak || !text) { resolve(); return; }
    stopSpeaking();
    const chunks = String(text).replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [text];
    const voice = pickVoice(lang, voiceName);
    let i = 0;
    speaking = true;
    onStart?.();
    const next = () => {
      if (!speaking || i >= chunks.length) {
        speaking = false;
        onEnd?.();
        resolve();
        return;
      }
      const u = new SpeechSynthesisUtterance(chunks[i++].trim());
      if (voice) u.voice = voice;
      u.lang = voice?.lang || lang;
      u.rate = rate;
      u.onend = next;
      u.onerror = next;
      speechSynthesis.speak(u);
    };
    next();
  });
}

// ---------- Speech input ----------

export function listenOnce({ lang = 'en-US', timeoutMs = 9000, onInterim } = {}) {
  return new Promise((resolve) => {
    if (!SR) { resolve(null); return; }
    const rec = new SR();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = '';
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { rec.stop(); } catch { /* already stopped */ }
      resolve(value);
    };
    const timer = setTimeout(() => done(finalText || null), timeoutMs);
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      onInterim?.((finalText + interim).trim());
    };
    rec.onerror = (e) => done(e.error === 'no-speech' || e.error === 'aborted' ? (finalText || null) : { error: e.error });
    rec.onend = () => done(finalText.trim() || null);
    try { rec.start(); } catch (err) { done({ error: err.message }); }
  });
}

// Continuous listening for "Hey <name>" while the app is open.
export class WakeWord {
  constructor({ name = 'Nova', lang = 'en-US', onWake }) {
    this.name = name;
    this.lang = lang;
    this.onWake = onWake;
    this.active = false;
    this.paused = false;
    this.rec = null;
    this.restarts = 0;
  }

  get pattern() {
    const n = this.name.toLowerCase().replace(/[^a-z]/g, '');
    // Recognisers often mishear short names, so accept a few near-misses.
    const variants = [n];
    if (n === 'nova') variants.push('noah', 'nover', 'no va', 'novah');
    return new RegExp(`\\b(?:hey|hi|ok|okay|yo)?[ ,]*(?:${variants.join('|')})\\b[ ,.!?]*(.*)$`, 'i');
  }

  start() {
    if (!SR || this.active) return false;
    this.active = true;
    this.paused = false;
    this._run();
    return true;
  }

  stop() {
    this.active = false;
    try { this.rec?.abort(); } catch { /* ignore */ }
    this.rec = null;
  }

  pause() {
    this.paused = true;
    try { this.rec?.abort(); } catch { /* ignore */ }
    this.rec = null;
  }

  resume() {
    if (!this.active) return;
    this.paused = false;
    if (!this.rec) this._run();
  }

  _run() {
    if (!this.active || this.paused || document.hidden) return;
    const rec = new SR();
    this.rec = rec;
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const heard = e.results[i][0].transcript.trim();
        const m = heard.match(this.pattern);
        if (m) {
          this.restarts = 0;
          this.pause();
          this.onWake?.(m[1].trim());
          return;
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') this.active = false;
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.rec = null;
      // Browsers end continuous sessions every so often; quietly restart.
      if (this.active && !this.paused && this.restarts++ < 500) setTimeout(() => this._run(), 250);
    };
    try { rec.start(); } catch { this.rec = null; }
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopSpeaking();
});
