/**
 * Cisco Pro hand-crafted SVG icons for the stencil catalog.
 *
 * Thirty monochrome line-art icons (64×64 viewBox) representing
 * key Cisco networking, security, collaboration, data center,
 * cloud/SD-WAN, and infrastructure products. Each icon uses
 * `currentColor` for fills/strokes to support theming.
 *
 * @module
 */

// ── Networking ────────────────────────────────────────────

/** Router — classic Cisco router shape (cylinder with arrows). */
export const CISCO_PRO_ROUTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <ellipse cx="32" cy="20" rx="20" ry="8" />
  <path d="M12 20v12c0 4.4 9 8 20 8s20-3.6 20-8V20" />
  <ellipse cx="32" cy="32" rx="20" ry="8" stroke="none" fill="none" />
  <line x1="4" y1="26" x2="12" y2="26" />
  <polygon points="4,26 8,23 8,29" fill="currentColor" stroke="none" />
  <line x1="52" y1="26" x2="60" y2="26" />
  <polygon points="60,26 56,23 56,29" fill="currentColor" stroke="none" />
  <line x1="32" y1="40" x2="32" y2="52" />
  <polygon points="32,52 29,48 35,48" fill="currentColor" stroke="none" />
  <line x1="32" y1="12" x2="32" y2="4" />
  <polygon points="32,4 29,8 35,8" fill="currentColor" stroke="none" />
</svg>`;

/** Switch — L2 network switch with port indicators. */
export const CISCO_PRO_SWITCH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="4" y="18" width="56" height="28" rx="3" />
  <rect x="10" y="24" width="6" height="8" rx="1" />
  <rect x="19" y="24" width="6" height="8" rx="1" />
  <rect x="28" y="24" width="6" height="8" rx="1" />
  <rect x="37" y="24" width="6" height="8" rx="1" />
  <rect x="46" y="24" width="6" height="8" rx="1" />
  <circle cx="13" cy="40" r="2" fill="currentColor" />
  <circle cx="22" cy="40" r="2" fill="currentColor" />
  <circle cx="31" cy="40" r="2" fill="currentColor" />
  <circle cx="40" cy="40" r="2" fill="currentColor" />
  <circle cx="49" cy="40" r="2" fill="currentColor" />
  <line x1="4" y1="10" x2="10" y2="18" />
  <polygon points="4,10 8,14 4,15" fill="currentColor" stroke="none" />
  <line x1="60" y1="10" x2="54" y2="18" />
  <polygon points="60,10 60,15 56,14" fill="currentColor" stroke="none" />
</svg>`;

/** L3 Switch — multilayer switch with layered rectangles. */
export const CISCO_PRO_L3_SWITCH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="8" y="22" width="48" height="24" rx="3" />
  <rect x="12" y="18" width="40" height="4" rx="1" fill="currentColor" opacity="0.15" />
  <rect x="14" y="28" width="6" height="6" rx="1" />
  <rect x="23" y="28" width="6" height="6" rx="1" />
  <rect x="32" y="28" width="6" height="6" rx="1" />
  <rect x="41" y="28" width="6" height="6" rx="1" />
  <circle cx="17" cy="40" r="2" fill="currentColor" />
  <circle cx="26" cy="40" r="2" fill="currentColor" />
  <circle cx="35" cy="40" r="2" fill="currentColor" />
  <circle cx="44" cy="40" r="2" fill="currentColor" />
  <text x="52" y="16" text-anchor="middle" font-size="9" font-family="sans-serif" fill="currentColor" stroke="none">L3</text>
</svg>`;

/** Firewall — brick wall pattern with shield overlay. */
export const CISCO_PRO_FIREWALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="8" y="10" width="48" height="44" rx="2" />
  <line x1="8" y1="21" x2="56" y2="21" />
  <line x1="8" y1="32" x2="56" y2="32" />
  <line x1="8" y1="43" x2="56" y2="43" />
  <line x1="22" y1="10" x2="22" y2="21" />
  <line x1="42" y1="10" x2="42" y2="21" />
  <line x1="32" y1="21" x2="32" y2="32" />
  <line x1="16" y1="21" x2="16" y2="32" />
  <line x1="48" y1="21" x2="48" y2="32" />
  <line x1="22" y1="32" x2="22" y2="43" />
  <line x1="42" y1="32" x2="42" y2="43" />
  <line x1="32" y1="43" x2="32" y2="54" />
  <line x1="16" y1="43" x2="16" y2="54" />
  <line x1="48" y1="43" x2="48" y2="54" />
</svg>`;

