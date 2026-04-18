/**
 * Kubernetes SVG icons for the stencil catalog.
 *
 * Fifteen monochrome icons representing core Kubernetes resources.
 * Container types (Namespace, Cluster) use larger viewBoxes.
 * All standard icons use 64×64 viewBox with currentColor.
 *
 * @module
 */

// ── Workloads ────────────────────────────────────────────

/** Pod — hexagon with inner circle. */
export const K8S_POD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <polygon points="32,4 56,18 56,46 32,60 8,46 8,18" />
  <circle cx="32" cy="32" r="8" fill="currentColor" opacity="0.1" />
  <circle cx="32" cy="32" r="8" />
</svg>`;

/** Deployment — hexagon with circular-arrow for rolling update. */
export const K8S_DEPLOYMENT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <polygon points="32,4 56,18 56,46 32,60 8,46 8,18" />
  <path d="M22 32 a10 10 0 0 1 17-7" />
  <polygon points="41,23 39,29 35,25" fill="currentColor" stroke="none" />
  <path d="M42 32 a10 10 0 0 1-17 7" />
  <polygon points="23,41 25,35 29,39" fill="currentColor" stroke="none" />
</svg>`;

/** ReplicaSet — stacked hexagons. */
export const K8S_REPLICASET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <polygon points="32,10 50,20 50,40 32,50 14,40 14,20" opacity="0.3" />
  <polygon points="28,6 46,16 46,36 28,46 10,36 10,16" opacity="0.5" />
  <polygon points="36,14 54,24 54,44 36,54 18,44 18,24" />
  <circle cx="36" cy="39" r="4" fill="currentColor" opacity="0.15" />
</svg>`;

/** StatefulSet — hexagon with sequential numbers. */
export const K8S_STATEFULSET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <polygon points="32,4 56,18 56,46 32,60 8,46 8,18" />
  <line x1="20" y1="24" x2="44" y2="24" />
  <line x1="20" y1="32" x2="44" y2="32" />
  <line x1="20" y1="40" x2="44" y2="40" />
  <text x="16" y="28" font-size="7" font-family="monospace" fill="currentColor" stroke="none">0</text>
  <text x="16" y="36" font-size="7" font-family="monospace" fill="currentColor" stroke="none">1</text>
  <text x="16" y="44" font-size="7" font-family="monospace" fill="currentColor" stroke="none">2</text>
</svg>`;

/** DaemonSet — hexagon with node-spread dots. */
export const K8S_DAEMONSET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <polygon points="32,4 56,18 56,46 32,60 8,46 8,18" />
  <circle cx="24" cy="24" r="4" fill="currentColor" opacity="0.2" />
  <circle cx="40" cy="24" r="4" fill="currentColor" opacity="0.2" />
  <circle cx="24" cy="40" r="4" fill="currentColor" opacity="0.2" />
  <circle cx="40" cy="40" r="4" fill="currentColor" opacity="0.2" />
  <circle cx="24" cy="24" r="4" />
  <circle cx="40" cy="24" r="4" />
  <circle cx="24" cy="40" r="4" />
  <circle cx="40" cy="40" r="4" />
</svg>`;

/** Job — hexagon with checkmark. */
export const K8S_JOB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <polygon points="32,4 56,18 56,46 32,60 8,46 8,18" />
  <polyline points="22,32 30,40 44,24" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
</svg>`;

/** CronJob — hexagon with clock. */
export const K8S_CRONJOB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <polygon points="32,4 56,18 56,46 32,60 8,46 8,18" />
  <circle cx="32" cy="32" r="10" />
  <line x1="32" y1="32" x2="32" y2="25" stroke-width="2.5" stroke-linecap="round" />
  <line x1="32" y1="32" x2="38" y2="35" stroke-width="2" stroke-linecap="round" />
  <circle cx="32" cy="32" r="1.5" fill="currentColor" />
</svg>`;

// ── Networking ────────────────────────────────────────────

/** Service — hexagon with play/forward triangle. */
export const K8S_SERVICE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <polygon points="32,4 56,18 56,46 32,60 8,46 8,18" />
  <polygon points="24,22 42,32 24,42" fill="currentColor" opacity="0.15" />
  <polygon points="24,22 42,32 24,42" />
</svg>`;

