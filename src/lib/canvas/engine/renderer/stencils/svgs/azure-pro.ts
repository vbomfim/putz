/**
 * Azure Pro hand-crafted SVG icons for the stencil catalog.
 *
 * Thirty monochrome line-art icons (64×64 viewBox) representing
 * key Azure compute, storage, database, networking, security,
 * management, and AI services. Each icon uses `currentColor`
 * for fills/strokes to support theming.
 *
 * @module
 */

// ── Compute ──────────────────────────────────────────────

/** Virtual Machines — server rack with Azure diamond badge. */
export const AZURE_PRO_VIRTUAL_MACHINES_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="14" y="6" width="36" height="46" rx="3" />
  <line x1="14" y1="18" x2="50" y2="18" />
  <line x1="14" y1="30" x2="50" y2="30" />
  <circle cx="20" cy="12" r="2" fill="currentColor" />
  <circle cx="20" cy="24" r="2" fill="currentColor" />
  <circle cx="20" cy="36" r="2" fill="currentColor" />
  <line x1="26" y1="12" x2="44" y2="12" />
  <line x1="26" y1="24" x2="44" y2="24" />
  <line x1="26" y1="36" x2="44" y2="36" />
  <line x1="32" y1="52" x2="32" y2="58" />
  <line x1="22" y1="58" x2="42" y2="58" />
  <polygon points="44,42 48,46 44,50 40,46" fill="currentColor" opacity="0.3" stroke="currentColor" stroke-width="1" />
</svg>`;

/** App Service — globe with code brackets. */
export const AZURE_PRO_APP_SERVICE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="32" cy="32" r="22" />
  <ellipse cx="32" cy="32" rx="9" ry="22" />
  <line x1="10" y1="32" x2="54" y2="32" />
  <path d="M14 22 h36" />
  <path d="M14 42 h36" />
  <path d="M22 50 L18 54 L22 58" stroke-width="2.5" />
  <path d="M42 50 L46 54 L42 58" stroke-width="2.5" />
</svg>`;

/** Azure Functions — lightning bolt in a rounded frame. */
export const AZURE_PRO_FUNCTIONS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="8" y="8" width="48" height="48" rx="8" />
  <polygon points="34,14 22,34 30,34 26,50 42,28 34,28" fill="currentColor" opacity="0.15" stroke="currentColor" stroke-linejoin="round" stroke-width="2" />
</svg>`;

/** AKS — Kubernetes wheel in Azure-styled frame. */
export const AZURE_PRO_AKS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="6" y="6" width="52" height="52" rx="4" />
  <circle cx="32" cy="32" r="14" />
  <circle cx="32" cy="32" r="4" fill="currentColor" opacity="0.2" />
  <line x1="32" y1="18" x2="32" y2="24" />
  <line x1="32" y1="40" x2="32" y2="46" />
  <line x1="19.9" y1="25" x2="24.5" y2="28" />
  <line x1="39.5" y1="36" x2="44.1" y2="39" />
  <line x1="19.9" y1="39" x2="24.5" y2="36" />
  <line x1="39.5" y1="28" x2="44.1" y2="25" />
  <circle cx="32" cy="16" r="2.5" fill="currentColor" />
  <circle cx="32" cy="48" r="2.5" fill="currentColor" />
  <circle cx="18" cy="24" r="2.5" fill="currentColor" />
  <circle cx="46" cy="40" r="2.5" fill="currentColor" />
  <circle cx="18" cy="40" r="2.5" fill="currentColor" />
  <circle cx="46" cy="24" r="2.5" fill="currentColor" />
</svg>`;

/** Container Instances — stacked containers with run indicator. */
export const AZURE_PRO_CONTAINER_INSTANCES_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="10" y="8" width="40" height="16" rx="2" />
  <line x1="10" y1="16" x2="50" y2="16" />
  <rect x="10" y="28" width="40" height="16" rx="2" />
  <line x1="10" y1="36" x2="50" y2="36" />
  <rect x="10" y="48" width="40" height="12" rx="2" />
  <polygon points="42,52 42,56 46,54" fill="currentColor" stroke="none" />
  <circle cx="16" cy="12" r="1.5" fill="currentColor" />
  <circle cx="16" cy="32" r="1.5" fill="currentColor" />
  <circle cx="16" cy="54" r="1.5" fill="currentColor" />
