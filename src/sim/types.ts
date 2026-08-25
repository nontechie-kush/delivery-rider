/** Everything in the simulation is measured in game-minutes and whole rupees. */

/** What compartment an order needs. AMBIENT fits anywhere. */
export type Temp = "HOT" | "COLD" | "AMBIENT";

/** Deadline tiers. Shorter promises pay more per minute and forgive less. */
export type Tier = "EXPRESS" | "STANDARD" | "SCHEDULED";

export type NodeKind = "PICKUP" | "DROP";

export interface CityNode {
  id: string;
  name: string;
  /** The real Gurgaon neighbourhood this sits in. */
  area: string;
  kind: NodeKind;
  /** Projected kilometres from the zone's north-west corner. */
  x: number;
  y: number;
}

export interface Pickup extends CityNode {
  kind: "PICKUP";
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
  /** Today's actual prep time, drawn from the kitchen's range. Never shown. */
  truePrep: number;
  /**
   * The honest expectation for this kitchen — the middle of its range, not a
   * number derived from today's draw. Used for forecasting and for the verdict.
   */
  shownPrep: number;
  /** The range the player is shown. truePrep always falls inside it. */
  prepLow: number;
  prepHigh: number;
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
