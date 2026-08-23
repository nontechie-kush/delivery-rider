/** Everything in the simulation is measured in game-minutes and whole rupees. */

/** What compartment an order needs. AMBIENT fits anywhere. */
export type Temp = "HOT" | "COLD" | "AMBIENT";

/** Deadline tiers. Shorter promises pay more per minute and forgive less. */
export type Tier = "EXPRESS" | "STANDARD" | "SCHEDULED";

export type NodeKind = "PICKUP" | "DROP";

export interface CityNode {
  id: string;
  name: string;
  kind: NodeKind;
  /** Grid coordinates. Travel time is derived from these, never stored. */
  x: number;
  y: number;
}

export interface Pickup extends CityNode {
  kind: "PICKUP";
  /** Mean true prep time in game-minutes. */
  prepMean: number;
  /** Spread around the mean. */
  prepSpread: number;
  /**
   * How much this place under-reports its prep time, as a fraction.
   * 0 = honest, 0.6 = shows you 40% of the real wait.
   * Documented reality: platforms do not count restaurant wait time.
   */
  optimism: number;
}

export interface Order {
  id: string;
  tier: Tier;
  temp: Temp;
  pickupId: string;
  dropId: string;
  /** Game-minute the offer appeared. */
  offeredAt: number;
  /** Offer disappears from the queue at this game-minute if not accepted. */
  expiresAt: number;
  /** Game-minute the delivery is late after. Set when accepted. */
  dueAt: number;
  /** Straight-line distance in grid units, pickup to drop. */
  distance: number;
  /** Base + distance pay in rupees. Milestones are separate. */
  fee: number;
  /** True prep time. The player never sees this. */
  truePrep: number;
  /** What the app claims the prep time is. Always <= truePrep. */
  shownPrep: number;
}

export type SlotKind = "HOT" | "COLD" | "ANY";

export interface Slot {
  kind: SlotKind;
  orderId: string | null;
}

/** Where an accepted order is in its lifecycle. */
export type Leg = "TO_PICKUP" | "TO_DROP";

export interface Carried {
  order: Order;
  leg: Leg;
  /** Game-minute the order was collected. Null until picked up. */
  pickedUpAt: number | null;
  /** Minutes actually spent standing at the pickup waiting for this order. */
  waited: number;
}
