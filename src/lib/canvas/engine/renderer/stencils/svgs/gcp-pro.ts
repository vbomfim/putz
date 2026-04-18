/**
 * GCP Pro hand-crafted SVG icons for the stencil catalog.
 *
 * Twenty-five monochrome line-art icons (64×64 viewBox) representing
 * key Google Cloud Platform services across compute, storage, database,
 * networking, AI/ML, and management. Each icon uses `currentColor`
 * for fills/strokes to support theming.
 *
 * @module
 */

// ── Compute ──────────────────────────────────────────────

/** Compute Engine — VM server with hexagonal badge. */
export const GCP_PRO_COMPUTE_ENGINE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="14" y="12" width="36" height="40" rx="3" />
  <line x1="14" y1="22" x2="50" y2="22" />
  <line x1="14" y1="42" x2="50" y2="42" />
  <circle cx="20" cy="17" r="2" fill="currentColor" />
  <circle cx="28" cy="17" r="2" fill="currentColor" />
  <rect x="20" y="27" width="24" height="10" rx="2" fill="currentColor" opacity="0.15" />
  <polygon points="32,44 38,47 38,53 32,56 26,53 26,47" />
  <circle cx="32" cy="50" r="2" fill="currentColor" />
  <line x1="8" y1="32" x2="14" y2="32" />
  <line x1="50" y1="32" x2="56" y2="32" />
</svg>`;

/** App Engine — cloud with gear. */
export const GCP_PRO_APP_ENGINE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M16 40 C8 40 4 34 4 28 C4 22 8 16 16 16 C18 8 26 4 34 4 C44 4 52 10 52 20 C58 20 60 26 60 30 C60 36 56 40 48 40 Z" />
  <circle cx="32" cy="28" r="8" />
  <circle cx="32" cy="28" r="3" fill="currentColor" />
  <line x1="32" y1="20" x2="32" y2="18" stroke-width="2.5" />
  <line x1="32" y1="36" x2="32" y2="38" stroke-width="2.5" />
  <line x1="24" y1="28" x2="22" y2="28" stroke-width="2.5" />
  <line x1="40" y1="28" x2="42" y2="28" stroke-width="2.5" />
  <rect x="18" y="46" width="28" height="8" rx="3" />
  <line x1="32" y1="40" x2="32" y2="46" />
</svg>`;

/** Cloud Functions — lightning bolt in brackets. */
export const GCP_PRO_CLOUD_FUNCTIONS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M20 8 L10 32 L20 56" stroke-width="3" />
  <path d="M44 8 L54 32 L44 56" stroke-width="3" />
  <polygon points="36,12 24,34 32,34 28,52 40,30 32,30" fill="currentColor" opacity="0.2" />
  <polygon points="36,12 24,34 32,34 28,52 40,30 32,30" />
</svg>`;

/** GKE — Kubernetes wheel with container outline. */
export const GCP_PRO_GKE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="32" cy="32" r="20" />
  <circle cx="32" cy="32" r="8" />
  <line x1="32" y1="12" x2="32" y2="24" />
  <line x1="32" y1="40" x2="32" y2="52" />
  <line x1="12" y1="32" x2="24" y2="32" />
  <line x1="40" y1="32" x2="52" y2="32" />
  <line x1="17.9" y1="17.9" x2="26.3" y2="26.3" />
  <line x1="37.7" y1="37.7" x2="46.1" y2="46.1" />
  <line x1="46.1" y1="17.9" x2="37.7" y2="26.3" />
  <line x1="26.3" y1="37.7" x2="17.9" y2="46.1" />
  <circle cx="32" cy="12" r="3" fill="currentColor" />
  <circle cx="32" cy="52" r="3" fill="currentColor" />
  <circle cx="12" cy="32" r="3" fill="currentColor" />
  <circle cx="52" cy="32" r="3" fill="currentColor" />
</svg>`;

/** Cloud Run — container with play arrow. */
export const GCP_PRO_CLOUD_RUN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="10" y="10" width="44" height="44" rx="4" />
  <line x1="10" y1="20" x2="54" y2="20" />
  <circle cx="16" cy="15" r="2" fill="currentColor" />
  <circle cx="24" cy="15" r="2" fill="currentColor" />
  <polygon points="26,28 26,48 44,38" fill="currentColor" opacity="0.2" />
  <polygon points="26,28 26,48 44,38" />