</svg>`;

/** Virtual Machine Scale Sets — layered VM boxes with scale arrows. */
export const AZURE_PRO_VMSS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="18" y="4" width="32" height="24" rx="2" fill="currentColor" opacity="0.05" />
  <rect x="14" y="8" width="32" height="24" rx="2" fill="currentColor" opacity="0.08" />
  <rect x="10" y="12" width="32" height="24" rx="2" />
  <line x1="10" y1="22" x2="42" y2="22" />
  <circle cx="16" cy="17" r="1.5" fill="currentColor" />
  <line x1="22" y1="17" x2="36" y2="17" />
  <line x1="20" y1="44" x2="20" y2="56" />
  <polygon points="20,56 17,52 23,52" fill="currentColor" stroke="none" />
  <line x1="44" y1="44" x2="44" y2="56" />
  <polygon points="44,44 41,48 47,48" fill="currentColor" stroke="none" />
  <line x1="24" y1="50" x2="40" y2="50" />
</svg>`;

// ── Storage ──────────────────────────────────────────────

/** Blob Storage — bucket with blob shapes. */
export const AZURE_PRO_BLOB_STORAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <ellipse cx="32" cy="14" rx="18" ry="6" />
  <path d="M14 14 v36 c0 3.3 8 6 18 6 s18-2.7 18-6 V14" />
  <path d="M14 28 c0 3.3 8 6 18 6 s18-2.7 18-6" />
  <circle cx="24" cy="40" r="3" fill="currentColor" opacity="0.2" />
  <circle cx="34" cy="38" r="4" fill="currentColor" opacity="0.15" />
  <circle cx="28" cy="46" r="2.5" fill="currentColor" opacity="0.2" />
</svg>`;

/** File Storage — folder with file sheet. */
export const AZURE_PRO_FILE_STORAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M8 18 L8 54 L56 54 L56 24 L36 24 L32 18 Z" />
  <path d="M8 24 L56 24" />
  <rect x="22" y="30" width="20" height="18" rx="1" />
  <path d="M34 30 L34 34 L38 34" fill="none" />
  <line x1="26" y1="36" x2="38" y2="36" />
  <line x1="26" y1="40" x2="34" y2="40" />
  <line x1="26" y1="44" x2="36" y2="44" />
</svg>`;

/** Disk Storage — stacked disk platters. */
export const AZURE_PRO_DISK_STORAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <ellipse cx="32" cy="12" rx="20" ry="6" />
  <path d="M12 12 v12 c0 3.3 9 6 20 6 s20-2.7 20-6 V12" />
  <path d="M12 24 v12 c0 3.3 9 6 20 6 s20-2.7 20-6 V24" />
  <path d="M12 36 v12 c0 3.3 9 6 20 6 s20-2.7 20-6 V36" />
  <path d="M12 24 c0 3.3 9 6 20 6 s20-2.7 20-6" />
  <path d="M12 36 c0 3.3 9 6 20 6 s20-2.7 20-6" />
</svg>`;

/** Data Lake — lake wave with data nodes. */
export const AZURE_PRO_DATA_LAKE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M8 36 C14 30 22 30 28 36 C34 42 42 42 48 36 C50 34 54 34 56 36 V52 C56 54 54 56 52 56 H12 C10 56 8 54 8 52 Z" fill="currentColor" opacity="0.08" />
  <path d="M8 36 C14 30 22 30 28 36 C34 42 42 42 48 36 C50 34 54 34 56 36" />
  <circle cx="20" cy="16" r="5" />
  <circle cx="36" cy="12" r="5" />
  <circle cx="48" cy="20" r="5" />
  <line x1="25" y1="16" x2="31" y2="12" />
  <line x1="41" y1="12" x2="43" y2="18" />
  <line x1="20" y1="21" x2="20" y2="30" />
  <line x1="36" y1="17" x2="36" y2="28" />
</svg>`;