/** Ingress — arrow entering a box. */
export const K8S_INGRESS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="20" y="12" width="36" height="40" rx="3" />
  <line x1="4" y1="32" x2="28" y2="32" />
  <polygon points="26,26 36,32 26,38" fill="currentColor" stroke="none" />
  <line x1="38" y1="24" x2="48" y2="24" />
  <line x1="38" y1="32" x2="48" y2="32" />
  <line x1="38" y1="40" x2="48" y2="40" />
  <line x1="38" y1="24" x2="38" y2="40" />
</svg>`;

// ── Configuration ────────────────────────────────────────

/** ConfigMap — document with key-value pairs. */
export const K8S_CONFIGMAP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M14 8 h26 l10 10 v38 a2 2 0 0 1-2 2 H14 a2 2 0 0 1-2-2 V10 a2 2 0 0 1 2-2z" />
  <path d="M40 8 v10 h10" />
  <line x1="20" y1="26" x2="26" y2="26" stroke-width="2.5" />
  <line x1="30" y1="26" x2="44" y2="26" />
  <line x1="20" y1="34" x2="26" y2="34" stroke-width="2.5" />
  <line x1="30" y1="34" x2="44" y2="34" />
  <line x1="20" y1="42" x2="26" y2="42" stroke-width="2.5" />
  <line x1="30" y1="42" x2="44" y2="42" />
</svg>`;

/** Secret — padlock icon. */
export const K8S_SECRET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="14" y="28" width="36" height="28" rx="3" />
  <path d="M22 28 V20 a10 10 0 0 1 20 0 v8" />
  <circle cx="32" cy="42" r="4" fill="currentColor" opacity="0.2" />
  <circle cx="32" cy="42" r="4" />
  <line x1="32" y1="46" x2="32" y2="50" stroke-width="2.5" stroke-linecap="round" />
</svg>`;

/** PersistentVolume — storage cylinder with PV mark. */
export const K8S_PERSISTENT_VOLUME_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <ellipse cx="32" cy="16" rx="18" ry="8" />
  <path d="M14 16 v32 c0 4.4 8 8 18 8 s18-3.6 18-8 V16" />
  <path d="M14 30 c0 4.4 8 8 18 8 s18-3.6 18-8" />
  <line x1="26" y1="42" x2="32" y2="50" stroke-width="2.5" stroke-linecap="round" />
  <line x1="38" y1="42" x2="32" y2="50" stroke-width="2.5" stroke-linecap="round" />
</svg>`;

// ── Cluster Structure ────────────────────────────────────

/** Namespace — dashed boundary (large container). */
export const K8S_NAMESPACE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="4" y="4" width="192" height="142" rx="6" stroke-dasharray="8 4" />
  <line x1="4" y1="30" x2="50" y2="30" stroke-dasharray="8 4" />
</svg>`;

/** Node — server box with K8s wheel mark. */
export const K8S_NODE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="6" y="8" width="52" height="48" rx="4" />
  <line x1="6" y1="20" x2="58" y2="20" />
  <circle cx="14" cy="14" r="2" fill="currentColor" />
  <circle cx="20" cy="14" r="2" fill="currentColor" />
  <circle cx="32" cy="38" r="10" />
  <circle cx="32" cy="38" r="3" fill="currentColor" opacity="0.2" />
  <line x1="32" y1="28" x2="32" y2="32" />
  <line x1="32" y1="44" x2="32" y2="48" />
  <line x1="22" y1="38" x2="26" y2="38" />
  <line x1="38" y1="38" x2="42" y2="38" />
  <line x1="25" y1="31" x2="28" y2="34" />
  <line x1="36" y1="42" x2="39" y2="45" />
</svg>`;

/** Cluster — grouped nodes (large container). */
export const K8S_CLUSTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 200" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="4" y="4" width="242" height="192" rx="8" />
  <line x1="4" y1="34" x2="80" y2="34" />
  <rect x="20" y="50" width="80" height="56" rx="4" stroke-dasharray="4 2" />
  <circle cx="60" cy="78" r="10" />
  <circle cx="60" cy="78" r="3" fill="currentColor" opacity="0.2" />
  <rect x="140" y="50" width="80" height="56" rx="4" stroke-dasharray="4 2" />
  <circle cx="180" cy="78" r="10" />
  <circle cx="180" cy="78" r="3" fill="currentColor" opacity="0.2" />
  <rect x="80" y="126" width="80" height="56" rx="4" stroke-dasharray="4 2" />
  <circle cx="120" cy="154" r="10" />
  <circle cx="120" cy="154" r="3" fill="currentColor" opacity="0.2" />
</svg>`;
