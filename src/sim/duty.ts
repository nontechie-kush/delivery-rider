import {
  hourAt,
  minutesAtHour,
  type GameConfig,
  type SlotConfig,
} from "./config.js";

/**
 * When the rider works, and what the platform does about it.
 *
 * Real riders choose their own hours — that is the whole pitch of the job. What
 * the platforms sell instead of a schedule is a set of conditional bets:
 *
 *   - Book a slot and hit its terms and you cannot earn less than a guarantee.
 *     Miss any term and the guarantee vanishes entirely. Swiggy's version voids
 *     the minimum on your second rejection; complete 22 of a required 23 and you
 *     take home ₹350 instead of ₹845.
 *   - Keep acceptance above 80–90% or the day's incentives are void. Distance,
 *     traffic and unsafe areas are not accepted as reasons.
 *   - Log in at all, regularly. Fifteen continuous days away and Zomato makes
 *     the account inactive; getting it back is at their discretion.
 *
 * So freedom is real, and every use of it is priced.
 */

export interface Commitment {
  slotId: string;
  /** Set the moment a term is broken, with the reason, and never cleared. */
  brokenReason: string | null;
  /** Minutes of the window actually spent online. */
  minutesPresent: number;
  rejections: number;
}

export interface DutyState {
  online: boolean;
  /** Day-minute the rider last went online. Null while off duty. */
  onlineSince: number | null;
  /** Total minutes on duty today. */
  minutesOnline: number;
  /**
   * Acceptance counts deliberate choices only — an accept, or an explicit
   * reject. An offer that expires while the rider is mid-delivery is not a
   * refusal and is not counted, which is why the queue can be busier than the
   * rate suggests.
   */
  offersAccepted: number;
  offersRejected: number;
  commitment: Commitment | null;
  /** Player-facing notices about standing — warnings, breaches, reinstatements. */
  notices: string[];
}

export function createDuty(): DutyState {
  return {
    online: false,
    onlineSince: null,
    minutesOnline: 0,
    offersAccepted: 0,
    offersRejected: 0,
    commitment: null,
    notices: [],
  };
}

/* ------------------------------------------------------------- committing */

/** Slots that can still be booked — a slot already under way is closed. */
export function bookableSlots(clock: number, cfg: GameConfig): SlotConfig[] {
  const hour = hourAt(clock, cfg);
  return cfg.slots.filter((s) => s.fromHour > hour);
}

export function commit(duty: DutyState, slotId: string, clock: number, cfg: GameConfig): boolean {
  if (duty.commitment) return false;
  if (!bookableSlots(clock, cfg).some((s) => s.id === slotId)) return false;

  duty.commitment = { slotId, brokenReason: null, minutesPresent: 0, rejections: 0 };
  const slot = cfg.slots.find((s) => s.id === slotId);
  if (slot) {
    duty.notices.push(
      `Booked ${slot.label}, ${slot.fromHour}:00–${slot.toHour}:00. ₹${slot.guarantee} guaranteed if you stay online the whole window and reject no more than ${slot.rejectionsAllowed}.`,
    );
  }
  return true;
}

export function committedSlot(duty: DutyState, cfg: GameConfig): SlotConfig | null {
  if (!duty.commitment) return null;
  return cfg.slots.find((s) => s.id === duty.commitment?.slotId) ?? null;
}

function breakCommitment(duty: DutyState, reason: string): void {
  if (!duty.commitment || duty.commitment.brokenReason) return;
  duty.commitment.brokenReason = reason;
  duty.notices.push(`Guarantee lost — ${reason}`);
}

/* ------------------------------------------------------ going on and off */

export function goOnline(duty: DutyState, clock: number): boolean {
  if (duty.online) return false;
  duty.online = true;
  duty.onlineSince = clock;
  return true;
}

