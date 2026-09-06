// Deterministic PRNG (mulberry32). The whole game is reproducible from its seed.

export function nextRandom(state: number): { value: number; state: number } {
  let t = (state + 0x6d2b79f5) | 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  const value = ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  return { value, state: t };
}

export function rollDie(state: number): { value: number; state: number } {
  const r = nextRandom(state);
  return { value: 1 + Math.floor(r.value * 6), state: r.state };
}

export function shuffle<T>(arr: T[], state: number): { arr: T[]; state: number } {
  const a = arr.slice();
  let s = state;
  for (let i = a.length - 1; i > 0; i--) {
    const r = nextRandom(s);
    s = r.state;
    const j = Math.floor(r.value * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return { arr: a, state: s };
}

export function pick<T>(arr: T[], state: number): { item: T; index: number; state: number } {
  const r = nextRandom(state);
  const index = Math.floor(r.value * arr.length);
  return { item: arr[index], index, state: r.state };
}