// ── Database ─────────────────────────────────────────────

/** SQL Database — database cylinder with SQL label. */
export const AZURE_PRO_SQL_DATABASE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <ellipse cx="32" cy="16" rx="18" ry="7" />
  <path d="M14 16 v32 c0 3.9 8 7 18 7 s18-3.1 18-7 V16" />
  <path d="M14 28 c0 3.9 8 7 18 7 s18-3.1 18-7" />
  <text x="32" y="48" text-anchor="middle" font-size="10" font-weight="bold" fill="currentColor" stroke="none" font-family="sans-serif">SQL</text>
</svg>`;

/** Cosmos DB — globe with atom orbital ring. */
export const AZURE_PRO_COSMOS_DB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="32" cy="32" r="16" />
  <ellipse cx="32" cy="32" rx="26" ry="10" transform="rotate(-30 32 32)" />
  <ellipse cx="32" cy="32" rx="26" ry="10" transform="rotate(30 32 32)" />
  <circle cx="32" cy="32" r="3" fill="currentColor" />
</svg>`;

/** MySQL — database cylinder with dolphin-inspired fin. */
export const AZURE_PRO_MYSQL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <ellipse cx="28" cy="16" rx="16" ry="6" />
  <path d="M12 16 v32 c0 3.3 7.2 6 16 6 s16-2.7 16-6 V16" />
  <path d="M12 28 c0 3.3 7.2 6 16 6 s16-2.7 16-6" />
  <path d="M46 14 C50 10 54 12 54 18 C54 24 50 28 48 30 L52 36" stroke-width="2" />
  <path d="M46 14 C44 10 46 6 50 6" stroke-width="1.5" />
</svg>`;

/** PostgreSQL — database cylinder with elephant trunk. */
export const AZURE_PRO_POSTGRESQL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <ellipse cx="28" cy="16" rx="16" ry="6" />
  <path d="M12 16 v32 c0 3.3 7.2 6 16 6 s16-2.7 16-6 V16" />
  <path d="M12 28 c0 3.3 7.2 6 16 6 s16-2.7 16-6" />
  <path d="M44 14 C48 14 52 18 52 24 C52 30 50 32 48 34 C46 36 48 40 50 42" stroke-width="2" />
  <circle cx="49" cy="20" r="2" fill="currentColor" opacity="0.3" />
</svg>`;

/** Redis Cache — lightning bolt on cache box with speed lines. */
export const AZURE_PRO_REDIS_CACHE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="10" y="14" width="44" height="36" rx="3" />
  <line x1="10" y1="26" x2="54" y2="26" />
  <path d="M34 30 L28 40 H36 L30 50" stroke-width="2.5" fill="none" />
  <line x1="4" y1="34" x2="10" y2="34" />
  <line x1="4" y1="38" x2="8" y2="38" />
  <line x1="4" y1="42" x2="6" y2="42" />
  <circle cx="18" cy="20" r="2" fill="currentColor" />
  <circle cx="26" cy="20" r="2" fill="currentColor" />
</svg>`;

// ── Networking ────────────────────────────────────────────

/** Virtual Network — dashed boundary with connected nodes. */
export const AZURE_PRO_VIRTUAL_NETWORK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="6" y="6" width="52" height="52" rx="4" stroke-dasharray="4 2" />
  <circle cx="22" cy="22" r="6" />
  <circle cx="42" cy="22" r="6" />
  <circle cx="22" cy="42" r="6" />
  <circle cx="42" cy="42" r="6" />
  <line x1="28" y1="22" x2="36" y2="22" />
  <line x1="22" y1="28" x2="22" y2="36" />
  <line x1="42" y1="28" x2="42" y2="36" />
  <line x1="28" y1="42" x2="36" y2="42" />
  <line x1="27" y1="27" x2="37" y2="37" />
  <line x1="37" y1="27" x2="27" y2="37" />
  <path d="M32 2 L34 6 L30 6 Z" fill="currentColor" stroke="none" />
</svg>`;

