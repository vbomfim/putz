/**
 * Fortinet security product SVG icons for the stencil catalog.
 *
 * Twenty monochrome line-art icons (64×64 viewBox) representing
 * key Fortinet security and networking products. Each icon uses
 * `currentColor` for fills/strokes to support theming.
 *
 * @module
 */

/** FortiGate — shield with firewall grid (flagship NGFW). */
export const FORTI_GATE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M32 4L8 16v20c0 14 10 22 24 28 14-6 24-14 24-28V16L32 4z" />
  <line x1="16" y1="24" x2="48" y2="24" />
  <line x1="16" y1="34" x2="48" y2="34" />
  <line x1="16" y1="44" x2="48" y2="44" />
  <line x1="24" y1="16" x2="24" y2="24" />
  <line x1="40" y1="16" x2="40" y2="24" />
  <line x1="32" y1="24" x2="32" y2="34" />
  <line x1="24" y1="34" x2="24" y2="44" />
  <line x1="40" y1="34" x2="40" y2="44" />
</svg>`;

/** FortiSwitch — managed network switch with port array. */
export const FORTI_SWITCH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="4" y="16" width="56" height="32" rx="3" />
  <rect x="10" y="22" width="6" height="8" rx="1" />
  <rect x="19" y="22" width="6" height="8" rx="1" />
  <rect x="28" y="22" width="6" height="8" rx="1" />
  <rect x="37" y="22" width="6" height="8" rx="1" />
  <rect x="46" y="22" width="6" height="8" rx="1" />
  <circle cx="13" cy="40" r="2" fill="currentColor" />
  <circle cx="22" cy="40" r="2" fill="currentColor" />
  <circle cx="31" cy="40" r="2" fill="currentColor" />
  <circle cx="40" cy="40" r="2" fill="currentColor" />
  <circle cx="49" cy="40" r="2" fill="currentColor" />
  <path d="M32 4 L28 12 H36 Z" fill="currentColor" stroke="none" />
  <line x1="32" y1="12" x2="32" y2="16" />
</svg>`;

/** FortiAP — wireless access point with radio waves. */
export const FORTI_AP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="32" cy="40" r="4" fill="currentColor" />
  <line x1="32" y1="44" x2="32" y2="56" />
  <line x1="24" y1="56" x2="40" y2="56" />
  <path d="M22 34 A14 14 0 0 1 42 34" fill="none" />
  <path d="M16 28 A20 20 0 0 1 48 28" fill="none" />
  <path d="M10 22 A26 26 0 0 1 54 22" fill="none" />
</svg>`;

/** FortiManager — centralized management dashboard with nodes. */
export const FORTI_MANAGER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="32" cy="28" r="10" />
  <path d="M28 22 L32 28 L36 22" />
  <circle cx="32" cy="25" r="2" fill="currentColor" />
  <circle cx="12" cy="52" r="6" />
  <circle cx="32" cy="56" r="6" />
  <circle cx="52" cy="52" r="6" />
  <line x1="26" y1="36" x2="14" y2="46" />
  <line x1="32" y1="38" x2="32" y2="50" />
  <line x1="38" y1="36" x2="50" y2="46" />
</svg>`;

/** FortiAnalyzer — analytics chart with magnifying glass. */
export const FORTI_ANALYZER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="6" y="6" width="40" height="36" rx="3" />
  <polyline points="12,34 20,22 28,28 36,14" />
  <circle cx="36" cy="14" r="2" fill="currentColor" />
  <circle cx="48" cy="44" r="12" />
  <line x1="56" y1="52" x2="62" y2="58" stroke-width="3" />
  <line x1="6" y1="42" x2="46" y2="42" />
</svg>`;

/** FortiWeb — web application firewall (globe with shield). */
export const FORTI_WEB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="28" cy="32" r="20" />
  <ellipse cx="28" cy="32" rx="8" ry="20" />
  <line x1="8" y1="32" x2="48" y2="32" />
  <line x1="28" y1="12" x2="28" y2="52" />
  <path d="M48 36 L56 42 V52 C56 56 48 60 48 60 C48 60 40 56 40 52 V42 Z" fill="currentColor" opacity="0.2" />
  <path d="M48 36 L56 42 V52 C56 56 48 60 48 60 C48 60 40 56 40 52 V42 Z" />
</svg>`;

/** FortiMail — secure email gateway (envelope with lock). */
export const FORTI_MAIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="6" y="14" width="42" height="30" rx="2" />
  <polyline points="6,14 27,32 48,14" />
  <rect x="42" y="38" width="16" height="14" rx="2" />
  <path d="M46 38 V34 C46 30 54 30 54 34 V38" />
  <circle cx="50" cy="46" r="2" fill="currentColor" />