/** Wireless AP — access point with concentric signal waves. */
export const CISCO_PRO_WIRELESS_AP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="32" cy="38" r="5" fill="currentColor" opacity="0.2" />
  <circle cx="32" cy="38" r="5" />
  <line x1="32" y1="43" x2="32" y2="54" />
  <line x1="22" y1="54" x2="42" y2="54" />
  <path d="M22 32 A14 14 0 0 1 42 32" />
  <path d="M16 26 A20 20 0 0 1 48 26" />
  <path d="M10 20 A26 26 0 0 1 54 20" />
</svg>`;

/** Wireless Controller (WLC) — controller box with antenna symbol. */
export const CISCO_PRO_WLC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="8" y="28" width="48" height="24" rx="3" />
  <circle cx="16" cy="40" r="3" fill="currentColor" />
  <circle cx="26" cy="40" r="3" fill="currentColor" />
  <line x1="36" y1="36" x2="52" y2="36" />
  <line x1="36" y1="44" x2="52" y2="44" />
  <line x1="32" y1="28" x2="32" y2="18" stroke-width="2.5" />
  <circle cx="32" cy="16" r="3" fill="currentColor" />
  <path d="M24 20 A10 10 0 0 1 40 20" />
  <path d="M20 14 A14 14 0 0 1 44 14" />
</svg>`;

// ── Security ──────────────────────────────────────────────

/** ASA — Adaptive Security Appliance (appliance box with shield). */
export const CISCO_PRO_ASA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="6" y="20" width="52" height="28" rx="3" />
  <circle cx="14" cy="40" r="2" fill="currentColor" />
  <circle cx="22" cy="40" r="2" fill="currentColor" />
  <line x1="30" y1="36" x2="54" y2="36" />
  <line x1="30" y1="40" x2="54" y2="40" />
  <path d="M32 6 L42 12 V22 C42 26 32 30 32 30 C32 30 22 26 22 22 V12 Z" fill="currentColor" opacity="0.15" />
  <path d="M32 6 L42 12 V22 C42 26 32 30 32 30 C32 30 22 26 22 22 V12 Z" />
</svg>`;

/** ISE — Identity Services Engine (user silhouette with shield). */
export const CISCO_PRO_ISE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="24" cy="18" r="8" />
  <path d="M10 44 C10 34 17 28 24 28 C31 28 38 34 38 44" />
  <path d="M46 14 L54 18 V28 C54 32 46 36 46 36 C46 36 38 32 38 28 V18 Z" fill="currentColor" opacity="0.15" />
  <path d="M46 14 L54 18 V28 C54 32 46 36 46 36 C46 36 38 32 38 28 V18 Z" />
  <polyline points="42,24 45,27 51,21" stroke-width="2" />
</svg>`;

/** Umbrella — cloud with umbrella shape beneath. */
export const CISCO_PRO_UMBRELLA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M16 28 C16 18 22 12 32 12 C42 12 48 18 48 28" />
  <path d="M10 28 C6 28 4 24 6 20 C8 16 12 14 16 14" />
  <path d="M48 14 C52 14 56 16 58 20 C60 24 58 28 54 28" />
  <line x1="10" y1="28" x2="54" y2="28" />
  <path d="M14 34 C14 34 22 42 32 34 C42 42 50 34 50 34" />
  <line x1="32" y1="34" x2="32" y2="52" />
  <path d="M32 52 C28 52 26 50 26 48" />