</svg>`;

// ── Storage ──────────────────────────────────────────────

/** Cloud Storage — bucket with cloud. */
export const GCP_PRO_CLOUD_STORAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M16 24 L14 52 C14 54 20 58 32 58 C44 58 50 54 50 52 L48 24" />
  <ellipse cx="32" cy="24" rx="16" ry="6" />
  <path d="M14 34 C14 34 20 38 32 38 C44 38 50 34 50 34" />
  <path d="M14 44 C14 44 20 48 32 48 C44 48 50 44 50 44" />
  <path d="M24 18 C22 12 26 6 34 6 C40 6 44 10 44 14" />
  <path d="M44 14 C48 14 50 18 48 20" />
  <path d="M22 16 C18 16 16 18 18 20" />
</svg>`;

/** Persistent Disk — disk platter with spindle. */
export const GCP_PRO_PERSISTENT_DISK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="32" cy="32" r="24" />
  <circle cx="32" cy="32" r="16" />
  <circle cx="32" cy="32" r="6" />
  <circle cx="32" cy="32" r="2" fill="currentColor" />
  <line x1="36" y1="28" x2="46" y2="18" stroke-width="1.5" />
  <path d="M4 32 C4 16 16 4 32 4" stroke-dasharray="4 3" stroke-width="1" />
</svg>`;

/** Filestore — file cabinet with folder tab. */
export const GCP_PRO_FILESTORE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="12" y="8" width="40" height="48" rx="3" />
  <line x1="12" y1="24" x2="52" y2="24" />
  <line x1="12" y1="40" x2="52" y2="40" />
  <path d="M18 8 L18 4 L30 4 L34 8" />
  <rect x="18" y="12" width="12" height="4" rx="1" fill="currentColor" opacity="0.3" />
  <rect x="18" y="28" width="12" height="4" rx="1" fill="currentColor" opacity="0.3" />
  <rect x="18" y="44" width="12" height="4" rx="1" fill="currentColor" opacity="0.3" />
  <circle cx="44" cy="16" r="2" fill="currentColor" />
  <circle cx="44" cy="32" r="2" fill="currentColor" />
  <circle cx="44" cy="48" r="2" fill="currentColor" />
</svg>`;

// ── Database ─────────────────────────────────────────────

/** Cloud SQL — database cylinder with cloud accent. */
export const GCP_PRO_CLOUD_SQL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <ellipse cx="32" cy="16" rx="18" ry="8" />
  <path d="M14 16v32c0 4.4 8 8 18 8s18-3.6 18-8V16" />
  <path d="M14 28 C14 32.4 22 36 32 36 C42 36 50 32.4 50 28" />
  <path d="M14 40 C14 44.4 22 48 32 48 C42 48 50 44.4 50 40" />
  <path d="M42 8 C46 4 52 4 54 8 C56 4 60 6 58 10 C62 10 62 14 58 14 L42 14" />
</svg>`;

/** Firestore — document with flame accent. */
export const GCP_PRO_FIRESTORE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M14 4 L42 4 L50 14 L50 60 L14 60 Z" />
  <path d="M42 4 L42 14 L50 14" />
  <line x1="22" y1="24" x2="42" y2="24" />
  <line x1="22" y1="32" x2="42" y2="32" />
  <line x1="22" y1="40" x2="34" y2="40" />
  <path d="M40 44 C40 38 46 40 44 34 C50 38 50 48 44 52 C48 48 42 44 40 44Z" fill="currentColor" opacity="0.2" />
  <path d="M40 44 C40 38 46 40 44 34 C50 38 50 48 44 52 C48 48 42 44 40 44Z" />
</svg>`;

/** Bigtable — wide table grid with rows. */
export const GCP_PRO_BIGTABLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="6" y="10" width="52" height="44" rx="3" />
  <line x1="6" y1="22" x2="58" y2="22" />
  <line x1="6" y1="34" x2="58" y2="34" />
  <line x1="6" y1="46" x2="58" y2="46" />
  <line x1="22" y1="10" x2="22" y2="54" />
  <line x1="42" y1="10" x2="42" y2="54" />
  <rect x="8" y="12" width="12" height="8" rx="1" fill="currentColor" opacity="0.15" />
  <rect x="24" y="24" width="16" height="8" rx="1" fill="currentColor" opacity="0.15" />
  <rect x="44" y="36" width="12" height="8" rx="1" fill="currentColor" opacity="0.15" />
