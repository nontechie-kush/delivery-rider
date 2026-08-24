import { distance, node } from "../sim/city.js";
import { trafficAt, type GameConfig } from "../sim/config.js";
import { rideMinutes, type ShiftState } from "../sim/shift.js";
import { runRide } from "./screen.js";

/**
 * Sets up a ride, runs it, and turns what happened into minutes.
 *
 * The simulation stays authoritative over the clock: the ride only reports how
 * badly the journey went, and everything downstream — deadlines, fuel, the
 * guarantee — is still worked out by the sim.
 */

export interface RideOutcome {
  /** Minutes to add to the journey: spills, plus whatever the pace cost. */
  extraMinutes: number;
  redsRun: number;
}

/**
 * Minutes until the tightest order this stop serves goes late, or null if this
 * ride is not serving anything on a clock. Drives the "you are not going to
 * make this" warning on the ride HUD.
 */
function tightestSlack(state: ShiftState, destId: string): number | null {
  const serving = state.carried.filter(
    (c) => (c.leg === "TO_PICKUP" ? c.order.pickupId : c.order.dropId) === destId,
  );
  if (serving.length === 0) return null;
  return Math.min(...serving.map((c) => c.order.dueAt - state.clock));
}

export async function launchRide(
  stage: HTMLElement | null | undefined,
  state: ShiftState,
  cfg: GameConfig,
  destId: string,
): Promise<RideOutcome> {
  const km = distance(state.locationId, destId);
  const base = rideMinutes(state, state.locationId, destId);

  // No canvas to ride on — never strand the player, just make the journey.
  if (!stage) return { extraMinutes: 0, redsRun: 0 };

  const seconds = Math.max(
    cfg.rideSecondsMin,
    Math.min(cfg.rideSecondsMax, km * cfg.rideSecondsPerKm),
  );

  // Rush hour puts more between you and the drop, and a full bag handles worse.
  const density = Math.min(1, Math.max(0, (trafficAt(state.clock, cfg) - 0.8) / 0.6));

  const { promise } = runRide(
    stage,
    {
      seconds,
      density,
      load: state.carried.length / state.bag.length,
      seed: Math.floor(Math.random() * 1e9),
      signalWaitSeconds: cfg.signalWaitSeconds,
      signalRunCrashChance: cfg.signalRunCrashChance,
    },
    {
      to: node(destId).name,
      orders: state.carried.length,
      topSpeedKmh: cfg.rideTopSpeedKmh,
      km,
      etaMinutes: base,
      slackMinutes: tightestSlack(state, destId),
    },
  );

  const result = await promise;

  // How hard the journey was ridden decides how long it took. Flat out arrives
  // at ridePaceFloor of the estimate, gently at ridePaceCeiling — so holding
  // the throttle buys time rather than only costing risk.
  const span = cfg.ridePaceCeiling - cfg.ridePaceFloor;
  const paceFactor = cfg.ridePaceCeiling - result.pace * span;

  return {
    extraMinutes: result.minutesLost + base * (paceFactor - 1),
    redsRun: result.redsRun,
  };
}
