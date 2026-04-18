/**
 * Network category SVG icons for the stencil catalog.
 *
 * Fifteen monochrome line-art icons (64×64 viewBox) covering core
 * networking infrastructure: routing, switching, security,
 * wireless, and connectivity devices.
 *
 * @module
 */

// ── Routing & Switching ──────────────────────────────────

/** Router — chassis with four directional arrows. */
export const ROUTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="16" y="16" width="32" height="32" rx="4" />
  <circle cx="32" cy="32" r="5" fill="currentColor" opacity="0.2" />
  <line x1="32" y1="6" x2="32" y2="16" />
  <polygon points="32,4 28,10 36,10" fill="currentColor" stroke="none" />
  <line x1="32" y1="48" x2="32" y2="58" />
  <polygon points="32,60 28,54 36,54" fill="currentColor" stroke="none" />
  <line x1="6" y1="32" x2="16" y2="32" />
  <polygon points="4,32 10,28 10,36" fill="currentColor" stroke="none" />
  <line x1="48" y1="32" x2="58" y2="32" />
  <polygon points="60,32 54,28 54,36" fill="currentColor" stroke="none" />
</svg>`;

/** Switch — wide chassis with port indicators. */
export const SWITCH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="4" y="20" width="56" height="24" rx="3" />
  <rect x="10" y="26" width="6" height="6" rx="1" />
  <rect x="19" y="26" width="6" height="6" rx="1" />
  <rect x="28" y="26" width="6" height="6" rx="1" />
  <rect x="37" y="26" width="6" height="6" rx="1" />
  <rect x="46" y="26" width="6" height="6" rx="1" />
  <circle cx="13" cy="38" r="1.5" fill="currentColor" />
  <circle cx="22" cy="38" r="1.5" fill="currentColor" />
  <circle cx="31" cy="38" r="1.5" fill="currentColor" />
  <circle cx="40" cy="38" r="1.5" fill="currentColor" />
  <circle cx="49" cy="38" r="1.5" fill="currentColor" />
</svg>`;

/** Hub — central circle with radiating spokes. */
export const HUB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="32" cy="32" r="10" />
  <circle cx="32" cy="32" r="3" fill="currentColor" opacity="0.3" />
  <line x1="32" y1="22" x2="32" y2="8" />
  <circle cx="32" cy="6" r="3" />
  <line x1="32" y1="42" x2="32" y2="56" />
  <circle cx="32" cy="58" r="3" />
  <line x1="23" y1="27" x2="13" y2="17" />
  <circle cx="11" cy="15" r="3" />
  <line x1="41" y1="27" x2="51" y2="17" />
  <circle cx="53" cy="15" r="3" />
  <line x1="23" y1="37" x2="13" y2="47" />
  <circle cx="11" cy="49" r="3" />
  <line x1="41" y1="37" x2="51" y2="47" />
  <circle cx="53" cy="49" r="3" />
</svg>`;

/** Bridge — two network segments connected by a bar. */
export const BRIDGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="4" y="22" width="20" height="20" rx="3" />
  <rect x="40" y="22" width="20" height="20" rx="3" />
  <line x1="24" y1="32" x2="40" y2="32" />
  <circle cx="14" cy="32" r="4" fill="currentColor" opacity="0.2" />
  <circle cx="50" cy="32" r="4" fill="currentColor" opacity="0.2" />
  <line x1="32" y1="28" x2="32" y2="36" />
  <line x1="30" y1="28" x2="34" y2="28" />
  <line x1="30" y1="36" x2="34" y2="36" />
</svg>`;

/** Gateway — trapezoid shape with bidirectional arrow. */
export const GATEWAY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M16 14 H48 L54 50 H10 Z" />
  <line x1="22" y1="30" x2="42" y2="30" />
  <polygon points="42,30 38,26 38,34" fill="currentColor" stroke="none" />
  <polygon points="22,30 26,26 26,34" fill="currentColor" stroke="none" />
  <line x1="32" y1="18" x2="32" y2="24" />
  <line x1="32" y1="36" x2="32" y2="46" />
