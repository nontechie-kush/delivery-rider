/**
 * The golden run.
 *
 * Replays a fixed set of shifts with a fixed policy and prints a checksum. Any
 * change under src/sim that moves the checksum is an economy change: intended
 * (update the snapshot in the same commit and say what moved) or a regression
 * (revert, do not patch forward). See CLAUDE.md.
 *
 *   npm run golden           check against the snapshot
 *   npm run golden:update    accept the current numbers as the new snapshot
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checksum, runMany, type Aggregate } from "../src/sim/bot.js";
import { DEFAULT_CONFIG } from "../src/sim/config.js";

const SHIFTS = 1000;
const SEED = 42;
const SNAPSHOT = join(dirname(fileURLToPath(import.meta.url)), "golden.snapshot.json");

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const per = (n: number, shifts: number) => (n / shifts).toFixed(2);

function report(label: string, agg: Aggregate): void {
  const pct = (n: number) => `${((n / agg.shifts) * 100).toFixed(1)}%`;
  console.log(`\n  ${label}`);
  console.log(`    orders/shift    ${per(agg.delivered, agg.shifts)}  (${per(agg.onTime, agg.shifts)} on time)`);
  console.log(`    late            ${((agg.late / Math.max(1, agg.delivered)) * 100).toFixed(1)}%`);
  console.log(`    fees/shift      ${rupees(agg.fees / agg.shifts)}`);
  console.log(`    milestone/shift ${rupees(agg.milestones / agg.shifts)}`);
  console.log(`    net/shift       ${rupees(agg.net / agg.shifts)}`);
  console.log(`    waiting/shift   ${per(agg.waiting, agg.shifts)}m  (${per(agg.waitingHidden, agg.shifts)}m never shown)`);
  console.log(
    `    reached 12/20/28  ${agg.hits.map(pct).join("  ")}`,
  );
}

const selective = runMany(SHIFTS, DEFAULT_CONFIG, "selective", SEED);
const greedy = runMany(SHIFTS, DEFAULT_CONFIG, "greedy", SEED);
const solo = runMany(SHIFTS, DEFAULT_CONFIG, "solo", SEED);
const sum = checksum(selective);

console.log(`\n  golden run — seed ${SEED}, ${SHIFTS} shifts`);
report("selective batching", selective);
report("take everything (greedy)", greedy);
report("one at a time (solo)", solo);

const vs = (other: typeof solo) => `${((selective.net / other.net - 1) * 100).toFixed(0)}%`;
console.log(`\n  selective vs greedy  ${vs(greedy)}`);
console.log(`  selective vs solo    ${vs(solo)}`);
console.log(`  checksum             ${sum}\n`);

const update = process.argv.includes("--update");

if (update || !existsSync(SNAPSHOT)) {
  writeFileSync(
    SNAPSHOT,
    `${JSON.stringify({ shifts: SHIFTS, seed: SEED, checksum: sum, selective, greedy, solo }, null, 2)}\n`,
  );
  console.log(`  snapshot ${existsSync(SNAPSHOT) && !update ? "created" : "updated"}\n`);
  process.exit(0);
}

const previous = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as { checksum: string };

if (previous.checksum === sum) {
  console.log("  ✓ matches snapshot\n");
  process.exit(0);
}

console.error(`  ✗ checksum moved: ${previous.checksum} → ${sum}`);
console.error("    An economy change. If intended, run: npm run golden:update");
console.error("    If not, this is a regression — revert, do not patch forward.\n");
process.exit(1);
