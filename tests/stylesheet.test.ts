import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Stylesheet hygiene.
 *
 * The previous stylesheet accumulated 57 duplicated class names and eleven
 * orphaned rule sets through repeated append-and-delete edits. The visible
 * symptom was the start screen collapsing into unreadable overlap, because
 * `.slot` had been declared twice — once as a 9x12 pip for bag compartments and
 * once as a three-column row — and the pip's fixed box won.
 *
 * Nothing in the type checker, the build or the other 170 tests could see it.
 * These can.
 */

const css = readFileSync("src/style.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });
}

/** Every class name the markup actually asks for, template noise stripped out. */
function classesInMarkup(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles("src")) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/class="([^"]*)"/g)) {
      const value = match[1] ?? "";
      // A class attribute containing a template expression is captured
      // truncated at the expression's own quote, so everything from the first
      // `${` onward is fragments of TypeScript, not class names. Cut there.
      const literal = value.split("${")[0] ?? "";
      for (const token of literal.split(/\s+/)) {
        if (/^[a-z][a-z0-9-]*$/i.test(token)) found.add(token);
      }
    }
  }
  return found;
}

describe("the stylesheet", () => {
  it("declares every selector exactly once", () => {
    const selectors = [...css.matchAll(/([^{}]+)\{/g)]
      .map((m) => m[1]!.trim().replace(/\s+/g, " "))
      .filter((s) => s && !s.startsWith("@") && s !== ":root" && s !== "*");

    const seen = new Map<string, number>();
    for (const s of selectors) seen.set(s, (seen.get(s) ?? 0) + 1);
    const duplicated = [...seen].filter(([, n]) => n > 1).map(([s]) => s);

    expect(duplicated).toEqual([]);
  });

  /**
   * A class doing two unrelated jobs is how the start screen broke. Any name
   * used for both a layout row and a decorative pip will collide sooner or
   * later, so the pip names carry their own prefix.
   */
  it("keeps bag pips off the class used for bookable windows", () => {
    expect(css).toContain(".bagpip");
    expect(css).not.toMatch(/^\.slot\.(hot|cold|full)/m);
  });

  it("styles every class the markup asks for", () => {
    const styled = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]!));
    // SVG grouping elements are structural hooks with nothing to style.
    const structural = new Set(["roads", "legs", "nodes", "rs-km", "rs-eta"]);

    const orphans = [...classesInMarkup()].filter(
      (c) => !styled.has(c) && !structural.has(c),
    );
    expect(orphans).toEqual([]);
  });

  it("has no rule for markup that no longer exists", () => {
    const used = classesInMarkup();
    // Names generated inside template expressions, which the scan cannot see.
    const dynamic = new Set([
      "peek", "half", "full", "on", "busy", "picked", "inslot", "major", "solid",
      "ok", "soon", "late", "done", "easy", "tight", "risky", "no", "thin", "low",
      "flag", "newest", "hot", "cold", "warm", "bad", "good", "close", "held",
      "red", "green", "pending", "here", "node", "pv-pickup", "pv-drop", "EXPRESS",
      "STANDARD", "SCHEDULED", "wide", "free", "out", "clip", "riding",
    ]);

    const declared = [...css.matchAll(/^\.([a-zA-Z][\w-]*)/gm)].map((m) => m[1]!);
    const unused = [...new Set(declared)].filter((c) => !used.has(c) && !dynamic.has(c));

    expect(unused).toEqual([]);
  });
});
