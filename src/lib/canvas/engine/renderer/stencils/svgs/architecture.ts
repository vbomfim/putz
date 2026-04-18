/**
 * Architecture category SVG icons for the stencil catalog.
 *
 * Fifteen monochrome line-art icons (64×64 viewBox) for
 * software architecture diagrams: microservices, gateways,
 * messaging, compute patterns, and client types.
 *
 * @module
 */

// ── Service Patterns ─────────────────────────────────────

/** Microservice — hexagon with code lines. */
export const MICROSERVICE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <polygon points="32,4 56,18 56,46 32,60 8,46 8,18" />
  <line x1="20" y1="26" x2="44" y2="26" />
  <line x1="20" y1="34" x2="40" y2="34" />
  <line x1="20" y1="42" x2="36" y2="42" />
</svg>`;

/** API Gateway — gateway arch with routing arrows. */
export const API_GATEWAY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="22" y="8" width="20" height="48" rx="3" />
  <line x1="6" y1="20" x2="22" y2="20" />
  <polygon points="6,20 12,16 12,24" fill="currentColor" stroke="none" />
  <line x1="42" y1="20" x2="58" y2="20" />
  <polygon points="58,20 52,16 52,24" fill="currentColor" stroke="none" />
  <line x1="6" y1="32" x2="22" y2="32" />
  <polygon points="6,32 12,28 12,36" fill="currentColor" stroke="none" />
  <line x1="42" y1="32" x2="58" y2="32" />
  <polygon points="58,32 52,28 52,36" fill="currentColor" stroke="none" />
  <line x1="6" y1="44" x2="22" y2="44" />
  <polygon points="6,44 12,40 12,48" fill="currentColor" stroke="none" />
  <line x1="42" y1="44" x2="58" y2="44" />
  <polygon points="58,44 52,40 52,48" fill="currentColor" stroke="none" />
</svg>`;

/** Message Queue — sequential boxes with arrow. */
export const MESSAGE_QUEUE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="4" y="20" width="14" height="24" rx="2" />
  <rect x="22" y="20" width="14" height="24" rx="2" />
  <rect x="40" y="20" width="14" height="24" rx="2" />
  <line x1="54" y1="32" x2="62" y2="32" />
  <polygon points="62,32 57,28 57,36" fill="currentColor" stroke="none" />
  <line x1="11" y1="28" x2="11" y2="36" stroke-width="1.5" />
  <line x1="29" y1="28" x2="29" y2="36" stroke-width="1.5" />
  <line x1="47" y1="28" x2="47" y2="36" stroke-width="1.5" />
</svg>`;

// ── Data & Storage ───────────────────────────────────────

/** Database (generic) — cylinder with rings. */
export const DATABASE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <ellipse cx="32" cy="14" rx="20" ry="8" />
  <path d="M12 14 v36 c0 4.4 9 8 20 8 s20-3.6 20-8 V14" />
  <path d="M12 28 c0 4.4 9 8 20 8 s20-3.6 20-8" />
  <path d="M12 42 c0 4.4 9 8 20 8 s20-3.6 20-8" />
</svg>`;

/** Cache — lightning bolt on storage block. */
export const CACHE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="8" y="14" width="48" height="40" rx="4" />
  <line x1="8" y1="30" x2="56" y2="30" />
  <polygon points="36,18 26,32 34,32 28,50 42,30 34,30 36,18" fill="currentColor" opacity="0.15" />
  <path d="M36 18 L26 32 H34 L28 50" stroke-width="2.5" stroke-linejoin="round" />
</svg>`;

/** CDN — globe with edge nodes. */
export const CDN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="32" cy="32" r="16" />
  <ellipse cx="32" cy="32" rx="16" ry="8" />
  <line x1="32" y1="16" x2="32" y2="48" />
  <circle cx="12" cy="14" r="5" fill="currentColor" opacity="0.1" />
  <circle cx="12" cy="14" r="5" />
  <circle cx="52" cy="14" r="5" fill="currentColor" opacity="0.1" />
  <circle cx="52" cy="14" r="5" />
  <circle cx="12" cy="50" r="5" fill="currentColor" opacity="0.1" />
  <circle cx="12" cy="50" r="5" />
  <circle cx="52" cy="50" r="5" fill="currentColor" opacity="0.1" />
  <circle cx="52" cy="50" r="5" />
</svg>`;

// ── Compute Patterns ─────────────────────────────────────

/** Load Balancer — scale balance with traffic. */
export const LOAD_BALANCER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <line x1="32" y1="8" x2="32" y2="56" />
  <line x1="12" y1="24" x2="52" y2="24" />
  <line x1="12" y1="24" x2="12" y2="36" />
  <line x1="52" y1="24" x2="52" y2="36" />
  <path d="M4 36 L12 36 L20 36" />
  <path d="M44 36 L52 36 L60 36" />
  <polygon points="32,8 28,14 36,14" fill="currentColor" stroke="none" />
  <rect x="4" y="36" width="16" height="10" rx="2" />
  <rect x="44" y="36" width="16" height="10" rx="2" />
  <line x1="24" y1="56" x2="40" y2="56" />