export function goOffline(duty: DutyState, clock: number, cfg: GameConfig): boolean {
  if (!duty.online) return false;
  accrue(duty, clock, cfg);
  duty.online = false;
  duty.onlineSince = null;

  // Stepping away mid-window is the classic way to lose a guarantee, and riders
  // know it — which is why they stay logged in through weather and meals.
  const slot = committedSlot(duty, cfg);
  if (slot) {
    const hour = hourAt(clock, cfg);
    if (hour >= slot.fromHour && hour < slot.toHour) {
      breakCommitment(duty, `you went off duty during the ${slot.label} window.`);
    }
  }
  return true;
}

/**
 * Books time against the clock. Must be called before any read of
 * `minutesOnline` or slot presence, and whenever the clock advances.
 */
export function accrue(duty: DutyState, clock: number, cfg: GameConfig): void {
  if (!duty.online || duty.onlineSince === null) return;

  const from = duty.onlineSince;
  const worked = Math.max(0, clock - from);
  duty.minutesOnline += worked;

  const slot = committedSlot(duty, cfg);
  if (slot && duty.commitment) {
    // Overlap between the stretch just worked and the committed window.
    const start = minutesAtHour(slot.fromHour, cfg);
    const end = minutesAtHour(slot.toHour, cfg);
    duty.commitment.minutesPresent += Math.max(0, Math.min(clock, end) - Math.max(from, start));
  }

  duty.onlineSince = clock;
}

/* ------------------------------------------------------------- offer flow */

export function recordAccept(duty: DutyState): void {
  duty.offersAccepted += 1;
}

export function recordReject(duty: DutyState, clock: number, cfg: GameConfig): void {
  duty.offersRejected += 1;

  const slot = committedSlot(duty, cfg);
  if (!slot || !duty.commitment) return;

  const hour = hourAt(clock, cfg);
  if (hour < slot.fromHour || hour >= slot.toHour) return;

  duty.commitment.rejections += 1;
  if (duty.commitment.rejections > slot.rejectionsAllowed) {
    breakCommitment(
      duty,
      `you rejected ${duty.commitment.rejections} orders during ${slot.label}; ${slot.rejectionsAllowed} was the limit.`,
    );
  }
}

/** Accepted over decided. Null until enough decisions have been made to judge. */
export function acceptanceRate(duty: DutyState, cfg: GameConfig): number | null {
  const decided = duty.offersAccepted + duty.offersRejected;
  if (decided < cfg.acceptanceGracePeriod) return null;
  return duty.offersAccepted / decided;
}

/**
 * Whether the day's milestone incentives still stand. Platforms void them below
 * 80–90% acceptance, and treat "the order was bad for me" as no reason at all.
 */
export function incentivesVoid(duty: DutyState, cfg: GameConfig): boolean {
  const rate = acceptanceRate(duty, cfg);
  return rate !== null && rate < cfg.minAcceptanceRate;
}

/* ---------------------------------------------------------- settling up */

export interface SlotOutcome {
  slot: SlotConfig;
  met: boolean;
  reason: string | null;
  /** Minutes of the window the rider was actually present for. */
  present: number;
  required: number;
}

/**
 * Settles a booked slot at end of day. Presence is checked last, because the
 * rider may simply never have shown up rather than breaking a term in play.
 */
export function settleSlot(duty: DutyState, clock: number, cfg: GameConfig): SlotOutcome | null {
  const slot = committedSlot(duty, cfg);
  if (!slot || !duty.commitment) return null;

  accrue(duty, clock, cfg);

  const required = (slot.toHour - slot.fromHour) * 60;
  const present = duty.commitment.minutesPresent;

  if (duty.commitment.brokenReason) {
    return { slot, met: false, reason: duty.commitment.brokenReason, present, required };
  }

  // A minute of slack, so arriving exactly on the hour is not punished by
  // floating-point noise.
  if (present < required - 1) {
    return {
      slot,
      met: false,
      reason: `you were online for ${Math.round(present)} of the ${required} minutes.`,
      present,
      required,
    };
  }

  return { slot, met: true, reason: null, present, required };
}
