/** Everything in the simulation is measured in game-minutes and whole rupees. */

/** What compartment an order needs. AMBIENT fits anywhere. */
export type Temp = "HOT" | "COLD" | "AMBIENT";

/** Deadline tiers. Shorter promises pay more per minute and forgive less. */
export type Tier = "EXPRESS" | "STANDARD" | "SCHEDULED";

export type NodeKind = "PICKUP" | "DROP";

/**
 * What sort of place this is, which is what makes a city of this size
 * learnable. Twenty-odd venues cannot each be memorised, but eight archetypes
 * can — a dark store is always quick, a biryani house is never quick, a cloud
 * kitchen is the one you cannot predict. The specific venue then varies around
 * its type rather than being its own separate fact.
 */
export type VenueKind =
  | "darkstore"
  | "grocery"
  | "biryani"
  | "dhaba"
  | "cafe"
  | "sweets"
  | "chinese"
  | "fastfood";

/**
 * What a delivery address is like to hand over at. The whole cost of a drop is
 * how long the building takes to let you in, so the type predicts it: a metro
 * gate is a pavement handover, a gated tower is a guard, a lift and a floor.
 */
export type AddressKind = "metro" | "market" | "condo" | "gated" | "office";

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
  venue: VenueKind;
}

export interface Drop extends CityNode {
  kind: "DROP";
  address: AddressKind;
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
