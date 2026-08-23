/**
 * Balance harness. Sweeps one economy parameter and reports what it does to
 * throughput, take-home and milestone reach rates.
 *
 *   npx tsx tools/sweep.ts
 *
 * This is the tool that makes economy tuning an afternoon instead of a month.
 * Not part of the build; nothing imports it.
 */
import { runMany } from "../src/sim/bot.js";
import { DEFAULT_CONFIG } from "../src/sim/config.js";

const SHIFTS = 400;

console.log("\n  offer gap sweep — selective policy, 400 shifts each\n");
console.log("  gap  orders  onTime    net   ₹/hr    12%    20%    28%   mile share");

for (const gap of [13, 15, 17, 19, 21, 24]) {
  const cfg = { ...DEFAULT_CONFIG, offerIntervalMean: gap };
  const a = runMany(SHIFTS, cfg, "selective");
  const n = a.shifts;
  const pct = (x: number) => `${((x / n) * 100).toFixed(0)}%`;
  console.log(
    `  ${String(gap).padStart(3)}  ${(a.delivered / n).toFixed(1).padStart(6)}  ` +
      `${(a.onTime / n).toFixed(1).padStart(6)}  ` +
      `${Math.round(a.net / n).toString().padStart(5)}  ` +
      `${(a.net / n / (cfg.dayMinutes / 60)).toFixed(0).padStart(5)}  ` +
      `${pct(a.hits[0] ?? 0).padStart(5)}  ${pct(a.hits[1] ?? 0).padStart(5)}  ${pct(a.hits[2] ?? 0).padStart(5)}  ` +
      `${((a.milestones / a.net) * 100).toFixed(0)}%`,
  );
}
console.log("");