</svg>`;

/** AMP — Advanced Malware Protection (shield with crosshair). */
export const CISCO_PRO_AMP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M32 4 L52 14 V34 C52 44 32 56 32 56 C32 56 12 44 12 34 V14 Z" fill="currentColor" opacity="0.1" />
  <path d="M32 4 L52 14 V34 C52 44 32 56 32 56 C32 56 12 44 12 34 V14 Z" />
  <circle cx="32" cy="30" r="10" />
  <line x1="32" y1="18" x2="32" y2="24" />
  <line x1="32" y1="36" x2="32" y2="42" />
  <line x1="20" y1="30" x2="26" y2="30" />
  <line x1="38" y1="30" x2="44" y2="30" />
  <circle cx="32" cy="30" r="2" fill="currentColor" />
</svg>`;

/** Stealthwatch — eye with network monitoring waves. */
export const CISCO_PRO_STEALTHWATCH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M4 32 C4 32 16 16 32 16 C48 16 60 32 60 32 C60 32 48 48 32 48 C16 48 4 32 4 32Z" />
  <circle cx="32" cy="32" r="10" />
  <circle cx="32" cy="32" r="4" fill="currentColor" />
  <path d="M8 12 L16 18" stroke-width="1.5" />
  <path d="M56 12 L48 18" stroke-width="1.5" />
  <circle cx="8" cy="10" r="2" fill="currentColor" />
  <circle cx="56" cy="10" r="2" fill="currentColor" />
</svg>`;

// ── Collaboration ─────────────────────────────────────────

/** IP Phone — desk phone with handset and buttons. */
export const CISCO_PRO_IP_PHONE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="14" y="12" width="36" height="44" rx="3" />
  <rect x="18" y="16" width="28" height="14" rx="2" fill="currentColor" opacity="0.1" />
  <rect x="18" y="34" width="6" height="4" rx="1" />
  <rect x="27" y="34" width="6" height="4" rx="1" />
  <rect x="36" y="34" width="6" height="4" rx="1" />
  <rect x="18" y="41" width="6" height="4" rx="1" />
  <rect x="27" y="41" width="6" height="4" rx="1" />
  <rect x="36" y="41" width="6" height="4" rx="1" />
  <rect x="18" y="48" width="6" height="4" rx="1" />
  <rect x="27" y="48" width="6" height="4" rx="1" />
  <rect x="36" y="48" width="6" height="4" rx="1" />
  <path d="M8 16 C6 16 4 18 4 20 V28 C4 30 6 32 8 32" />
</svg>`;

/** Video Endpoint — screen with camera on top. */
export const CISCO_PRO_VIDEO_ENDPOINT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="8" y="18" width="48" height="30" rx="3" />
  <rect x="12" y="22" width="40" height="22" rx="1" fill="currentColor" opacity="0.1" />
  <line x1="24" y1="48" x2="40" y2="48" />
  <line x1="32" y1="48" x2="32" y2="54" />
  <line x1="22" y1="54" x2="42" y2="54" />
  <circle cx="32" cy="12" r="4" />
  <circle cx="32" cy="12" r="2" fill="currentColor" />
</svg>`;

/** Webex — people in a circle (meeting icon). */
export const CISCO_PRO_WEBEX_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="32" cy="32" r="24" />
  <circle cx="32" cy="18" r="5" />
  <path d="M24 30 C24 26 28 24 32 24 C36 24 40 26 40 30" />
  <circle cx="18" cy="40" r="4" />
  <path d="M12 50 C12 47 15 45 18 45 C21 45 24 47 24 50" />
  <circle cx="46" cy="40" r="4" />
  <path d="M40 50 C40 47 43 45 46 45 C49 45 52 47 52 50" />
</svg>`;

/** Call Manager (CUCM) — phone icon with server lines. */
export const CISCO_PRO_CALL_MANAGER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="24" y="4" width="32" height="24" rx="3" />
  <line x1="28" y1="10" x2="52" y2="10" />
  <line x1="28" y1="16" x2="52" y2="16" />
  <line x1="28" y1="22" x2="52" y2="22" />
  <circle cx="50" cy="10" r="2" fill="currentColor" />
  <circle cx="50" cy="16" r="2" fill="currentColor" />
  <rect x="4" y="34" width="24" height="26" rx="2" />
  <rect x="8" y="38" width="16" height="8" rx="1" fill="currentColor" opacity="0.1" />
  <rect x="8" y="49" width="4" height="3" rx="1" />
  <rect x="14" y="49" width="4" height="3" rx="1" />
  <line x1="24" y1="34" x2="40" y2="28" />
