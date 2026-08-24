export const rupees = (n: number): string => `₹${Math.round(n).toLocaleString("en-IN")}`;

export const mins = (n: number): string => `${Math.round(n)} min`;

/** Hours and minutes, the way a person says them: "4h 12m", "47m". */
export const duration = (minutes: number): string => {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

export const esc = (s: string): string =>
  s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c);

/** Colour band for how much time is left before something goes late. */
export function urgency(minutesLeft: number): "late" | "soon" | "ok" {
  if (minutesLeft < 0) return "late";
  if (minutesLeft < 12) return "soon";
  return "ok";
}