</svg>`;

/** Container — box-in-box (Docker-style). */
export const CONTAINER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="6" y="10" width="52" height="44" rx="4" />
  <rect x="12" y="22" width="12" height="10" rx="1" />
  <rect x="26" y="22" width="12" height="10" rx="1" />
  <rect x="40" y="22" width="12" height="10" rx="1" />
  <rect x="12" y="34" width="12" height="10" rx="1" />
  <rect x="26" y="34" width="12" height="10" rx="1" />
  <rect x="40" y="34" width="12" height="10" rx="1" />
  <line x1="12" y1="16" x2="20" y2="16" stroke-width="3" stroke-linecap="round" />
</svg>`;

/** Serverless — lambda symbol in rounded frame. */
export const SERVERLESS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="8" y="8" width="48" height="48" rx="12" />
  <path d="M20 46 L30 18 H34 L38 30 L44 18" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M38 30 L30 46 H20" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
</svg>`;

// ── Client Types ─────────────────────────────────────────

/** Client/Browser — browser window. */
export const CLIENT_BROWSER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="4" y="8" width="56" height="48" rx="4" />
  <line x1="4" y1="22" x2="60" y2="22" />
  <circle cx="12" cy="15" r="2" fill="currentColor" />
  <circle cx="20" cy="15" r="2" fill="currentColor" />
  <circle cx="28" cy="15" r="2" fill="currentColor" />
  <rect x="34" y="12" width="22" height="6" rx="2" />
</svg>`;

/** Mobile App — smartphone outline. */
export const MOBILE_APP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="16" y="4" width="32" height="56" rx="4" />
  <line x1="16" y1="14" x2="48" y2="14" />
  <line x1="16" y1="50" x2="48" y2="50" />
  <circle cx="32" cy="55" r="2" fill="currentColor" />
  <circle cx="32" cy="9" r="1" fill="currentColor" />
</svg>`;

/** Desktop — monitor with stand. */
export const DESKTOP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="6" y="6" width="52" height="36" rx="3" />
  <line x1="6" y1="34" x2="58" y2="34" />
  <line x1="32" y1="42" x2="32" y2="52" />
  <line x1="20" y1="52" x2="44" y2="52" />
  <rect x="22" y="52" width="20" height="4" rx="1" />
</svg>`;

// ── Infrastructure ───────────────────────────────────────

/** Cloud (generic) — cloud outline. */
export const CLOUD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M16 44 C6 44 4 34 10 28 C6 20 14 12 22 16 C26 8 38 6 44 14 C50 10 58 16 56 24 C62 26 62 38 54 40 C56 46 48 48 44 44 Z" fill="currentColor" opacity="0.05" />
  <path d="M16 44 C6 44 4 34 10 28 C6 20 14 12 22 16 C26 8 38 6 44 14 C50 10 58 16 56 24 C62 26 62 38 54 40 C56 46 48 48 44 44 Z" />
</svg>`;

/** On-Premise Server — rack server with "on-prem" styling. */
export const ON_PREMISE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="10" y="8" width="44" height="48" rx="3" />
  <line x1="10" y1="22" x2="54" y2="22" />
  <line x1="10" y1="36" x2="54" y2="36" />
  <circle cx="18" cy="15" r="2" fill="currentColor" />
  <line x1="26" y1="15" x2="46" y2="15" />
  <circle cx="18" cy="29" r="2" fill="currentColor" />
  <line x1="26" y1="29" x2="46" y2="29" />
  <circle cx="18" cy="43" r="2" fill="currentColor" />
  <line x1="26" y1="43" x2="46" y2="43" />
  <line x1="26" y1="56" x2="38" y2="56" />
  <line x1="32" y1="56" x2="32" y2="60" />
  <line x1="24" y1="60" x2="40" y2="60" />
</svg>`;

/** Hybrid Cloud — cloud overlapping server. */
export const HYBRID_CLOUD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="4" y="30" width="28" height="28" rx="3" />
  <line x1="4" y1="42" x2="32" y2="42" />
  <circle cx="12" cy="36" r="2" fill="currentColor" />
  <line x1="18" y1="36" x2="28" y2="36" />
  <circle cx="12" cy="48" r="2" fill="currentColor" />
  <line x1="18" y1="48" x2="28" y2="48" />
  <path d="M28 36 C28 28 24 22 30 18 C32 10 42 8 48 14 C52 10 60 14 58 22 C62 24 62 34 56 34 L36 34" fill="currentColor" opacity="0.05" />
  <path d="M28 36 C28 28 24 22 30 18 C32 10 42 8 48 14 C52 10 60 14 58 22 C62 24 62 34 56 34 L36 34" />
</svg>`;