</svg>`;

// ── Data Center ───────────────────────────────────────────

/** UCS Server — blade server (tall chassis with blade slots). */
export const CISCO_PRO_UCS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="12" y="4" width="40" height="56" rx="3" />
  <rect x="16" y="8" width="32" height="8" rx="1" />
  <rect x="16" y="19" width="32" height="8" rx="1" />
  <rect x="16" y="30" width="32" height="8" rx="1" />
  <rect x="16" y="41" width="32" height="8" rx="1" />
  <circle cx="20" cy="12" r="2" fill="currentColor" />
  <circle cx="20" cy="23" r="2" fill="currentColor" />
  <circle cx="20" cy="34" r="2" fill="currentColor" />
  <circle cx="20" cy="45" r="2" fill="currentColor" />
  <circle cx="32" cy="54" r="2" fill="currentColor" />
</svg>`;

/** Nexus Switch — wide data center switch with high port density. */
export const CISCO_PRO_NEXUS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="2" y="18" width="60" height="28" rx="3" />
  <rect x="6" y="22" width="5" height="6" rx="1" />
  <rect x="13" y="22" width="5" height="6" rx="1" />
  <rect x="20" y="22" width="5" height="6" rx="1" />
  <rect x="27" y="22" width="5" height="6" rx="1" />
  <rect x="34" y="22" width="5" height="6" rx="1" />
  <rect x="41" y="22" width="5" height="6" rx="1" />
  <rect x="48" y="22" width="5" height="6" rx="1" />
  <rect x="55" y="22" width="5" height="6" rx="1" />
  <line x1="6" y1="34" x2="58" y2="34" stroke-width="1" />
  <circle cx="10" cy="40" r="2" fill="currentColor" />
  <circle cx="18" cy="40" r="2" fill="currentColor" />
  <circle cx="26" cy="40" r="2" fill="currentColor" />
  <circle cx="34" cy="40" r="2" fill="currentColor" />
  <circle cx="42" cy="40" r="2" fill="currentColor" />
  <circle cx="50" cy="40" r="2" fill="currentColor" />
</svg>`;

/** ACI Fabric — interconnected mesh of nodes. */
export const CISCO_PRO_ACI_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="22" y="4" width="20" height="12" rx="2" fill="currentColor" opacity="0.15" />
  <rect x="22" y="4" width="20" height="12" rx="2" />
  <rect x="4" y="26" width="20" height="12" rx="2" />
  <rect x="40" y="26" width="20" height="12" rx="2" />
  <rect x="4" y="48" width="16" height="12" rx="2" />
  <rect x="24" y="48" width="16" height="12" rx="2" />
  <rect x="44" y="48" width="16" height="12" rx="2" />
  <line x1="28" y1="16" x2="16" y2="26" />
  <line x1="36" y1="16" x2="48" y2="26" />
  <line x1="10" y1="38" x2="10" y2="48" />
  <line x1="18" y1="38" x2="30" y2="48" />
  <line x1="46" y1="38" x2="34" y2="48" />
  <line x1="54" y1="38" x2="54" y2="48" />
</svg>`;

/** HyperFlex — hyperconverged (stacked servers with infinity symbol). */
export const CISCO_PRO_HYPERFLEX_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="10" y="6" width="44" height="12" rx="2" />
  <rect x="10" y="22" width="44" height="12" rx="2" />
  <rect x="10" y="38" width="44" height="12" rx="2" />
  <circle cx="16" cy="12" r="2" fill="currentColor" />
  <circle cx="16" cy="28" r="2" fill="currentColor" />
  <circle cx="16" cy="44" r="2" fill="currentColor" />
  <line x1="24" y1="12" x2="48" y2="12" />
  <line x1="24" y1="28" x2="48" y2="28" />
  <line x1="24" y1="44" x2="48" y2="44" />
  <path d="M22 56 C22 53 26 53 28 56 C30 59 34 59 34 56" />
  <path d="M34 56 C34 53 38 53 40 56 C42 59 46 59 46 56" stroke-dasharray="none" />
