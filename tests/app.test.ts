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



});

describe("the map is on demand", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  /**
   * A permanently visible map took half the screen and pushed both the incoming
   * orders and the job in hand into a scroll. Real rider apps show a list while
   * idle and a map only while navigating.
   */
  it("opens and closes as an overlay", async () => {
    const app = await mountApp();
    click(app.querySelector("[data-begin]"));
    expect(app.querySelector(".overlay")).toBeNull();

    click(app.querySelector('[data-overlay="map"]'));
    expect(app.querySelector(".overlay")).not.toBeNull();
    expect(app.querySelector("svg.map")).not.toBeNull();

    click(app.querySelector('[data-overlay="none"]'));
    expect(app.querySelector(".overlay")).toBeNull();
  });

  it("shows order density only on the map screen", async () => {
    const app = await mountApp();
    click(app.querySelector("[data-begin]"));
    click(app.querySelector('[data-overlay="map"]'));
    expect(app.innerHTML).toContain("heatmap");
  });

  it("gives the work list the whole screen", async () => {
    const app = await mountApp();
    click(app.querySelector("[data-begin]"));

    const work = app.querySelector(".work");
    expect(work).not.toBeNull();
    // Orders are in the flow, not inside a resizable sheet.
    expect(work?.querySelector(".offers, .empty")).not.toBeNull();
  });
});
