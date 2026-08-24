/**
 * Inline SVG icons.
 *
 * Drawn here rather than pulled from a library: an icon font is a network
 * request the CSP would have to allow and a payload the game does not need, and
 * emoji render differently on every platform — a fuel pump is a different shape
 * on Android to iOS, which is no use when it has to mean one thing.
 *
 * All 16x16, all `currentColor`, so an icon takes the colour of whatever text
 * it sits beside and never needs a variant per state.
 */

const svg = (path: string, extra = ""): string =>
  `<svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"
     fill="none" stroke="currentColor" stroke-width="1.5"
     stroke-linecap="round" stroke-linejoin="round">${extra}${path}</svg>`;

export const icons = {
  /** Time left on an offer, or a deadline. */
  clock: svg('<circle cx="8" cy="8" r="6.2" /><path d="M8 4.6V8l2.4 1.6" />'),

  /** Fuel. A pump rather than a droplet, which reads as water. */
  fuel: svg(
    '<path d="M3 13.5V3.6A1.1 1.1 0 0 1 4.1 2.5h4.3A1.1 1.1 0 0 1 9.5 3.6v9.9" />' +
      '<path d="M2 13.5h9" /><path d="M4.6 6.2h3.4" />' +
      '<path d="M9.5 6.6h2.2a1 1 0 0 1 1 1V11a1.1 1.1 0 0 0 2.2 0V7.4l-1.7-1.9" />',
  ),

  /** What the rider keeps. A wallet, because it is money in a pocket. */
  wallet: svg(
    '<rect x="1.8" y="4" width="12.4" height="9" rx="1.6" />' +
      '<path d="M1.8 6.6h9.4a1.2 1.2 0 0 1 0 2.4H1.8" />' +
      '<path d="M11.6 4V3a1 1 0 0 0-1.3-1L3 3.6" />',
  ),

  /** Distance covered. */
  route: svg(
    '<circle cx="3.6" cy="3.6" r="1.9" /><circle cx="12.4" cy="12.4" r="1.9" />' +
      '<path d="M3.6 5.5v3.2a3.3 3.3 0 0 0 3.3 3.3h3.6" stroke-dasharray="1.6 1.4" />',
  ),

  /** The bag, and which compartment an order needs. */
  bag: svg(
    '<path d="M3 5.4h10l-.8 8.1a1.1 1.1 0 0 1-1.1 1H4.9a1.1 1.1 0 0 1-1.1-1z" />' +
      '<path d="M5.8 5.4V4a2.2 2.2 0 0 1 4.4 0v1.4" />',
  ),

  /** A detail the player can open. */
  info: svg('<circle cx="8" cy="8" r="6.2" /><path d="M8 7.4v3.6" /><path d="M8 5.1h.01" />'),

  /** Something that needs attention now. */
  alert: svg('<path d="M8 2.4 15 13.6H1z" /><path d="M8 6.6v3" /><path d="M8 11.5h.01" />'),

  /** Money in general — a rupee, since that is the currency. */
  rupee: svg('<path d="M5 3h6" /><path d="M5 6.2h6" /><path d="M10.2 3c0 2.4-1.6 3.2-3.4 3.2H5l5.4 6.8" />'),
};

/** An icon with a label beside it, so the pairing is consistent everywhere. */
export function withIcon(name: keyof typeof icons, label: string, cls = ""): string {
  return `<span class="iconline ${cls}">${icons[name]}<span>${label}</span></span>`;
}
