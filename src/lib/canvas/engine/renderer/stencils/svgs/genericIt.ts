/**
 * Generic IT category SVG icons for the stencil catalog.
 *
 * Fifteen monochrome line-art icons (64×64 viewBox) covering
 * common IT hardware devices and peripherals.
 *
 * @module
 */

// ── Computers ────────────────────────────────────────────

/** Desktop Computer — monitor with tower case. */
export const DESKTOP_COMPUTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="4" y="6" width="40" height="30" rx="2" />
  <line x1="4" y1="30" x2="44" y2="30" />
  <line x1="24" y1="36" x2="24" y2="42" />
  <line x1="14" y1="42" x2="34" y2="42" />
  <rect x="50" y="6" width="10" height="36" rx="2" />
  <circle cx="55" cy="12" r="2" fill="currentColor" />
  <line x1="52" y1="20" x2="58" y2="20" />
  <rect x="52" y="34" width="6" height="4" rx="1" fill="currentColor" opacity="0.2" />
</svg>`;

/** Laptop — open laptop shape. */
export const LAPTOP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="12" y="8" width="40" height="30" rx="2" />
  <line x1="12" y1="32" x2="52" y2="32" />
  <path d="M8 42 L12 38 H52 L56 42 Z" />
  <line x1="6" y1="42" x2="58" y2="42" />
  <circle cx="32" cy="12" r="1" fill="currentColor" />
</svg>`;

/** Tablet — tablet device. */
export const TABLET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="12" y="4" width="40" height="56" rx="4" />
  <line x1="12" y1="12" x2="52" y2="12" />
  <line x1="12" y1="52" x2="52" y2="52" />
  <circle cx="32" cy="56" r="2" fill="currentColor" />
  <circle cx="32" cy="8" r="1" fill="currentColor" />
</svg>`;

/** Smartphone — phone outline. */
export const SMARTPHONE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="18" y="4" width="28" height="56" rx="4" />
  <line x1="18" y1="14" x2="46" y2="14" />
  <line x1="18" y1="50" x2="46" y2="50" />
  <circle cx="32" cy="55" r="2" fill="currentColor" />
  <line x1="28" y1="9" x2="36" y2="9" stroke-linecap="round" />
</svg>`;

// ── Servers & Storage ────────────────────────────────────

/** Server — rack-mount server unit. */
export const SERVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="8" y="8" width="48" height="48" rx="3" />
  <line x1="8" y1="24" x2="56" y2="24" />
  <line x1="8" y1="40" x2="56" y2="40" />
  <circle cx="16" cy="16" r="2" fill="currentColor" />
  <line x1="24" y1="16" x2="48" y2="16" />
  <circle cx="16" cy="32" r="2" fill="currentColor" />
  <line x1="24" y1="32" x2="48" y2="32" />
  <circle cx="16" cy="48" r="2" fill="currentColor" />
  <line x1="24" y1="48" x2="48" y2="48" />
</svg>`;

/** Database — cylinder with internal rings. */
export const DATABASE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <ellipse cx="32" cy="14" rx="22" ry="8" />
  <path d="M10 14 v36 c0 4.4 9.8 8 22 8 s22-3.6 22-8 V14" />
  <path d="M10 26 c0 4.4 9.8 8 22 8 s22-3.6 22-8" />
  <path d="M10 38 c0 4.4 9.8 8 22 8 s22-3.6 22-8" />
</svg>`;

/** Storage Array — stacked drive bays. */
export const STORAGE_ARRAY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="6" y="8" width="52" height="48" rx="3" />
  <rect x="12" y="14" width="10" height="14" rx="1" />
  <rect x="24" y="14" width="10" height="14" rx="1" />
  <rect x="36" y="14" width="10" height="14" rx="1" />
  <rect x="48" y="14" width="4" height="14" rx="1" fill="currentColor" opacity="0.15" />
  <rect x="12" y="34" width="10" height="14" rx="1" />
  <rect x="24" y="34" width="10" height="14" rx="1" />
  <rect x="36" y="34" width="10" height="14" rx="1" />
  <rect x="48" y="34" width="4" height="14" rx="1" fill="currentColor" opacity="0.15" />
