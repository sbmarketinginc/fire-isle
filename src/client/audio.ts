// Tiny synthesized sound effects (no audio assets needed).
let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(v: boolean) {
  enabled = v;
}
export function soundEnabled() {
  return enabled;
}

function ac(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function unlockAudio() {
  ac();
}

function noise(c: AudioContext, dur: number, gain: number, freq = 1200, q = 0.7) {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination);
  src.start();
}

function tone(c: AudioContext, freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slide = 1) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), c.currentTime + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + dur);
}

export const sfx = {
  dice() {
    const c = ac();
    if (!c) return;
    for (let i = 0; i < 5; i++) setTimeout(() => noise(c, 0.06, 0.25, 2200 + Math.random() * 1500, 1.2), i * 70 + Math.random() * 30);
  },
  step() {
    const c = ac();
    if (!c) return;
    noise(c, 0.05, 0.12, 600, 1);
  },
  fireball() {
    const c = ac();
    if (!c) return;
    tone(c, 90, 1.6, 0.35, 'sawtooth', 0.4);
    noise(c, 1.4, 0.18, 300, 0.4);
  },
  hit() {
    const c = ac();
    if (!c) return;
    noise(c, 0.18, 0.5, 400, 0.6);
    tone(c, 160, 0.25, 0.4, 'triangle', 0.3);
  },
  jewel() {
    const c = ac();
    if (!c) return;
    [660, 880, 1320].forEach((f, i) => setTimeout(() => tone(c, f, 0.5, 0.18, 'sine', 1.01), i * 90));
  },
  card() {
    const c = ac();
    if (!c) return;
    noise(c, 0.12, 0.12, 1800, 0.5);
  },
  splash() {
    const c = ac();
    if (!c) return;
    noise(c, 0.5, 0.3, 900, 0.3);
  },
  win() {
    const c = ac();
    if (!c) return;
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(c, f, 0.6, 0.2, 'triangle', 1), i * 140));
  },
  cave() {
    const c = ac();
    if (!c) return;
    tone(c, 220, 0.6, 0.2, 'sine', 0.5);
  },
};
