export const rupees = (n: number): string => `₹${Math.round(n).toLocaleString("en-IN")}`;

export const mins = (n: number): string => `${Math.round(n)} min`;

export const esc = (s: string): string =>
  s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c);

/** Colour band for how much time is left before something goes late. */
export function urgency(minutesLeft: number): "late" | "soon" | "ok" {
  if (minutesLeft < 0) return "late";
  if (minutesLeft < 12) return "soon";
  return "ok";
}
