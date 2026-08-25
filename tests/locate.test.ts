import { describe, expect, it } from "vitest";
import { NODES, insideZone, nearestNode, node, project } from "../src/sim/city.js";
import { renderMap } from "../src/ui/map.js";
import { createShift } from "../src/sim/shift.js";
import { locateMessage } from "../src/ui/locate.js";

/** Real coordinates of places inside and well outside the play zone. */
const SUSHANT_LOK = { lat: 28.467, lon: 77.082 };
const CYBER_HUB = { lat: 28.4949, lon: 77.0895 };
const BENGALURU = { lat: 12.9716, lon: 77.5946 };
const LONDON = { lat: 51.5072, lon: -0.1276 };

describe("nearestNode", () => {
  it("lands on the dark store when standing at the dark store", () => {
    const { node: n, km } = nearestNode(SUSHANT_LOK.lat, SUSHANT_LOK.lon);
    expect(n.id).toBe("qk");
    expect(km).toBeLessThan(0.2);
  });

  /**
   * Asserts the actual contract rather than a list of ids. The list had to be
   * edited the moment Cyber Hub gained venues of its own, which means it was
   * testing the fixture rather than the function.
   */
  it("picks the genuinely closest node, from anywhere in the zone", () => {
    for (const at of [CYBER_HUB, SUSHANT_LOK]) {
      const { node: n, km } = nearestNode(at.lat, at.lon);
      const here = project(at.lat, at.lon);
      const closest = Math.min(
        ...NODES.map((x) => Math.hypot(x.x - here.x, x.y - here.y)),
      );
      expect(km).toBeCloseTo(closest, 6);
      expect(NODES.some((x) => x.id === n.id)).toBe(true);
    }
  });

  it("still returns a node from the other side of the country", () => {
    const { node: n, km } = nearestNode(BENGALURU.lat, BENGALURU.lon);
    expect(NODES.some((x) => x.id === n.id)).toBe(true);
    expect(km).toBeGreaterThan(100);
  });

  it("never returns a node that is not on the map", () => {
    for (const p of [SUSHANT_LOK, CYBER_HUB, BENGALURU, LONDON]) {
      expect(() => node(nearestNode(p.lat, p.lon).node.id)).not.toThrow();
    }
  });
});

describe("insideZone", () => {
  it("accepts positions within the play area", () => {
    expect(insideZone(SUSHANT_LOK.lat, SUSHANT_LOK.lon)).toBe(true);
    expect(insideZone(CYBER_HUB.lat, CYBER_HUB.lon)).toBe(true);
  });

  it("rejects anywhere else", () => {
    expect(insideZone(BENGALURU.lat, BENGALURU.lon)).toBe(false);
    expect(insideZone(LONDON.lat, LONDON.lon)).toBe(false);
  });
});

describe("project", () => {
  it("puts north above south and east right of west", () => {
    const north = project(28.5, 77.06);
    const south = project(28.43, 77.06);
    expect(north.y).toBeLessThan(south.y);

    const east = project(28.46, 77.1);
    const west = project(28.46, 77.04);
    expect(east.x).toBeGreaterThan(west.x);
  });
});

describe("locateMessage", () => {
  /**
   * Every failure path has to read as a sentence a person would say and let the
   * day start regardless. Location is a convenience, never a gate.
   */
  it("says something usable for every outcome", () => {
    const outcomes = [
      { kind: "located", nodeId: "qk", nodeName: "QuickKart", kmAway: 0.1, inZone: true },
      { kind: "located", nodeId: "qk", nodeName: "QuickKart", kmAway: 1600, inZone: false },
      { kind: "denied" },
      { kind: "timeout" },
      { kind: "unavailable" },
    ] as const;

    for (const outcome of outcomes) {
      const message = locateMessage(outcome);
      expect(message.length).toBeGreaterThan(10);
      expect(message).toMatch(/\.$/);
    }
  });

  it("admits when the player is nowhere near the zone", () => {
    const message = locateMessage({
      kind: "located",
      nodeId: "qk",
      nodeName: "QuickKart",
      kmAway: 1600,
      inZone: false,
    });
    expect(message).toContain("1600 km");
  });
});

describe("map labels", () => {
  /**
   * Twelve place names on a nine-kilometre map will collide unless placed
   * deliberately. Anything overlapping is dropped rather than drawn on top of
   * its neighbour, so the count is allowed to be lower than the node count —
   * but the label for wherever the rider is standing must always survive.
   */
  it("never draws two labels on top of each other", () => {
    const s = createShift(3);
    const svg = renderMap(s, null);

    const ys = [...svg.matchAll(/class="name" x="(-?[\d.]+)" y="(-?[\d.]+)"/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));

    for (let i = 0; i < ys.length; i++) {
      for (let j = i + 1; j < ys.length; j++) {
        const a = ys[i]!;
        const b = ys[j]!;
        const overlapping = Math.abs(a.y - b.y) < 0.6 && Math.abs(a.x - b.x) < 2.2;
        expect(overlapping).toBe(false);
      }
    }
  });

  it("always labels where the rider is standing", () => {
    const s = createShift(3);
    expect(renderMap(s, null)).toContain(node(s.locationId).name);
  });
});
