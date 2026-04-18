/**
 * Security category SVG icons for the stencil catalog.
 *
 * Fifteen monochrome line-art icons (64×64 viewBox) for generic
 * security concepts. Vendor-specific security icons live in their
 * own category files (fortinet.ts, cisco-pro.ts).
 *
 * @module
 */

// ── Authentication & Access ──────────────────────────────

/** Shield — classic security shield. */
export const SHIELD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M32 4 L8 16 V36 C8 48 18 56 32 60 C46 56 56 48 56 36 V16 Z" fill="currentColor" opacity="0.05" />
  <path d="M32 4 L8 16 V36 C8 48 18 56 32 60 C46 56 56 48 56 36 V16 Z" />
  <polyline points="22,32 30,40 44,24" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
</svg>`;

/** Lock — closed padlock. */
export const LOCK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="14" y="28" width="36" height="28" rx="4" />
  <path d="M22 28 V18 a10 10 0 0 1 20 0 v10" />
  <circle cx="32" cy="42" r="4" fill="currentColor" opacity="0.2" />
  <circle cx="32" cy="42" r="4" />
  <line x1="32" y1="46" x2="32" y2="50" stroke-width="2.5" stroke-linecap="round" />
</svg>`;

/** Key — key shape. */
export const KEY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="20" cy="24" r="12" />
  <circle cx="20" cy="24" r="5" fill="currentColor" opacity="0.15" />
  <line x1="30" y1="30" x2="54" y2="54" stroke-width="2.5" />
  <line x1="54" y1="54" x2="54" y2="44" stroke-width="2" />
  <line x1="46" y1="46" x2="46" y2="38" stroke-width="2" />
</svg>`;

/** Padlock (open) — unlocked padlock. */
export const PADLOCK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="14" y="30" width="36" height="26" rx="4" />
  <path d="M22 30 V18 a10 10 0 0 1 20 0 v4" />
  <circle cx="32" cy="43" r="3" fill="currentColor" />
  <line x1="32" y1="46" x2="32" y2="50" stroke-width="2" stroke-linecap="round" />
</svg>`;

// ── Network Security ─────────────────────────────────────

/** Firewall (generic) — wall with flame icon. */
export const FIREWALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="8" y="12" width="48" height="40" rx="3" />
  <line x1="8" y1="32" x2="56" y2="32" />
  <path d="M32 18 C32 18 38 22 38 28 C38 32 32 36 32 36 C32 36 26 32 26 28 C26 22 32 18 32 18Z" fill="currentColor" opacity="0.15" />
  <path d="M32 18 C32 18 38 22 38 28 C38 32 32 36 32 36 C32 36 26 32 26 28 C26 22 32 18 32 18Z" />
  <line x1="20" y1="40" x2="20" y2="46" />
  <line x1="32" y1="40" x2="32" y2="46" />
  <line x1="44" y1="40" x2="44" y2="46" />
</svg>`;

/** VPN — tunnel with shield. */
export const VPN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M8 40 L24 20 H40 L56 40" />
  <line x1="8" y1="40" x2="56" y2="40" />
  <path d="M32 22 L24 30 V38 C24 42 32 46 32 46 C32 46 40 42 40 38 V30 Z" fill="currentColor" opacity="0.1" />
  <path d="M32 22 L24 30 V38 C24 42 32 46 32 46 C32 46 40 42 40 38 V30 Z" />
  <polyline points="29,34 32,37 38,30" stroke-width="2" stroke-linecap="round" />
</svg>`;

/** Encryption — lock with binary pattern. */
export const ENCRYPTION_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="12" y="22" width="40" height="34" rx="4" />
  <path d="M22 22 V14 a10 10 0 0 1 20 0 v8" />
  <text x="18" y="38" font-size="7" font-family="monospace" fill="currentColor" stroke="none">01101</text>
  <text x="18" y="48" font-size="7" font-family="monospace" fill="currentColor" stroke="none">10010</text>
</svg>`;

// ── Identity & Credentials ───────────────────────────────

/** Certificate — document with seal. */
export const CERTIFICATE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="8" y="6" width="36" height="46" rx="2" />
  <line x1="14" y1="16" x2="38" y2="16" />
  <line x1="14" y1="24" x2="38" y2="24" />
  <line x1="14" y1="32" x2="30" y2="32" />
  <circle cx="48" cy="38" r="12" />
  <circle cx="48" cy="38" r="5" fill="currentColor" opacity="0.15" />
  <line x1="44" y1="50" x2="40" y2="58" />
  <line x1="52" y1="50" x2="56" y2="58" />
</svg>`;

/** Token — authentication token/badge. */
export const TOKEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="32" cy="28" r="20" />
  <circle cx="32" cy="28" r="12" />
  <circle cx="32" cy="28" r="4" fill="currentColor" opacity="0.2" />
  <line x1="32" y1="48" x2="32" y2="58" stroke-width="2.5" />
  <line x1="26" y1="54" x2="38" y2="54" stroke-width="2" />
