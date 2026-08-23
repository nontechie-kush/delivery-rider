import { describe, expect, it } from "vitest";
import { findSlot, fits, load, makeBag, unload, used } from "../src/sim/bag.js";

describe("bag", () => {
  it("starts empty with five slots", () => {
    const bag = makeBag();
    expect(bag).toHaveLength(5);
    expect(used(bag)).toBe(0);
  });

  it("puts a HOT order in a HOT slot before an ANY slot", () => {
    const bag = makeBag(["ANY", "HOT"]);
    expect(findSlot(bag, "HOT")).toBe(1);
  });

  it("falls back to an ANY slot when the matching one is full", () => {
    const bag = makeBag(["HOT", "ANY"]);
    load(bag, "HOT", "a");
    expect(findSlot(bag, "HOT")).toBe(1);
  });

  it("lets AMBIENT go anywhere", () => {
    expect(findSlot(makeBag(["HOT"]), "AMBIENT")).toBe(0);
    expect(findSlot(makeBag(["COLD"]), "AMBIENT")).toBe(0);
  });

  it("refuses a COLD order when only HOT slots are free", () => {
    const bag = makeBag(["HOT", "HOT"]);
    expect(fits(bag, "COLD")).toBe(false);
    expect(load(bag, "COLD", "a")).toBe(false);
  });

  /**
   * The constraint that makes accepting an order a real decision: the default bag
   * cannot carry three hot orders at once, so a run of them forces a choice.
   */
  it("cannot carry more than two hot orders in the starting bag", () => {
    const bag = makeBag();
    expect(load(bag, "HOT", "a")).toBe(true);
    expect(load(bag, "HOT", "b")).toBe(true);
    expect(load(bag, "HOT", "c")).toBe(true); // spills into an ANY slot
    expect(load(bag, "HOT", "d")).toBe(true); // and the second ANY slot
    expect(load(bag, "HOT", "e")).toBe(false); // COLD slot cannot take it
    expect(used(bag)).toBe(4);
  });

  it("keeps ANY slots free for orders with nowhere else to go", () => {
    const bag = makeBag();
    load(bag, "HOT", "a");
    load(bag, "COLD", "b");
    // Both specialised slots used their own kind, leaving ANY open.
    expect(fits(bag, "AMBIENT")).toBe(true);
    expect(used(bag)).toBe(2);
  });

  it("frees the slot on unload", () => {
    const bag = makeBag();
    load(bag, "COLD", "a");
    expect(used(bag)).toBe(1);
    expect(unload(bag, "a")).toBe(true);
    expect(used(bag)).toBe(0);
  });

  it("reports failure when unloading something it is not carrying", () => {
    expect(unload(makeBag(), "nope")).toBe(false);
  });
});
