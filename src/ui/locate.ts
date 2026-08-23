import { insideZone, nearestNode } from "../sim/city.js";

/**
 * Finding where the rider actually is, so the day starts where they are
 * standing rather than at a fixed point on the map.
 *
 * Two rules this must never break:
 *
 *   1. The position never leaves the device. It is read once, turned into a
 *      starting node, and discarded. Nothing is stored and nothing is sent —
 *      there is no backend to send it to, and there should not be one for this.
 *   2. It can never block play. Permission gets denied, GPS times out, the
 *      browser has no geolocation at all, or the page is on plain HTTP where
 *      the API simply refuses. Every one of those falls through to the dark
 *      store and the game starts anyway.
 */

export type LocateOutcome =
  | { kind: "located"; nodeId: string; nodeName: string; kmAway: number; inZone: boolean }
  | { kind: "denied" }
  | { kind: "unavailable" }
  | { kind: "timeout" };

/** Long enough for a cold GPS fix, short enough not to strand the player. */
const TIMEOUT_MS = 8000;

export async function locateRider(): Promise<LocateOutcome> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { kind: "unavailable" };
  }

  return new Promise<LocateOutcome>((resolve) => {
    let settled = false;
    const done = (outcome: LocateOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    // Belt and braces: some browsers never fire the error callback on a denied
    // permission that was remembered, so the game must time itself out too.
    const timer = setTimeout(() => done({ kind: "timeout" }), TIMEOUT_MS + 500);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer);
        const { latitude, longitude } = position.coords;
        const { node, km } = nearestNode(latitude, longitude);
        done({
          kind: "located",
          nodeId: node.id,
          nodeName: node.name,
          kmAway: km,
          inZone: insideZone(latitude, longitude),
        });
      },
      (error) => {
        clearTimeout(timer);
        done(
          error.code === error.PERMISSION_DENIED
            ? { kind: "denied" }
            : error.code === error.TIMEOUT
              ? { kind: "timeout" }
              : { kind: "unavailable" },
        );
      },
      { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: 60_000 },
    );
  });
}

/** What to tell the player about where they were put, in their own terms. */
export function locateMessage(outcome: LocateOutcome): string {
  switch (outcome.kind) {
    case "located":
      return outcome.inZone
        ? `Starting near you, at ${outcome.nodeName}.`
        : `You're about ${Math.round(outcome.kmAway)} km outside this zone, so you'll start at ${outcome.nodeName}.`;
    case "denied":
      return "Location off, so you'll start at the dark store. That's fine.";
    case "timeout":
      return "Couldn't get a fix in time. Starting at the dark store.";
    case "unavailable":
      return "This device won't share location. Starting at the dark store.";
  }
}
