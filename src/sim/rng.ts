/**
 * Seeded RNG. The whole simulation depends on this being the *only* source of
 * randomness under src/sim — see CLAUDE.md rule 4. A bare Math.random() anywhere
 * in the core silently breaks the golden run and every balance experiment.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** Picks one element. Throws on an empty array rather than returning undefined. */
  pick<T>(items: readonly T[]): T;
  /** True with probability p. */
  chance(p: number): boolean;
}

/** mulberry32 — small, fast, good distribution, trivially reproducible. */
export function makeRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const float = (min: number, max: number): number => min + next() * (max - min);

  const int = (min: number, max: number): number =>
    Math.floor(float(min, max + 1));

  const pick = <T,>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new Error("rng.pick called with an empty array");
    }
    // Non-null assertion avoided: index is provably in range.
    const item = items[int(0, items.length - 1)];
    if (item === undefined) {
      throw new Error("rng.pick produced an out-of-range index");
    }
    return item;
  };

  const chance = (p: number): boolean => next() < p;

  return { next, int, float, pick, chance };
}