</svg>`;

/** Spanner — globe with database layers. */
export const GCP_PRO_SPANNER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="32" cy="32" r="22" />
  <ellipse cx="32" cy="32" rx="10" ry="22" />
  <line x1="10" y1="24" x2="54" y2="24" />
  <line x1="10" y1="40" x2="54" y2="40" />
  <line x1="10" y1="32" x2="54" y2="32" />
  <circle cx="32" cy="24" r="3" fill="currentColor" />
  <circle cx="32" cy="40" r="3" fill="currentColor" />
  <circle cx="22" cy="32" r="2" fill="currentColor" />
  <circle cx="42" cy="32" r="2" fill="currentColor" />
</svg>`;

/** BigQuery — magnifying glass on data rows. */
export const GCP_PRO_BIGQUERY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="6" y="8" width="36" height="40" rx="3" />
  <line x1="12" y1="18" x2="36" y2="18" />
  <line x1="12" y1="26" x2="36" y2="26" />
  <line x1="12" y1="34" x2="30" y2="34" />
  <line x1="12" y1="42" x2="24" y2="42" />
  <rect x="12" y="14" width="8" height="4" fill="currentColor" opacity="0.15" />
  <rect x="12" y="22" width="16" height="4" fill="currentColor" opacity="0.15" />
  <circle cx="44" cy="40" r="12" />
  <line x1="52" y1="48" x2="60" y2="56" stroke-width="3" />
  <circle cx="44" cy="40" r="4" fill="currentColor" opacity="0.15" />
</svg>`;

// ── Networking ────────────────────────────────────────────

/** VPC — network boundary with nodes. */
export const GCP_PRO_VPC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="6" y="6" width="52" height="52" rx="6" stroke-dasharray="6 3" />
  <circle cx="20" cy="20" r="6" />
  <circle cx="44" cy="20" r="6" />
  <circle cx="20" cy="44" r="6" />
  <circle cx="44" cy="44" r="6" />
  <line x1="26" y1="20" x2="38" y2="20" />
  <line x1="26" y1="44" x2="38" y2="44" />
  <line x1="20" y1="26" x2="20" y2="38" />
  <line x1="44" y1="26" x2="44" y2="38" />
  <line x1="25" y1="25" x2="39" y2="39" />
  <line x1="39" y1="25" x2="25" y2="39" />
</svg>`;

/** Cloud CDN — globe with edge arrows. */
export const GCP_PRO_CLOUD_CDN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="32" cy="32" r="16" />
  <ellipse cx="32" cy="32" rx="6" ry="16" />
  <line x1="16" y1="32" x2="48" y2="32" />
  <line x1="32" y1="16" x2="32" y2="48" />
  <line x1="32" y1="6" x2="32" y2="12" />
  <polygon points="32,4 29,10 35,10" fill="currentColor" stroke="none" />
  <line x1="32" y1="52" x2="32" y2="58" />
  <polygon points="32,60 29,54 35,54" fill="currentColor" stroke="none" />
  <line x1="6" y1="32" x2="12" y2="32" />
  <polygon points="4,32 10,29 10,35" fill="currentColor" stroke="none" />
  <line x1="52" y1="32" x2="58" y2="32" />
  <polygon points="60,32 54,29 54,35" fill="currentColor" stroke="none" />
</svg>`;

/** Cloud DNS — address book with globe. */
export const GCP_PRO_CLOUD_DNS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="10" y="6" width="34" height="52" rx="3" />
  <line x1="10" y1="16" x2="44" y2="16" />
  <line x1="10" y1="28" x2="44" y2="28" />
  <line x1="10" y1="40" x2="44" y2="40" />
  <text x="16" y="14" font-size="6" font-family="monospace" fill="currentColor" stroke="none">DNS</text>
  <rect x="14" y="20" width="16" height="4" rx="1" fill="currentColor" opacity="0.15" />
  <rect x="14" y="32" width="20" height="4" rx="1" fill="currentColor" opacity="0.15" />
  <rect x="14" y="44" width="12" height="4" rx="1" fill="currentColor" opacity="0.15" />
  <circle cx="50" cy="46" r="12" />
  <ellipse cx="50" cy="46" rx="5" ry="12" />
  <line x1="38" y1="46" x2="62" y2="46" />
</svg>`;

