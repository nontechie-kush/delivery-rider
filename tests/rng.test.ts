import { describe, expect, it } from "vitest";
import { makeRng } from "../src/sim/rng.js";

describe("makeRng", () => {
  it("is reproducible for a given seed", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("produces different streams for different seeds", () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it("stays inside [0, 1)", () => {
    const rng = makeRng(7);
    for (let i = 0; i < 5000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("int is inclusive at both ends and never leaves the range", () => {
    const rng = makeRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 3000; i++) {
      const v = rng.int(1, 4);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(4);
      seen.add(v);
    }
    expect(seen).toEqual(new Set([1, 2, 3, 4]));
  });

  it("pick throws on an empty array rather than returning undefined", () => {
    const rng = makeRng(3);
    expect(() => rng.pick([])).toThrow(/empty/);
  });

  it("chance(0) is never true and chance(1) is always true", () => {
    const rng = makeRng(11);
    for (let i = 0; i < 200; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });
});