</svg>`;

// ── Cloud & SD-WAN ────────────────────────────────────────

/** Meraki — cloud with managed device beneath. */
export const CISCO_PRO_MERAKI_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M16 28 C16 18 22 12 32 12 C42 12 48 18 48 28" fill="currentColor" opacity="0.1" />
  <path d="M10 28 C6 28 4 24 6 20 C8 16 12 14 16 14" />
  <path d="M48 14 C52 14 56 16 58 20 C60 24 58 28 54 28" />
  <path d="M16 28 C16 18 22 12 32 12 C42 12 48 18 48 28" />
  <line x1="10" y1="28" x2="54" y2="28" />
  <line x1="32" y1="28" x2="32" y2="36" />
  <rect x="18" y="36" width="28" height="18" rx="3" />
  <circle cx="24" cy="45" r="2" fill="currentColor" />
  <circle cx="32" cy="45" r="2" fill="currentColor" />
  <circle cx="40" cy="45" r="2" fill="currentColor" />
  <line x1="22" y1="41" x2="42" y2="41" />
</svg>`;

/** SD-WAN — network nodes interconnected through a cloud. */
export const CISCO_PRO_SD_WAN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M18 30 C18 22 24 16 32 16 C40 16 46 22 46 30" fill="currentColor" opacity="0.1" />
  <path d="M12 30 C9 30 7 27 8 24 C10 20 13 18 18 18" />
  <path d="M46 18 C51 18 54 20 56 24 C57 27 55 30 52 30" />
  <path d="M18 30 C18 22 24 16 32 16 C40 16 46 22 46 30" />
  <line x1="12" y1="30" x2="52" y2="30" />
  <circle cx="10" cy="48" r="6" />
  <circle cx="32" cy="52" r="6" />
  <circle cx="54" cy="48" r="6" />
  <line x1="14" y1="43" x2="26" y2="30" />
  <line x1="32" y1="46" x2="32" y2="30" />
  <line x1="50" y1="43" x2="38" y2="30" />
</svg>`;

/** Viptela — SD-WAN edge router (router with cloud badge). */
export const CISCO_PRO_VIPTELA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <ellipse cx="32" cy="28" rx="20" ry="8" />
  <path d="M12 28v10c0 4.4 9 8 20 8s20-3.6 20-8V28" />
  <line x1="4" y1="34" x2="12" y2="34" />
  <polygon points="4,34 8,31 8,37" fill="currentColor" stroke="none" />
  <line x1="52" y1="34" x2="60" y2="34" />
  <polygon points="60,34 56,31 56,37" fill="currentColor" stroke="none" />
  <path d="M38 8 C38 4 42 2 46 2 C50 2 54 4 56 8" />
  <path d="M36 8 C34 8 32 6 34 4" />
  <path d="M56 4 C58 6 58 8 56 8" />
  <line x1="36" y1="8" x2="56" y2="8" />
</svg>`;

/** Cloud — generic cloud shape. */
export const CISCO_PRO_CLOUD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M16 40 C8 40 4 34 6 28 C8 22 14 18 20 18 C22 10 28 6 36 6 C44 6 50 10 52 18 C58 18 62 24 60 30 C58 36 54 40 48 40 Z" fill="currentColor" opacity="0.1" />
  <path d="M16 40 C8 40 4 34 6 28 C8 22 14 18 20 18 C22 10 28 6 36 6 C44 6 50 10 52 18 C58 18 62 24 60 30 C58 36 54 40 48 40 Z" />
</svg>`;

/** Internet — globe with latitude/longitude lines. */
export const CISCO_PRO_INTERNET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="32" cy="32" r="24" />
  <ellipse cx="32" cy="32" rx="10" ry="24" />
  <line x1="8" y1="32" x2="56" y2="32" />
  <line x1="32" y1="8" x2="32" y2="56" />
  <path d="M12 18 C18 22 26 24 32 24 C38 24 46 22 52 18" />
  <path d="M12 46 C18 42 26 40 32 40 C38 40 46 42 52 46" />
</svg>`;

// ── Infrastructure ────────────────────────────────────────