</svg>`;

/** Fingerprint — biometric scanner. */
export const FINGERPRINT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M20 48 C16 42 14 36 14 30 C14 20 22 12 32 12 C42 12 50 20 50 30" stroke-width="2" />
  <path d="M24 46 C22 40 20 36 20 30 C20 24 26 18 32 18 C38 18 44 24 44 30 C44 34 42 38 40 42" stroke-width="2" />
  <path d="M28 44 C27 40 26 36 26 32 C26 28 28 24 32 24 C36 24 38 28 38 32 C38 36 36 40 34 44" stroke-width="2" />
  <path d="M32 42 C32 38 32 34 32 30" stroke-width="2" />
</svg>`;

// ── Monitoring & Compliance ──────────────────────────────

/** Alert/Alarm — warning triangle with exclamation. */
export const ALERT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M32 6 L4 56 H60 Z" fill="currentColor" opacity="0.05" />
  <path d="M32 6 L4 56 H60 Z" />
  <line x1="32" y1="24" x2="32" y2="40" stroke-width="3" stroke-linecap="round" />
  <circle cx="32" cy="48" r="2.5" fill="currentColor" />
</svg>`;

/** Bug/Vulnerability — bug insect. */
export const BUG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <ellipse cx="32" cy="36" rx="14" ry="18" />
  <line x1="32" y1="18" x2="32" y2="54" />
  <line x1="18" y1="30" x2="46" y2="30" />
  <line x1="18" y1="42" x2="46" y2="42" />
  <circle cx="26" cy="24" r="4" />
  <circle cx="38" cy="24" r="4" />
  <line x1="18" y1="26" x2="8" y2="18" />
  <line x1="46" y1="26" x2="56" y2="18" />
  <line x1="18" y1="36" x2="6" y2="36" />
  <line x1="46" y1="36" x2="58" y2="36" />
  <line x1="18" y1="46" x2="8" y2="54" />
  <line x1="46" y1="46" x2="56" y2="54" />
</svg>`;

/** Patch — adhesive patch/band-aid. */
export const PATCH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="4" y="20" width="56" height="24" rx="6" />
  <rect x="22" y="20" width="20" height="24" rx="2" fill="currentColor" opacity="0.08" />
  <circle cx="28" cy="30" r="1.5" fill="currentColor" />
  <circle cx="36" cy="30" r="1.5" fill="currentColor" />
  <circle cx="28" cy="36" r="1.5" fill="currentColor" />
  <circle cx="36" cy="36" r="1.5" fill="currentColor" />
</svg>`;

/** Audit Log — log document with magnifying glass. */
export const AUDIT_LOG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="8" y="6" width="34" height="46" rx="2" />
  <line x1="14" y1="16" x2="36" y2="16" />
  <line x1="14" y1="24" x2="36" y2="24" />
  <line x1="14" y1="32" x2="28" y2="32" />
  <line x1="14" y1="40" x2="24" y2="40" />
  <circle cx="46" cy="42" r="12" />
  <circle cx="46" cy="42" r="6" fill="currentColor" opacity="0.1" />
  <line x1="54" y1="50" x2="60" y2="56" stroke-width="3" stroke-linecap="round" />
</svg>`;

/** Compliance Check — clipboard with checkmarks. */
export const COMPLIANCE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="10" y="8" width="44" height="52" rx="3" />
  <rect x="22" y="4" width="20" height="10" rx="2" fill="currentColor" opacity="0.1" />
  <rect x="22" y="4" width="20" height="10" rx="2" />
  <polyline points="18,26 22,30 30,22" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  <line x1="34" y1="26" x2="46" y2="26" />
  <polyline points="18,38 22,42 30,34" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  <line x1="34" y1="38" x2="46" y2="38" />
  <polyline points="18,50 22,54 30,46" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  <line x1="34" y1="50" x2="46" y2="50" />
</svg>`;

/** Zero Trust — broken chain link. */
export const ZERO_TRUST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="4" y="22" width="22" height="20" rx="10" />
  <rect x="38" y="22" width="22" height="20" rx="10" />
  <line x1="26" y1="28" x2="30" y2="24" stroke-width="2.5" stroke-linecap="round" />
  <line x1="38" y1="36" x2="34" y2="40" stroke-width="2.5" stroke-linecap="round" />
  <circle cx="32" cy="12" r="6" />
  <path d="M32 6 L28 2" stroke-width="2" stroke-linecap="round" />
  <path d="M32 6 L36 2" stroke-width="2" stroke-linecap="round" />
  <path d="M32 18 L32 22" stroke-width="1.5" stroke-dasharray="2 2" />
</svg>`;