</svg>`;

// ── Security & Traffic ───────────────────────────────────

/** Firewall (generic) — shield with brick-wall pattern. */
export const FIREWALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M32 4 L8 16 V36 C8 48 18 56 32 60 C46 56 56 48 56 36 V16 Z" />
  <line x1="16" y1="26" x2="48" y2="26" />
  <line x1="16" y1="36" x2="48" y2="36" />
  <line x1="16" y1="46" x2="48" y2="46" />
  <line x1="32" y1="16" x2="32" y2="26" />
  <line x1="24" y1="26" x2="24" y2="36" />
  <line x1="40" y1="26" x2="40" y2="36" />
  <line x1="32" y1="36" x2="32" y2="46" />
</svg>`;

/** Load Balancer — split arrows distributing traffic. */
export const LOAD_BALANCER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="32" cy="12" r="8" />
  <path d="M28 16 L32 12 L36 16" stroke-width="2.5" />
  <line x1="32" y1="20" x2="32" y2="28" />
  <line x1="32" y1="28" x2="14" y2="42" />
  <line x1="32" y1="28" x2="32" y2="42" />
  <line x1="32" y1="28" x2="50" y2="42" />
  <rect x="6" y="42" width="16" height="14" rx="2" />
  <rect x="24" y="42" width="16" height="14" rx="2" />
  <rect x="42" y="42" width="16" height="14" rx="2" />
</svg>`;

/** Proxy — intermediary relay box with pass-through arrow. */
export const PROXY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="16" y="14" width="32" height="36" rx="4" />
  <line x1="4" y1="32" x2="16" y2="32" />
  <polygon points="4,32 10,28 10,36" fill="currentColor" stroke="none" />
  <line x1="48" y1="32" x2="60" y2="32" />
  <polygon points="60,32 54,28 54,36" fill="currentColor" stroke="none" />
  <circle cx="32" cy="26" r="4" fill="currentColor" opacity="0.15" />
  <line x1="24" y1="36" x2="40" y2="36" />
  <line x1="24" y1="42" x2="36" y2="42" />
</svg>`;

// ── Wireless & Connectivity ──────────────────────────────

/** Wireless AP — base with radio waves. */
export const WIRELESS_AP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="20" y="42" width="24" height="14" rx="3" />
  <circle cx="32" cy="49" r="2" fill="currentColor" />
  <line x1="32" y1="42" x2="32" y2="34" />
  <path d="M22 30 C22 22 42 22 42 30" fill="none" />
  <path d="M16 24 C16 12 48 12 48 24" fill="none" />
  <path d="M10 18 C10 2 54 2 54 18" fill="none" />
</svg>`;

/** Antenna — tall mast with signal rings. */
export const ANTENNA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <line x1="32" y1="8" x2="32" y2="56" />
  <line x1="24" y1="56" x2="40" y2="56" />
  <line x1="22" y1="28" x2="32" y2="18" />
  <line x1="42" y1="28" x2="32" y2="18" />
  <line x1="26" y1="38" x2="32" y2="30" />
  <line x1="38" y1="38" x2="32" y2="30" />
  <path d="M18 12 C18 4 32 4 32 8" fill="none" />
  <path d="M46 12 C46 4 32 4 32 8" fill="none" />
  <circle cx="32" cy="8" r="3" fill="currentColor" opacity="0.3" />
</svg>`;

/** Satellite — orbiting dish. */
export const SATELLITE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="24" y="24" width="16" height="16" rx="2" transform="rotate(45 32 32)" />
  <line x1="20" y1="20" x2="10" y2="10" />
  <rect x="4" y="4" width="10" height="10" rx="2" />
  <line x1="44" y1="44" x2="54" y2="54" />
  <rect x="50" y="50" width="10" height="10" rx="2" />
  <line x1="22" y1="42" x2="14" y2="50" stroke-width="1.5" />
  <line x1="42" y1="22" x2="50" y2="14" stroke-width="1.5" />
  <circle cx="32" cy="32" r="3" fill="currentColor" opacity="0.3" />