</svg>`;

/** FortiClient — endpoint protection (laptop with shield). */
export const FORTI_CLIENT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="10" y="8" width="44" height="34" rx="2" />
  <rect x="14" y="12" width="36" height="26" rx="1" />
  <rect x="6" y="42" width="52" height="4" rx="2" />
  <path d="M32 16 L40 20 V28 C40 32 32 36 32 36 C32 36 24 32 24 28 V20 Z" fill="currentColor" opacity="0.15" />
  <path d="M32 16 L40 20 V28 C40 32 32 36 32 36 C32 36 24 32 24 28 V20 Z" />
  <polyline points="28,25 31,28 37,22" stroke-width="2" />
</svg>`;

/** FortiSandbox — sandbox analysis (container with magnifying glass). */
export const FORTI_SANDBOX_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M8 20 L32 8 L56 20 V40 L32 52 L8 40 Z" />
  <line x1="32" y1="8" x2="32" y2="52" />
  <line x1="8" y1="20" x2="56" y2="20" />
  <circle cx="26" cy="32" r="6" />
  <line x1="30" y1="36" x2="36" y2="42" stroke-width="2.5" />
</svg>`;

/** FortiSIEM — security event monitor (screen with alert eye). */
export const FORTI_SIEM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="8" y="6" width="48" height="36" rx="3" />
  <path d="M32 50 C32 50 38 44 38 44 L26 44 C26 44 32 50 32 50Z" fill="currentColor" stroke="none" />
  <line x1="22" y1="50" x2="42" y2="50" />
  <path d="M16 24 C16 24 24 16 32 16 C40 16 48 24 48 24 C48 24 40 32 32 32 C24 32 16 24 16 24Z" />
  <circle cx="32" cy="24" r="4" fill="currentColor" />
  <circle cx="52" cy="10" r="3" fill="currentColor" opacity="0.5" />
</svg>`;

/** FortiNAC — network access control (gateway with lock). */
export const FORTI_NAC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="22" y="20" width="20" height="28" rx="2" />
  <path d="M26 20 V14 C26 8 38 8 38 14 V20" />
  <circle cx="32" cy="34" r="3" fill="currentColor" />
  <line x1="32" y1="37" x2="32" y2="42" />
  <line x1="4" y1="34" x2="22" y2="34" />
  <line x1="42" y1="34" x2="60" y2="34" />
  <circle cx="8" cy="34" r="4" />
  <circle cx="56" cy="34" r="4" />
  <circle cx="8" cy="20" r="4" />
  <circle cx="56" cy="20" r="4" />
  <line x1="8" y1="24" x2="8" y2="30" />
  <line x1="56" y1="24" x2="56" y2="30" />
</svg>`;

/** FortiEDR — endpoint detection and response (laptop with crosshairs). */
export const FORTI_EDR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="10" y="10" width="44" height="32" rx="2" />
  <rect x="6" y="42" width="52" height="4" rx="2" />
  <circle cx="32" cy="26" r="8" />
  <line x1="32" y1="14" x2="32" y2="20" />
  <line x1="32" y1="32" x2="32" y2="38" />
  <line x1="20" y1="26" x2="26" y2="26" />
  <line x1="38" y1="26" x2="44" y2="26" />
  <circle cx="32" cy="26" r="2" fill="currentColor" />
</svg>`;

/** FortiProxy — secure web proxy (funnel with arrows). */
export const FORTI_PROXY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M10 12 H54 L38 32 V48 H26 V32 Z" />
  <line x1="32" y1="48" x2="32" y2="58" />
  <polygon points="32,60 28,54 36,54" fill="currentColor" stroke="none" />
  <line x1="4" y1="8" x2="14" y2="8" />
  <polygon points="16,8 10,5 10,11" fill="currentColor" stroke="none" />
  <line x1="50" y1="8" x2="60" y2="8" />
  <polygon points="48,8 54,5 54,11" fill="currentColor" stroke="none" />
  <path d="M24 20 L32 26 L40 20" />
</svg>`;

/** FortiDDoS — DDoS protection (shield deflecting waves). */
export const FORTI_DDOS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M32 6 L50 16 V36 C50 44 32 54 32 54 C32 54 14 44 14 36 V16 Z" />
  <line x1="24" y1="22" x2="24" y2="42" stroke-width="1.5" />
  <line x1="32" y1="18" x2="32" y2="46" stroke-width="1.5" />
  <line x1="40" y1="22" x2="40" y2="42" stroke-width="1.5" />
  <path d="M4 22 C6 18 8 22 10 18" />
  <path d="M4 30 C6 26 8 30 10 26" />
  <path d="M4 38 C6 34 8 38 10 34" />
  <path d="M54 22 C56 18 58 22 60 18" />
  <path d="M54 30 C56 26 58 30 60 26" />
  <path d="M54 38 C56 34 58 38 60 34" />
</svg>`;