/** Load Balancer — balanced arrows through vertical bar. */
export const AZURE_PRO_LOAD_BALANCER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="26" y="8" width="12" height="48" rx="3" fill="currentColor" opacity="0.08" />
  <rect x="26" y="8" width="12" height="48" rx="3" />
  <line x1="8" y1="32" x2="26" y2="32" />
  <polygon points="8,32 14,29 14,35" fill="currentColor" stroke="none" />
  <line x1="38" y1="16" x2="56" y2="16" />
  <polygon points="56,16 50,13 50,19" fill="currentColor" stroke="none" />
  <line x1="38" y1="32" x2="56" y2="32" />
  <polygon points="56,32 50,29 50,35" fill="currentColor" stroke="none" />
  <line x1="38" y1="48" x2="56" y2="48" />
  <polygon points="56,48 50,45 50,51" fill="currentColor" stroke="none" />
</svg>`;

/** Application Gateway — gateway box with routing fan-out. */
export const AZURE_PRO_APPLICATION_GATEWAY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="6" y="14" width="52" height="36" rx="4" />
  <line x1="6" y1="32" x2="20" y2="32" />
  <circle cx="24" cy="32" r="4" fill="currentColor" opacity="0.15" />
  <line x1="28" y1="32" x2="36" y2="20" />
  <line x1="28" y1="32" x2="36" y2="32" />
  <line x1="28" y1="32" x2="36" y2="44" />
  <polygon points="42,20 36,17 36,23" fill="currentColor" stroke="none" />
  <polygon points="42,32 36,29 36,35" fill="currentColor" stroke="none" />
  <polygon points="42,44 36,41 36,47" fill="currentColor" stroke="none" />
  <rect x="42" y="16" width="10" height="8" rx="1" />
  <rect x="42" y="28" width="10" height="8" rx="1" />
  <rect x="42" y="40" width="10" height="8" rx="1" />
</svg>`;

/** Front Door — shield with globe and CDN edge lines. */
export const AZURE_PRO_FRONT_DOOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M32 6 L54 18 V42 C54 50 32 58 32 58 C32 58 10 50 10 42 V18 Z" />
  <path d="M32 6 L54 18 V42 C54 50 32 58 32 58 C32 58 10 50 10 42 V18 Z" fill="currentColor" opacity="0.05" />
  <circle cx="32" cy="32" r="10" />
  <line x1="22" y1="32" x2="42" y2="32" />
  <line x1="32" y1="22" x2="32" y2="42" />
  <ellipse cx="32" cy="32" rx="4" ry="10" />
</svg>`;

/** DNS Zone — globe with DNS label. */
export const AZURE_PRO_DNS_ZONE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="32" cy="26" r="18" />
  <line x1="14" y1="26" x2="50" y2="26" />
  <ellipse cx="32" cy="26" rx="7" ry="18" />
  <path d="M16 18 h32" />
  <path d="M16 34 h32" />
  <text x="32" y="56" text-anchor="middle" font-size="11" font-weight="bold" fill="currentColor" stroke="none" font-family="sans-serif">DNS</text>
</svg>`;

/** ExpressRoute — dedicated line with plugs and express label. */
export const AZURE_PRO_EXPRESSROUTE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="4" y="22" width="16" height="20" rx="3" />
  <rect x="44" y="22" width="16" height="20" rx="3" />
  <line x1="20" y1="28" x2="44" y2="28" stroke-width="3" />
  <line x1="20" y1="36" x2="44" y2="36" stroke-width="3" />
  <circle cx="12" cy="32" r="3" fill="currentColor" />
  <circle cx="52" cy="32" r="3" fill="currentColor" />
  <polygon points="36,28 32,26 32,30" fill="currentColor" stroke="none" />
  <polygon points="28,36 32,34 32,38" fill="currentColor" stroke="none" />
  <line x1="12" y1="16" x2="12" y2="22" />
  <line x1="52" y1="16" x2="52" y2="22" />
  <line x1="12" y1="42" x2="12" y2="48" />
  <line x1="52" y1="42" x2="52" y2="48" />