</svg>`;

// ── Physical Infrastructure ──────────────────────────────

/** Modem — box with signal wave. */
export const MODEM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="10" y="18" width="44" height="28" rx="4" />
  <circle cx="20" cy="38" r="2" fill="currentColor" />
  <circle cx="28" cy="38" r="2" fill="currentColor" />
  <path d="M18 26 C22 20 26 32 30 26 C34 20 38 32 42 26 C46 20 50 32 50 26" stroke-width="1.5" />
  <line x1="22" y1="46" x2="22" y2="56" />
  <line x1="42" y1="46" x2="42" y2="56" />
  <line x1="32" y1="8" x2="32" y2="18" />
</svg>`;

/** Patch Panel — rows of labeled ports. */
export const PATCH_PANEL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="4" y="14" width="56" height="36" rx="2" />
  <rect x="10" y="20" width="6" height="6" rx="1" />
  <rect x="19" y="20" width="6" height="6" rx="1" />
  <rect x="28" y="20" width="6" height="6" rx="1" />
  <rect x="37" y="20" width="6" height="6" rx="1" />
  <rect x="46" y="20" width="6" height="6" rx="1" />
  <rect x="10" y="32" width="6" height="6" rx="1" />
  <rect x="19" y="32" width="6" height="6" rx="1" />
  <rect x="28" y="32" width="6" height="6" rx="1" />
  <rect x="37" y="32" width="6" height="6" rx="1" />
  <rect x="46" y="32" width="6" height="6" rx="1" />
  <circle cx="13" cy="44" r="1.5" fill="currentColor" />
  <circle cx="22" cy="44" r="1.5" fill="currentColor" />
</svg>`;

/** Rack — server rack cabinet. */
export const RACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="12" y="4" width="40" height="56" rx="2" />
  <line x1="12" y1="16" x2="52" y2="16" />
  <line x1="12" y1="28" x2="52" y2="28" />
  <line x1="12" y1="40" x2="52" y2="40" />
  <line x1="12" y1="52" x2="52" y2="52" />
  <circle cx="20" cy="10" r="2" fill="currentColor" />
  <line x1="28" y1="10" x2="44" y2="10" />
  <circle cx="20" cy="22" r="2" fill="currentColor" />
  <line x1="28" y1="22" x2="44" y2="22" />
  <circle cx="20" cy="34" r="2" fill="currentColor" />
  <line x1="28" y1="34" x2="44" y2="34" />
  <circle cx="20" cy="46" r="2" fill="currentColor" />
  <line x1="28" y1="46" x2="44" y2="46" />
  <rect x="22" y="52" width="8" height="4" rx="1" fill="currentColor" opacity="0.15" />
  <rect x="34" y="52" width="8" height="4" rx="1" fill="currentColor" opacity="0.15" />
</svg>`;

/** Internet Cloud — fluffy cloud shape. */
export const INTERNET_CLOUD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M18 44 C8 44 4 36 8 30 C4 22 10 14 20 16 C22 8 34 6 40 12 C46 8 56 12 56 22 C62 24 62 36 54 38 C58 46 50 50 44 46 C40 50 28 50 24 46 C22 48 18 46 18 44 Z" fill="currentColor" opacity="0.05" />
  <path d="M18 44 C8 44 4 36 8 30 C4 22 10 14 20 16 C22 8 34 6 40 12 C46 8 56 12 56 22 C62 24 62 36 54 38 C58 46 50 50 44 46 C40 50 28 50 24 46 C22 48 18 46 18 44 Z" />
</svg>`;

/** Server — rack-mount server with drive bays. */
export const SERVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="10" y="6" width="44" height="52" rx="3" />
  <line x1="10" y1="23" x2="54" y2="23" />
  <line x1="10" y1="40" x2="54" y2="40" />
  <circle cx="18" cy="14" r="2" fill="currentColor" />
  <circle cx="18" cy="31" r="2" fill="currentColor" />
  <circle cx="18" cy="48" r="2" fill="currentColor" />
  <line x1="26" y1="14" x2="46" y2="14" />
  <line x1="26" y1="31" x2="46" y2="31" />
  <line x1="26" y1="48" x2="46" y2="48" />
</svg>`;