/** Cloud Load Balancing — balanced scales with arrows. */
export const GCP_PRO_CLOUD_LOAD_BALANCING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="32" cy="10" r="6" />
  <line x1="32" y1="16" x2="32" y2="24" />
  <line x1="32" y1="24" x2="12" y2="38" />
  <line x1="32" y1="24" x2="32" y2="38" />
  <line x1="32" y1="24" x2="52" y2="38" />
  <rect x="4" y="38" width="16" height="12" rx="2" />
  <rect x="24" y="38" width="16" height="12" rx="2" />
  <rect x="44" y="38" width="16" height="12" rx="2" />
  <circle cx="12" cy="44" r="2" fill="currentColor" />
  <circle cx="32" cy="44" r="2" fill="currentColor" />
  <circle cx="52" cy="44" r="2" fill="currentColor" />
  <polygon points="32,6 29,10 35,10" fill="currentColor" stroke="none" />
  <line x1="4" y1="56" x2="60" y2="56" stroke-width="2.5" />
</svg>`;

/** Cloud Armor — shield with checkmark. */
export const GCP_PRO_CLOUD_ARMOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M32 4 L54 14 V34 C54 46 44 54 32 60 C20 54 10 46 10 34 V14 Z" />
  <path d="M32 10 L48 18 V34 C48 44 40 50 32 54 C24 50 16 44 16 34 V18 Z" fill="currentColor" opacity="0.08" />
  <polyline points="22,32 30,40 42,24" stroke-width="3" />
</svg>`;

// ── AI/ML ────────────────────────────────────────────────

/** Vertex AI — brain with neural connections. */
export const GCP_PRO_VERTEX_AI_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M20 12 C12 12 8 20 12 28 C8 32 8 40 14 44 C12 50 18 58 26 56 C30 60 38 60 42 56 C48 58 54 52 52 44 C58 40 58 32 52 28 C56 20 50 12 42 14 C38 8 28 8 20 12Z" />
  <circle cx="24" cy="24" r="3" fill="currentColor" />
  <circle cx="40" cy="24" r="3" fill="currentColor" />
  <circle cx="32" cy="36" r="3" fill="currentColor" />
  <circle cx="20" cy="42" r="3" fill="currentColor" />
  <circle cx="44" cy="42" r="3" fill="currentColor" />
  <line x1="24" y1="27" x2="32" y2="33" />
  <line x1="40" y1="27" x2="32" y2="33" />
  <line x1="24" y1="24" x2="40" y2="24" />
  <line x1="32" y1="39" x2="20" y2="42" />
  <line x1="32" y1="39" x2="44" y2="42" />
</svg>`;

/** Cloud Vision — eye with scan lines. */
export const GCP_PRO_CLOUD_VISION_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M4 32 C4 32 16 12 32 12 C48 12 60 32 60 32 C60 32 48 52 32 52 C16 52 4 32 4 32Z" />
  <circle cx="32" cy="32" r="10" />
  <circle cx="32" cy="32" r="4" fill="currentColor" />
  <line x1="8" y1="8" x2="16" y2="8" />
  <line x1="8" y1="8" x2="8" y2="16" />
  <line x1="56" y1="8" x2="48" y2="8" />
  <line x1="56" y1="8" x2="56" y2="16" />
  <line x1="8" y1="56" x2="16" y2="56" />
  <line x1="8" y1="56" x2="8" y2="48" />
  <line x1="56" y1="56" x2="48" y2="56" />
  <line x1="56" y1="56" x2="56" y2="48" />
</svg>`;

/** Cloud Speech — microphone with sound waves. */
export const GCP_PRO_CLOUD_SPEECH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="26" y="6" width="12" height="28" rx="6" />
  <path d="M18 28 C18 38 24 44 32 44 C40 44 46 38 46 28" />
  <line x1="32" y1="44" x2="32" y2="54" />
  <line x1="22" y1="54" x2="42" y2="54" />
  <path d="M50 20 C54 24 54 32 50 36" />
  <path d="M54 16 C60 22 60 34 54 40" />
  <path d="M14 20 C10 24 10 32 14 36" />
  <path d="M10 16 C4 22 4 34 10 40" />