</svg>`;

// ── Security ─────────────────────────────────────────────

/** Key Vault — vault safe with key. */
export const AZURE_PRO_KEY_VAULT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="10" y="10" width="44" height="44" rx="6" />
  <rect x="16" y="16" width="32" height="32" rx="3" />
  <circle cx="32" cy="30" r="6" />
  <circle cx="32" cy="30" r="2" fill="currentColor" />
  <line x1="32" y1="36" x2="32" y2="44" />
  <line x1="32" y1="40" x2="36" y2="38" />
  <rect x="29" y="42" width="6" height="3" rx="1" fill="currentColor" />
</svg>`;

/** Active Directory (Entra ID) — people group with shield. */
export const AZURE_PRO_ACTIVE_DIRECTORY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="22" cy="16" r="7" />
  <path d="M10 34 C10 28 16 26 22 26 C28 26 34 28 34 34" />
  <circle cx="42" cy="20" r="5" />
  <path d="M34 36 C34 32 38 30 42 30 C46 30 50 32 50 36" />
  <path d="M32 40 L44 46 V54 C44 58 32 60 32 60 C32 60 20 58 20 54 V46 Z" />
  <polyline points="27,50 31,54 39,46" stroke-width="2" />
</svg>`;

/** Sentinel — eye with radar sweep. */
export const AZURE_PRO_SENTINEL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M4 32 C12 18 22 12 32 12 C42 12 52 18 60 32 C52 46 42 52 32 52 C22 52 12 46 4 32 Z" />
  <circle cx="32" cy="32" r="10" />
  <circle cx="32" cy="32" r="4" fill="currentColor" opacity="0.3" />
  <path d="M32 32 L42 22" stroke-width="2.5" />
  <circle cx="42" cy="22" r="2" fill="currentColor" />
</svg>`;

/** DDoS Protection — shield with deflection arrows. */
export const AZURE_PRO_DDOS_PROTECTION_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M32 4 L52 14 V32 C52 44 32 56 32 56 C32 56 12 44 12 32 V14 Z" />
  <path d="M32 4 L52 14 V32 C52 44 32 56 32 56 C32 56 12 44 12 32 V14 Z" fill="currentColor" opacity="0.06" />
  <line x1="4" y1="20" x2="16" y2="26" />
  <path d="M16 26 L10 32" />
  <polygon points="10,32 14,30 12,34" fill="currentColor" stroke="none" />
  <line x1="4" y1="32" x2="16" y2="34" />
  <path d="M16 34 L10 40" />
  <polygon points="10,40 14,38 12,42" fill="currentColor" stroke="none" />
  <line x1="4" y1="44" x2="14" y2="42" />
  <path d="M14 42 L8 48" />
  <polygon points="8,48 12,46 10,50" fill="currentColor" stroke="none" />
</svg>`;

// ── Management ───────────────────────────────────────────

/** Monitor — dashboard gauge with needle. */
export const AZURE_PRO_MONITOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="32" cy="32" r="22" />
  <circle cx="32" cy="32" r="18" />
  <line x1="32" y1="32" x2="40" y2="20" stroke-width="2.5" />
  <circle cx="32" cy="32" r="3" fill="currentColor" />
  <line x1="32" y1="10" x2="32" y2="14" />
  <line x1="32" y1="50" x2="32" y2="54" />
  <line x1="10" y1="32" x2="14" y2="32" />
  <line x1="50" y1="32" x2="54" y2="32" />
  <line x1="17" y1="17" x2="20" y2="20" />
  <line x1="44" y1="17" x2="47" y2="20" />
  <polyline points="18,48 24,42 30,46 38,38 44,42" stroke-width="1.5" />
</svg>`;

