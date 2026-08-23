/**
 * @vitest-environment jsdom
 *
 * Interaction smoke test — the one thing every other test in this project
 * cannot do: actually click the buttons.
 *
 * This exists because two shipped bugs got through a green suite and a clean
 * build. A runaway string replace once put a recursive call in front of every
 * render, and a regex once deleted the whole map stylesheet. Both times the
 * types checked, the tests passed, the bundle built, and the app was broken in
 * the browser. Nothing here asserts on how the page *looks* — but it does prove
 * the page responds.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

async function mountApp(): Promise<HTMLElement> {
  document.body.innerHTML = `<div id="app"></div>`;
  vi.resetModules();
  await import("../src/main.js");
  // The location lookup resolves on a microtask; let it settle.
  await new Promise((r) => setTimeout(r, 0));
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) throw new Error("#app missing after mount");
  return app;
}

const click = (el: Element | null): void => {
  if (!el) throw new Error("tried to click something that is not there");
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

describe("the app boots", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the start screen without a geolocation API", async () => {
    const app = await mountApp();
    expect(app.innerHTML).toContain("NOW");
    expect(app.querySelector("[data-begin]")).not.toBeNull();
  });

  /**
   * jsdom has no navigator.geolocation, which is the same situation as a denied
   * permission or plain HTTP. The day must still be startable.
   */
  it("still lets the rider go on duty when location is unavailable", async () => {
    const app = await mountApp();
    expect(app.querySelector(".locrow")?.textContent).toBeTruthy();
    click(app.querySelector("[data-begin]"));
    expect(app.querySelector(".sheet")).not.toBeNull();
  });
});

describe("the buttons respond", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("goes on duty and shows the working screen", async () => {
    const app = await mountApp();
    click(app.querySelector("[data-begin]"));

    expect(app.querySelector(".maplayer")).not.toBeNull();
    expect(app.querySelector(".sheet")).not.toBeNull();
    expect(app.querySelector(".sheet-action")).not.toBeNull();
  });

  it("cycles the sheet when the grabber is tapped", async () => {
    const app = await mountApp();
    click(app.querySelector("[data-begin]"));

    const height = () => app.querySelector(".sheet")?.className ?? "";
    const first = height();
    click(app.querySelector("[data-sheet]"));
    expect(height()).not.toBe(first);
  });

  it("books a slot when its row is clicked anywhere, not just the radio", async () => {
    const app = await mountApp();
    const row = app.querySelector('[data-slot="evening"]');
    expect(row).not.toBeNull();

    // Click the label's text, which is what a thumb actually hits.
    click(row?.querySelector(".slotbody") ?? row);
    click(app.querySelector("[data-begin]"));

    expect(app.innerHTML).toContain("Dinner rush");
  });

  it("advances the clock when a ride is taken", async () => {
    const app = await mountApp();
    click(app.querySelector("[data-begin]"));

    const clockText = () => app.querySelector(".bub-sub")?.textContent ?? "";
    const before = clockText();
    click(app.querySelector("[data-wait]"));
    expect(clockText()).not.toBe(before);
  });

  it("ends the day and offers another", async () => {
    const app = await mountApp();
    click(app.querySelector("[data-begin]"));
    click(app.querySelector("[data-end]"));

    expect(app.querySelector(".summary")).not.toBeNull();
    click(app.querySelector("[data-restart]"));
    expect(app.querySelector("[data-begin]")).not.toBeNull();
  });

  /**
   * Hovering an offer used to trigger a full repaint, which replaced the scroll
   * container and dumped the player back at the top of the sheet — so reaching
   * for Accept scrolled the button out from under the cursor. Only the map
   * depends on the hover, so only the map may be redrawn.
   */
  it("does not rebuild the sheet when an offer is hovered", async () => {
    const app = await mountApp();
    click(app.querySelector("[data-begin]"));

    const scroller = app.querySelector(".sheet-scroll");
    const offer = app.querySelector("[data-preview]");
    if (!offer || !scroller) return; // no offers in the queue on this seed

    offer.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));

    // Same node, not a replacement — identity is what scroll position rides on.
    expect(app.querySelector(".sheet-scroll")).toBe(scroller);
  });

  it("keeps the reader's place in the sheet across a repaint", async () => {
    const app = await mountApp();
    click(app.querySelector("[data-begin]"));

    const scroller = app.querySelector(".sheet-scroll");
    if (!scroller) throw new Error("no sheet to scroll");
    scroller.scrollTop = 120;

    // Any action that repaints the whole app.
    click(app.querySelector("[data-wait]"));

    expect(app.querySelector(".sheet-scroll")?.scrollTop).toBe(120);
  });

  /** A render loop would hang the test rather than fail it, so bound it. */
  it("does not re-enter render on a repaint", async () => {
    const app = await mountApp();
    click(app.querySelector("[data-begin]"));
    for (let i = 0; i < 12; i++) click(app.querySelector("[data-sheet]"));
    expect(app.querySelector(".sheet")).not.toBeNull();
  });
});
