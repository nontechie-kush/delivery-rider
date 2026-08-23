import type { Slot, Temp } from "./types.js";

/**
 * The bag is the constraint that turns "accept this order?" from a yes/no into a
 * spatial puzzle. Couriers reject batched orders partly because the food will not
 * physically fit alongside what they are already carrying — size, fragility, and
 * hot-versus-cold separation.
 *
 * Starting layout: two hot, one cold, two flexible. A run of hot orders cannot all
 * be taken, which is exactly when the player has to choose.
 */
export const STARTING_SLOTS: readonly Slot["kind"][] = ["HOT", "HOT", "COLD", "ANY", "ANY"];

export function makeBag(kinds: readonly Slot["kind"][] = STARTING_SLOTS): Slot[] {
  return kinds.map((kind) => ({ kind, orderId: null }));
}

function accepts(slotKind: Slot["kind"], temp: Temp): boolean {
  if (slotKind === "ANY") return true;
  if (temp === "AMBIENT") return true;
  return slotKind === temp;
}

/**
 * Index of the slot this order should go into, or null if it will not fit.
 *
 * Prefers the most specialised slot that works, so ANY slots stay free for the
 * orders that have nowhere else to go. Filling an ANY slot with a HOT order while a
 * HOT slot sits empty is the kind of quiet waste that loses a milestone.
 */
export function findSlot(bag: readonly Slot[], temp: Temp): number | null {
  let fallback: number | null = null;

  for (let i = 0; i < bag.length; i++) {
    const slot = bag[i];
    if (!slot || slot.orderId !== null) continue;
    if (!accepts(slot.kind, temp)) continue;

    if (slot.kind !== "ANY") return i;
    if (fallback === null) fallback = i;
  }

  return fallback;
}

export function fits(bag: readonly Slot[], temp: Temp): boolean {
  return findSlot(bag, temp) !== null;
}

export function load(bag: Slot[], temp: Temp, orderId: string): boolean {
  const index = findSlot(bag, temp);
  if (index === null) return false;
  const slot = bag[index];
  if (!slot) return false;
  slot.orderId = orderId;
  return true;
}

export function unload(bag: Slot[], orderId: string): boolean {
  const slot = bag.find((s) => s.orderId === orderId);
  if (!slot) return false;
  slot.orderId = null;
  return true;
}

export function used(bag: readonly Slot[]): number {
  return bag.filter((s) => s.orderId !== null).length;
}