</svg>`;

// ── Management ───────────────────────────────────────────

/** Cloud Monitoring — dashboard gauge with needle. */
export const GCP_PRO_CLOUD_MONITORING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="4" y="6" width="56" height="42" rx="4" />
  <path d="M32 48 L28 52 H36 Z" fill="currentColor" stroke="none" />
  <line x1="20" y1="52" x2="44" y2="52" />
  <path d="M16 40 A20 20 0 0 1 48 40" />
  <line x1="32" y1="38" x2="42" y2="22" stroke-width="2.5" />
  <circle cx="32" cy="38" r="3" fill="currentColor" />
  <circle cx="16" cy="40" r="2" fill="currentColor" opacity="0.5" />
  <circle cx="48" cy="40" r="2" fill="currentColor" opacity="0.5" />
  <circle cx="22" cy="24" r="2" fill="currentColor" opacity="0.5" />
  <circle cx="42" cy="24" r="2" fill="currentColor" opacity="0.5" />
</svg>`;

/** Cloud Logging — scrolling log lines with magnifier. */
export const GCP_PRO_CLOUD_LOGGING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="6" y="6" width="40" height="52" rx="3" />
  <line x1="14" y1="16" x2="38" y2="16" />
  <line x1="14" y1="24" x2="34" y2="24" />
  <line x1="14" y1="32" x2="38" y2="32" />
  <line x1="14" y1="40" x2="28" y2="40" />
  <line x1="14" y1="48" x2="32" y2="48" />
  <circle cx="48" cy="42" r="10" />
  <line x1="55" y1="49" x2="62" y2="56" stroke-width="3" />
  <rect x="14" y="14" width="6" height="4" fill="currentColor" opacity="0.3" />
  <rect x="14" y="30" width="6" height="4" fill="currentColor" opacity="0.3" />
</svg>`;

/** Cloud Build — wrench and hammer crossed. */
export const GCP_PRO_CLOUD_BUILD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="8" y="8" width="48" height="48" rx="6" />
  <line x1="8" y1="20" x2="56" y2="20" />
  <circle cx="14" cy="14" r="2" fill="currentColor" />
  <circle cx="22" cy="14" r="2" fill="currentColor" />
  <circle cx="30" cy="14" r="2" fill="currentColor" />
  <path d="M20 30 L32 42 L36 38 L24 26 Z" fill="currentColor" opacity="0.15" />
  <path d="M20 30 L32 42 L36 38 L24 26 Z" />
  <path d="M44 30 L32 42 L28 38 L40 26 Z" fill="currentColor" opacity="0.15" />
  <path d="M44 30 L32 42 L28 38 L40 26 Z" />
  <circle cx="22" cy="28" r="4" />
  <circle cx="42" cy="28" r="4" />
  <line x1="32" y1="42" x2="32" y2="50" stroke-width="2.5" />
</svg>`;

/** Pub/Sub — fan-out message arrows from central hub. */
export const GCP_PRO_PUB_SUB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="32" cy="32" r="8" fill="currentColor" opacity="0.15" />
  <circle cx="32" cy="32" r="8" />
  <circle cx="10" cy="14" r="6" />
  <circle cx="54" cy="14" r="6" />
  <circle cx="10" cy="50" r="6" />
  <circle cx="54" cy="50" r="6" />
  <line x1="26" y1="26" x2="14" y2="18" />
  <line x1="38" y1="26" x2="50" y2="18" />
  <line x1="26" y1="38" x2="14" y2="46" />
  <line x1="38" y1="38" x2="50" y2="46" />
  <polygon points="14,18 18,20 16,16" fill="currentColor" stroke="none" />
  <polygon points="50,18 46,16 48,20" fill="currentColor" stroke="none" />
  <polygon points="14,46 16,48 18,44" fill="currentColor" stroke="none" />
  <polygon points="50,46 48,44 46,48" fill="currentColor" stroke="none" />
</svg>`;