/** FortiADC — application delivery controller (balanced arrows). */
export const FORTI_ADC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="20" y="8" width="24" height="16" rx="3" />
  <circle cx="32" cy="16" r="3" fill="currentColor" />
  <line x1="32" y1="24" x2="32" y2="30" />
  <line x1="32" y1="30" x2="12" y2="42" />
  <line x1="32" y1="30" x2="32" y2="42" />
  <line x1="32" y1="30" x2="52" y2="42" />
  <rect x="4" y="42" width="16" height="14" rx="2" />
  <rect x="24" y="42" width="16" height="14" rx="2" />
  <rect x="44" y="42" width="16" height="14" rx="2" />
  <circle cx="12" cy="49" r="2" fill="currentColor" />
  <circle cx="32" cy="49" r="2" fill="currentColor" />
  <circle cx="52" cy="49" r="2" fill="currentColor" />
</svg>`;

/** FortiAuthenticator — authentication server (user with key). */
export const FORTI_AUTHENTICATOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="24" cy="16" r="8" />
  <path d="M10 42 C10 32 18 28 24 28 C30 28 38 32 38 42" />
  <circle cx="48" cy="28" r="6" />
  <line x1="48" y1="34" x2="48" y2="52" />
  <line x1="48" y1="40" x2="54" y2="38" />
  <line x1="48" y1="46" x2="54" y2="44" />
  <line x1="32" y1="36" x2="42" y2="30" />
</svg>`;

/** FortiToken — multi-factor authentication token (key fob with display). */
export const FORTI_TOKEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="18" y="4" width="28" height="56" rx="6" />
  <rect x="22" y="14" width="20" height="12" rx="2" />
  <text x="32" y="24" text-anchor="middle" font-size="8" font-family="monospace" fill="currentColor" stroke="none">123456</text>
  <circle cx="32" cy="42" r="6" />
  <circle cx="32" cy="42" r="2" fill="currentColor" />
  <circle cx="32" cy="54" r="2" fill="currentColor" />
</svg>`;

/** FortiExtender — WAN extender (antenna with signal extension). */
export const FORTI_EXTENDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="20" y="36" width="24" height="20" rx="3" />
  <line x1="32" y1="36" x2="32" y2="16" stroke-width="2.5" />
  <circle cx="32" cy="14" r="3" fill="currentColor" />
  <path d="M22 20 A14 14 0 0 1 42 20" fill="none" />
  <path d="M16 14 A20 20 0 0 1 48 14" fill="none" />
  <circle cx="26" cy="44" r="2" fill="currentColor" />
  <circle cx="38" cy="44" r="2" fill="currentColor" />
  <line x1="24" y1="50" x2="40" y2="50" />
</svg>`;

/** FortiDeceptor — deception technology (honeypot trap). */
export const FORTI_DECEPTOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M16 42 L32 10 L48 42 Z" />
  <line x1="24" y1="42" x2="40" y2="42" />
  <circle cx="32" cy="30" r="4" fill="currentColor" opacity="0.3" />
  <line x1="32" y1="26" x2="32" y2="20" />
  <path d="M8 48 C8 44 16 42 24 42" />
  <path d="M56 48 C56 44 48 42 40 42" />
  <path d="M8 48 Q32 58 56 48" />
  <line x1="28" y1="50" x2="28" y2="54" />
  <line x1="36" y1="50" x2="36" y2="54" />
  <line x1="32" y1="51" x2="32" y2="56" />
</svg>`;

/** FortiSOAR — security orchestration & automated response (dashboard with play). */
export const FORTI_SOAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="4" y="6" width="56" height="40" rx="3" />
  <line x1="4" y1="16" x2="60" y2="16" />
  <circle cx="10" cy="11" r="2" fill="currentColor" />
  <circle cx="18" cy="11" r="2" fill="currentColor" />
  <circle cx="26" cy="11" r="2" fill="currentColor" />
  <rect x="10" y="22" width="18" height="8" rx="1" fill="currentColor" opacity="0.15" />
  <rect x="10" y="34" width="12" height="6" rx="1" fill="currentColor" opacity="0.15" />
  <polygon points="42,22 42,38 54,30" fill="currentColor" opacity="0.3" />
  <polygon points="42,22 42,38 54,30" />
  <line x1="22" y1="52" x2="42" y2="52" />
  <path d="M32 46 L38 52 H26 Z" fill="currentColor" stroke="none" />
</svg>`;
