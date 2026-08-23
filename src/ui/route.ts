import { node } from "../sim/city.js";
import { esc } from "./format.js";

/**
 * The stacked pickup-to-drop stack with a connector line between the pins.
 *
 * This is the single most recognisable element of every rider app — Swiggy,
 * Zomato, Blinkit, Rapido, Uber, DoorDash all use it, because it answers the
 * only two questions that matter at a glance: where am I going first, and where
 * am I going after. Reused by both the offer card and the active task list so
 * an order looks the same before and after you take it.
 */
export function routeStack(
  pickupId: string,
  dropId: string,
  opts: { pickupNote?: string; dropNote?: string; done?: "pickup" | null } = {},
): string {
  const { pickupNote = "", dropNote = "", done = null } = opts;

  return `
    <div class="route">
      <div class="stop pickup ${done === "pickup" ? "done" : ""}">
        <span class="pin" aria-hidden="true"></span>
        <div class="stoptext">
          <b>${esc(node(pickupId).name)}</b>
          ${pickupNote ? `<span>${esc(pickupNote)}</span>` : ""}
        </div>
      </div>
      <div class="stop drop">
        <span class="pin" aria-hidden="true"></span>
        <div class="stoptext">
          <b>${esc(node(dropId).name)}</b>
          ${dropNote ? `<span>${esc(dropNote)}</span>` : ""}
        </div>
      </div>
    </div>`;
}