/** Stack — stacked switches (layered rectangles). */
export const CISCO_PRO_STACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="8" y="6" width="48" height="14" rx="2" />
  <rect x="8" y="24" width="48" height="14" rx="2" />
  <rect x="8" y="42" width="48" height="14" rx="2" />
  <circle cx="14" cy="13" r="2" fill="currentColor" />
  <circle cx="14" cy="31" r="2" fill="currentColor" />
  <circle cx="14" cy="49" r="2" fill="currentColor" />
  <line x1="22" y1="13" x2="50" y2="13" />
  <line x1="22" y1="31" x2="50" y2="31" />
  <line x1="22" y1="49" x2="50" y2="49" />
  <line x1="4" y1="20" x2="4" y2="42" stroke-width="2.5" />
  <line x1="60" y1="20" x2="60" y2="42" stroke-width="2.5" />
</svg>`;

/** Server — generic rack server (1U horizontal box). */
export const CISCO_PRO_SERVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="6" y="14" width="52" height="36" rx="3" />
  <line x1="6" y1="26" x2="58" y2="26" />
  <line x1="6" y1="38" x2="58" y2="38" />
  <circle cx="14" cy="20" r="2" fill="currentColor" />
  <circle cx="14" cy="32" r="2" fill="currentColor" />
  <circle cx="14" cy="44" r="2" fill="currentColor" />
  <line x1="22" y1="20" x2="50" y2="20" />
  <line x1="22" y1="32" x2="50" y2="32" />
  <line x1="22" y1="44" x2="50" y2="44" />
</svg>`;

/** Workstation — desktop computer (monitor with base). */
export const CISCO_PRO_WORKSTATION_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="8" y="6" width="48" height="34" rx="3" />
  <rect x="12" y="10" width="40" height="26" rx="1" fill="currentColor" opacity="0.1" />
  <line x1="28" y1="40" x2="36" y2="40" />
  <line x1="32" y1="40" x2="32" y2="48" />
  <rect x="20" y="48" width="24" height="4" rx="2" />
  <line x1="16" y1="56" x2="48" y2="56" />
</svg>`;

/** Laptop — laptop computer (screen with keyboard base). */
export const CISCO_PRO_LAPTOP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="12" y="8" width="40" height="30" rx="2" />
  <rect x="16" y="12" width="32" height="22" rx="1" fill="currentColor" opacity="0.1" />
  <path d="M6 44 L12 38 H52 L58 44 Z" />
  <line x1="6" y1="44" x2="58" y2="44" />
  <rect x="4" y="44" width="56" height="6" rx="2" />
</svg>`;

/** Printer — network printer with paper tray. */
export const CISCO_PRO_PRINTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="8" y="22" width="48" height="24" rx="3" />
  <rect x="16" y="6" width="32" height="16" rx="1" />
  <rect x="16" y="46" width="32" height="14" rx="1" />
  <line x1="20" y1="52" x2="44" y2="52" />
  <line x1="20" y1="56" x2="36" y2="56" />
  <circle cx="48" cy="34" r="3" fill="currentColor" />
  <rect x="12" y="30" width="28" height="4" rx="1" fill="currentColor" opacity="0.15" />
  <path d="M20 6 L20 2 H44 L44 6" stroke-width="1.5" />
</svg>`;

/** IP Camera — surveillance camera with mount. */
export const CISCO_PRO_CAMERA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="4" y="4" width="16" height="8" rx="1" fill="currentColor" opacity="0.15" />
  <rect x="4" y="4" width="16" height="8" rx="1" />
  <line x1="12" y1="12" x2="12" y2="20" stroke-width="2.5" />
  <line x1="8" y1="20" x2="16" y2="20" />
  <line x1="12" y1="20" x2="30" y2="32" stroke-width="2" />
  <rect x="28" y="22" width="30" height="20" rx="3" />
  <circle cx="43" cy="32" r="7" />
  <circle cx="43" cy="32" r="3" fill="currentColor" />
  <line x1="28" y1="42" x2="32" y2="50" stroke-width="1.5" />
  <line x1="58" y1="42" x2="54" y2="50" stroke-width="1.5" />
</svg>`;