</svg>`;

// ── Peripherals ──────────────────────────────────────────

/** Printer — printer with output tray. */
export const PRINTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="6" y="22" width="52" height="24" rx="3" />
  <rect x="14" y="6" width="36" height="16" rx="2" />
  <rect x="14" y="46" width="36" height="14" rx="2" />
  <line x1="20" y1="52" x2="44" y2="52" />
  <line x1="20" y1="56" x2="38" y2="56" />
  <circle cx="48" cy="30" r="2" fill="currentColor" />
</svg>`;

/** Scanner — flatbed scanner. */
export const SCANNER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="6" y="28" width="52" height="24" rx="3" />
  <path d="M10 28 L10 16 C10 12 14 10 18 10 H46 C50 10 54 12 54 16 L54 28" />
  <line x1="14" y1="36" x2="50" y2="36" stroke-width="1.5" />
  <rect x="14" y="40" width="36" height="6" rx="1" fill="currentColor" opacity="0.08" />
  <circle cx="48" cy="46" r="2" fill="currentColor" />
</svg>`;

/** Monitor — standalone display. */
export const MONITOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="4" y="6" width="56" height="38" rx="3" />
  <line x1="4" y1="36" x2="60" y2="36" />
  <line x1="32" y1="44" x2="32" y2="52" />
  <line x1="20" y1="52" x2="44" y2="52" />
  <rect x="20" y="52" width="24" height="4" rx="1" />
</svg>`;

// ── Storage Devices ──────────────────────────────────────

/** USB Drive — small USB stick. */
export const USB_DRIVE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="16" y="10" width="32" height="38" rx="4" />
  <rect x="22" y="48" width="20" height="8" rx="1" />
  <rect x="24" y="50" width="6" height="4" rx="1" fill="currentColor" opacity="0.2" />
  <rect x="34" y="50" width="6" height="4" rx="1" fill="currentColor" opacity="0.2" />
  <circle cx="32" cy="22" r="4" fill="currentColor" opacity="0.15" />
  <circle cx="32" cy="22" r="4" />
  <line x1="26" y1="34" x2="38" y2="34" />
</svg>`;

/** Hard Drive — HDD with platter detail. */
export const HARD_DRIVE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="6" y="12" width="52" height="40" rx="4" />
  <circle cx="28" cy="32" r="14" />
  <circle cx="28" cy="32" r="4" fill="currentColor" opacity="0.2" />
  <line x1="32" y1="28" x2="42" y2="18" stroke-width="1.5" />
  <circle cx="50" cy="44" r="3" fill="currentColor" opacity="0.15" />
</svg>`;

/** SSD — solid-state drive chip. */
export const SSD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="8" y="14" width="48" height="36" rx="3" />
  <rect x="16" y="22" width="14" height="10" rx="1" fill="currentColor" opacity="0.1" />
  <rect x="34" y="22" width="14" height="10" rx="1" fill="currentColor" opacity="0.1" />
  <rect x="16" y="22" width="14" height="10" rx="1" />
  <rect x="34" y="22" width="14" height="10" rx="1" />
  <line x1="16" y1="38" x2="48" y2="38" />
  <circle cx="20" cy="42" r="2" fill="currentColor" />
  <circle cx="28" cy="42" r="2" fill="currentColor" />
  <line x1="16" y1="50" x2="24" y2="56" />
  <line x1="24" y1="50" x2="32" y2="56" />
  <line x1="32" y1="50" x2="40" y2="56" />
  <line x1="40" y1="50" x2="48" y2="56" />
</svg>`;

// ── Accessories ──────────────────────────────────────────

/** Headset — headphones with mic. */
export const HEADSET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M14 36 V28 C14 18 22 8 32 8 C42 8 50 18 50 28 V36" />
  <rect x="8" y="34" width="10" height="16" rx="3" />
  <rect x="46" y="34" width="10" height="16" rx="3" />
  <path d="M46 50 C46 56 40 58 36 58" />
  <rect x="30" y="54" width="8" height="6" rx="2" />
</svg>`;

/** Webcam — camera lens on mount. */
export const WEBCAM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="32" cy="24" r="16" />
  <circle cx="32" cy="24" r="8" fill="currentColor" opacity="0.1" />
  <circle cx="32" cy="24" r="8" />
  <circle cx="32" cy="24" r="3" fill="currentColor" />
  <line x1="32" y1="40" x2="32" y2="50" />
  <rect x="20" y="50" width="24" height="6" rx="2" />
</svg>`;