/** Log Analytics — magnifying glass over log lines. */
export const AZURE_PRO_LOG_ANALYTICS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="8" y="8" width="36" height="44" rx="3" />
  <line x1="14" y1="18" x2="38" y2="18" />
  <line x1="14" y1="26" x2="34" y2="26" />
  <line x1="14" y1="34" x2="30" y2="34" />
  <line x1="14" y1="42" x2="28" y2="42" />
  <circle cx="44" cy="40" r="10" />
  <line x1="51" y1="47" x2="58" y2="54" stroke-width="2.5" />
  <circle cx="44" cy="40" r="4" fill="currentColor" opacity="0.1" />
</svg>`;

/** DevOps — infinity loop with gear. */
export const AZURE_PRO_DEVOPS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M18 32 C18 22 24 18 30 22 L34 24 L38 22 C44 18 50 22 50 32 C50 42 44 46 38 42 L34 40 L30 42 C24 46 18 42 18 32 Z" stroke-width="2.5" />
  <path d="M8 32 C8 18 18 12 28 18 L32 20 L36 18 C46 12 56 18 56 32 C56 46 46 52 36 46 L32 44 L28 46 C18 52 8 46 8 32 Z" stroke-width="1.5" stroke-dasharray="3 2" />
  <circle cx="32" cy="32" r="4" />
  <circle cx="32" cy="32" r="2" fill="currentColor" />
</svg>`;

/** Resource Group — folder/group with brace. */
export const AZURE_PRO_RESOURCE_GROUP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M6 18 H24 L28 12 H54 A4 4 0 0 1 58 16 V52 A4 4 0 0 1 54 56 H10 A4 4 0 0 1 6 52 V18 Z" />
  <line x1="6" y1="24" x2="58" y2="24" />
  <rect x="16" y="30" width="12" height="10" rx="2" fill="currentColor" opacity="0.1" />
  <rect x="34" y="30" width="12" height="10" rx="2" fill="currentColor" opacity="0.1" />
  <rect x="16" y="44" width="12" height="6" rx="2" fill="currentColor" opacity="0.1" />
</svg>`;

// ── AI ───────────────────────────────────────────────────

/** Cognitive Services — brain with circuits. */
export const AZURE_PRO_COGNITIVE_SERVICES_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M32 8 C22 8 16 14 16 22 C16 26 18 30 18 30 C14 32 12 36 12 40 C12 48 18 52 24 52 L40 52 C46 52 52 48 52 40 C52 36 50 32 46 30 C46 30 48 26 48 22 C48 14 42 8 32 8 Z" />
  <line x1="32" y1="20" x2="32" y2="44" />
  <path d="M24 26 C26 28 30 28 32 26" />
  <path d="M32 26 C34 28 38 28 40 26" />
  <path d="M24 36 C26 38 30 38 32 36" />
  <path d="M32 36 C34 38 38 38 40 36" />
  <circle cx="24" cy="20" r="2" fill="currentColor" />
  <circle cx="40" cy="20" r="2" fill="currentColor" />
</svg>`;

/** OpenAI Service — brain with AI sparkle. */
export const AZURE_PRO_OPENAI_SERVICE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M32 10 C22 10 16 16 16 24 C16 28 18 32 18 32 C14 34 12 38 12 42 C12 50 18 54 24 54 L40 54 C46 54 52 50 52 42 C52 38 50 34 46 32 C46 32 48 28 48 24 C48 16 42 10 32 10 Z" />
  <circle cx="28" cy="30" r="3" />
  <circle cx="38" cy="30" r="3" />
  <path d="M26 40 C28 44 36 44 38 40" />
  <line x1="52" y1="12" x2="52" y2="4" stroke-width="1.5" />
  <line x1="48" y1="8" x2="56" y2="8" stroke-width="1.5" />
  <line x1="56" y1="18" x2="56" y2="14" stroke-width="1" />
  <line x1="54" y1="16" x2="58" y2="16" stroke-width="1" />
</svg>`;
