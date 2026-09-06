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
    const c = enabled ? ac() : null;
    if (!c) return;
    for (let i = 0; i < 5; i++) setTimeout(() => noise(c, 0.06, 0.25, 2200 + Math.random() * 1500, 1.2), i * 70 + Math.random() * 30);
  },
  step() {
    const c = enabled ? ac() : null;
    if (!c) return;
    noise(c, 0.05, 0.12, 600, 1);
  },
  fireball() {
    const c = enabled ? ac() : null;
    if (!c) return;
    tone(c, 90, 1.6, 0.35, 'sawtooth', 0.4);
    noise(c, 1.4, 0.18, 300, 0.4);
  },
  hit() {
    const c = enabled ? ac() : null;
    if (!c) return;
    noise(c, 0.18, 0.5, 400, 0.6);
    tone(c, 160, 0.25, 0.4, 'triangle', 0.3);
  },
  jewel() {
    const c = enabled ? ac() : null;
    if (!c) return;
    [660, 880, 1320].forEach((f, i) => setTimeout(() => tone(c, f, 0.5, 0.18, 'sine', 1.01), i * 90));
  },
  card() {
    const c = enabled ? ac() : null;
    if (!c) return;
    noise(c, 0.12, 0.12, 1800, 0.5);
  },
  splash() {
    const c = enabled ? ac() : null;
    if (!c) return;
    noise(c, 0.5, 0.3, 900, 0.3);
  },
  win() {
    const c = enabled ? ac() : null;
    if (!c) return;
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(c, f, 0.6, 0.2, 'triangle', 1), i * 140));
  },
  cave() {
    const c = enabled ? ac() : null;
    if (!c) return;
    tone(c, 220, 0.6, 0.2, 'sine', 0.5);
  },
};


// ---------------------------------------------------------------------------
// Background music
// ---------------------------------------------------------------------------
// The theme plays through a WebAudio gain node rather than the element's volume property:
// iOS Safari ignores HTMLMediaElement.volume, but honours gain, so fades and ducking work there.

const MUSIC_KEY = 'fireisle.music';
let musicEl: HTMLAudioElement | null = null;
let musicGain: GainNode | null = null;
let musicWanted = true;
let fadeTimer: number | null = null;
let duckUntil = 0;
let stopTimer: number | null = null;
try {
  musicWanted = localStorage.getItem(MUSIC_KEY) !== 'off';
} catch { /* ignore */ }

export const MUSIC_VOLUME = 0.32;

function musicElement(): HTMLAudioElement {
  if (!musicEl) {
    musicEl = new Audio(new URL('./audio/fire-isle-theme.mp3', document.baseURI).href);
    musicEl.loop = true;
    musicEl.preload = 'auto';
    musicEl.crossOrigin = 'anonymous';
    const c = ac();
    if (c) {
      try {
        const src = c.createMediaElementSource(musicEl);
        musicGain = c.createGain();
        musicGain.gain.value = 0;
        src.connect(musicGain).connect(c.destination);
      } catch {
        musicGain = null;
      }
    }
    if (!musicGain) musicEl.volume = 0;
  }
  return musicEl;
}

function currentLevel(): number {
  return musicGain ? musicGain.gain.value : musicEl?.volume ?? 0;
}

function setLevel(v: number) {
  const c = ac();
  if (musicGain && c) {
    musicGain.gain.cancelScheduledValues(c.currentTime);
    musicGain.gain.setValueAtTime(v, c.currentTime);
  } else if (musicEl) {
    musicEl.volume = v;
  }
}

function cancelFade() {
  if (fadeTimer !== null) window.clearInterval(fadeTimer);
  fadeTimer = null;
  if (stopTimer !== null) window.clearTimeout(stopTimer);
  stopTimer = null;
}

function fadeTo(target: number, ms: number, onDone?: () => void) {
  cancelFade();
  const start = currentLevel();
  const t0 = performance.now();
  fadeTimer = window.setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    setLevel(start + (target - start) * k);
    if (k >= 1) {
      cancelFade();
      onDone?.();
    }
  }, 50);
}

/** Start the theme (call from a user gesture; browsers block autoplay otherwise). */
export function startMusic() {
  if (!musicWanted) return;
  const el = musicElement();
  const c = ac();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
  if (!el.paused) {
    // already playing (maybe mid fade-out): just bring the level back up
    if (currentLevel() < MUSIC_VOLUME - 0.01) fadeTo(MUSIC_VOLUME, 1200);
    return;
  }
  el.play().then(() => fadeTo(MUSIC_VOLUME, 2500)).catch(() => { /* blocked until the next gesture */ });
}

export function musicEnabled(): boolean {
  return musicWanted;
}

export function musicPlaying(): boolean {
  return !!musicEl && !musicEl.paused && musicEl.currentTime > 0;
}

export function setMusicEnabled(on: boolean) {
  musicWanted = on;
  try {
    localStorage.setItem(MUSIC_KEY, on ? 'on' : 'off');
  } catch { /* ignore */ }
  cancelFade();
  if (on) {
    startMusic();
  } else if (musicEl && !musicEl.paused) {
    fadeTo(0, 800, () => {
      if (!musicWanted) musicEl?.pause();
    });
  }
}

/** Briefly lower the music (e.g. while a fireball rolls); overlapping calls extend the duck. */
export function duckMusic(ms: number) {
  if (!musicEl || musicEl.paused || !musicWanted) return;
  const now = performance.now();
  duckUntil = Math.max(duckUntil, now + ms);
  if (currentLevel() > MUSIC_VOLUME * 0.35 + 0.01) fadeTo(MUSIC_VOLUME * 0.35, 300);
  window.setTimeout(() => {
    if (performance.now() < duckUntil - 5) return; // another duck extended the deadline
    if (musicEl && !musicEl.paused && musicWanted) fadeTo(MUSIC_VOLUME, 900);
  }, ms + 10);
}
