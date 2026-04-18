/**
 * AWS Pro hand-crafted SVG icons for the stencil catalog.
 *
 * Thirty-two monochrome line-art icons (64×64 viewBox) representing
 * key AWS compute, storage, database, networking, security,
 * management, and messaging services. Each icon uses `currentColor`
 * for fills/strokes to support theming.
 *
 * @module
 */

// ── Compute ──────────────────────────────────────────────

/** EC2 — server box with compute grid. */
export const AWS_PRO_EC2_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="12" y="8" width="40" height="48" rx="3" />
  <rect x="18" y="14" width="12" height="10" rx="1" />
  <rect x="34" y="14" width="12" height="10" rx="1" />
  <rect x="18" y="28" width="12" height="10" rx="1" />
  <rect x="34" y="28" width="12" height="10" rx="1" />
  <circle cx="24" cy="48" r="2" fill="currentColor" />
  <circle cx="32" cy="48" r="2" fill="currentColor" />
  <circle cx="40" cy="48" r="2" fill="currentColor" />
</svg>`;

/** Lambda — lambda (λ) symbol in a rounded frame. */
export const AWS_PRO_LAMBDA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="8" y="8" width="48" height="48" rx="8" />
  <path d="M20 46 L30 18 H34 L38 30 L44 18 H48" stroke-width="2.5" />
  <path d="M38 30 L30 46 H20" stroke-width="2.5" />
</svg>`;

/** ECS — container boxes with orchestration circle. */
export const AWS_PRO_ECS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="6" y="24" width="18" height="24" rx="2" />
  <rect x="23" y="16" width="18" height="32" rx="2" />
  <rect x="40" y="24" width="18" height="24" rx="2" />
  <circle cx="32" cy="8" r="5" />
  <line x1="32" y1="13" x2="32" y2="16" />
  <line x1="28" y1="11" x2="15" y2="24" />
  <line x1="36" y1="11" x2="49" y2="24" />
</svg>`;

/** EKS — Kubernetes wheel inside AWS frame. */
export const AWS_PRO_EKS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="8" y="8" width="48" height="48" rx="4" />
  <circle cx="32" cy="32" r="14" />
  <circle cx="32" cy="32" r="4" fill="currentColor" opacity="0.2" />
  <line x1="32" y1="18" x2="32" y2="24" />
  <line x1="32" y1="40" x2="32" y2="46" />
  <line x1="19" y1="25" x2="24" y2="28" />
  <line x1="40" y1="36" x2="45" y2="39" />
  <line x1="19" y1="39" x2="24" y2="36" />
  <line x1="40" y1="28" x2="45" y2="25" />
</svg>`;

/** Fargate — serverless container (container with cloud). */
export const AWS_PRO_FARGATE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="14" y="26" width="36" height="28" rx="3" />
  <line x1="14" y1="36" x2="50" y2="36" />
  <line x1="14" y1="44" x2="50" y2="44" />
  <path d="M18 22 C18 14 24 10 30 10 C34 10 38 12 40 16 C42 14 46 14 48 16 C50 18 50 22 48 24 L18 24 C16 24 16 22 18 22Z" fill="currentColor" opacity="0.1" />
  <path d="M18 22 C18 14 24 10 30 10 C34 10 38 12 40 16 C42 14 46 14 48 16 C50 18 50 22 48 24" />
</svg>`;

/** Lightsail — lighthouse beacon. */
export const AWS_PRO_LIGHTSAIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M26 56 L22 32 L28 12 H36 L42 32 L38 56 Z" />
  <rect x="28" y="12" width="8" height="8" rx="1" fill="currentColor" opacity="0.2" />
  <line x1="22" y1="32" x2="42" y2="32" />
  <line x1="24" y1="44" x2="40" y2="44" />
  <path d="M20 8 L28 12" />
  <path d="M44 8 L36 12" />
  <path d="M16 16 L26 16" />
  <path d="M48 16 L38 16" />
</svg>`;

// ── Storage ──────────────────────────────────────────────

/** S3 — bucket shape. */
export const AWS_PRO_S3_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <ellipse cx="32" cy="14" rx="18" ry="6" />
  <path d="M14 14 v36 c0 3.3 8 6 18 6 s18-2.7 18-6 V14" />
  <ellipse cx="32" cy="50" rx="18" ry="6" stroke="none" fill="none" />
  <path d="M14 28 c0 3.3 8 6 18 6 s18-2.7 18-6" />
  <path d="M14 40 c0 3.3 8 6 18 6 s18-2.7 18-6" />
</svg>`;

/** EBS — block storage volume (stacked disks with label). */
export const AWS_PRO_EBS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="14" y="8" width="36" height="48" rx="4" />
  <line x1="14" y1="20" x2="50" y2="20" />
  <line x1="14" y1="32" x2="50" y2="32" />
  <line x1="14" y1="44" x2="50" y2="44" />
  <circle cx="42" cy="14" r="3" fill="currentColor" />
  <circle cx="42" cy="26" r="3" fill="currentColor" />
  <circle cx="42" cy="38" r="3" fill="currentColor" />
  <circle cx="42" cy="50" r="3" fill="currentColor" />
</svg>`;

/** EFS — elastic file system (folder with stretch arrows). */
export const AWS_PRO_EFS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M8 18 L8 52 L56 52 L56 24 L36 24 L32 18 Z" />
  <path d="M8 24 L56 24" />
  <line x1="24" y1="34" x2="24" y2="46" />
  <polygon points="24,34 21,38 27,38" fill="currentColor" stroke="none" />
  <polygon points="24,46 21,42 27,42" fill="currentColor" stroke="none" />
  <line x1="34" y1="34" x2="34" y2="46" />
  <polygon points="34,34 31,38 37,38" fill="currentColor" stroke="none" />
  <polygon points="34,46 31,42 37,42" fill="currentColor" stroke="none" />
</svg>`;

/** Glacier — snowflake in archive box. */
export const AWS_PRO_GLACIER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="10" y="10" width="44" height="44" rx="4" />
  <line x1="32" y1="18" x2="32" y2="46" />
  <line x1="20" y1="32" x2="44" y2="32" />
  <line x1="23" y1="21" x2="41" y2="43" />
  <line x1="41" y1="21" x2="23" y2="43" />
  <line x1="28" y1="20" x2="32" y2="24" />
  <line x1="36" y1="20" x2="32" y2="24" />
  <line x1="28" y1="44" x2="32" y2="40" />
  <line x1="36" y1="44" x2="32" y2="40" />
</svg>`;

// ── Database ─────────────────────────────────────────────

/** RDS — database cylinder with relation arrows. */
export const AWS_PRO_RDS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <ellipse cx="32" cy="16" rx="16" ry="6" />
  <path d="M16 16 v32 c0 3.3 7.2 6 16 6 s16-2.7 16-6 V16" />
  <path d="M16 28 c0 3.3 7.2 6 16 6 s16-2.7 16-6" />
  <path d="M16 40 c0 3.3 7.2 6 16 6 s16-2.7 16-6" />
  <line x1="6" y1="28" x2="14" y2="28" />
  <polygon points="6,28 10,25 10,31" fill="currentColor" stroke="none" />
  <line x1="50" y1="28" x2="58" y2="28" />
  <polygon points="58,28 54,25 54,31" fill="currentColor" stroke="none" />
</svg>`;

/** DynamoDB — database cylinder with lightning bolt. */
export const AWS_PRO_DYNAMODB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <ellipse cx="32" cy="16" rx="16" ry="6" />
  <path d="M16 16 v32 c0 3.3 7.2 6 16 6 s16-2.7 16-6 V16" />
  <path d="M16 28 c0 3.3 7.2 6 16 6 s16-2.7 16-6" />
  <path d="M30 32 L26 40 H34 L28 50" stroke-width="2.5" fill="none" />
  <polygon points="28,50 30,46 26,46" fill="currentColor" stroke="none" />
</svg>`;

/** Aurora — database cylinder with star/ring. */
export const AWS_PRO_AURORA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <ellipse cx="32" cy="18" rx="16" ry="6" />
  <path d="M16 18 v28 c0 3.3 7.2 6 16 6 s16-2.7 16-6 V18" />
  <path d="M16 30 c0 3.3 7.2 6 16 6 s16-2.7 16-6" />
  <circle cx="50" cy="14" r="8" />
  <circle cx="50" cy="14" r="3" fill="currentColor" opacity="0.3" />
  <line x1="50" y1="4" x2="50" y2="8" />
  <line x1="50" y1="20" x2="50" y2="24" />
  <line x1="40" y1="14" x2="44" y2="14" />
  <line x1="56" y1="14" x2="60" y2="14" />
</svg>`;

/** ElastiCache — cache cylinder with speed lines. */
export const AWS_PRO_ELASTICACHE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <ellipse cx="32" cy="16" rx="16" ry="6" />
  <path d="M16 16 v32 c0 3.3 7.2 6 16 6 s16-2.7 16-6 V16" />
  <path d="M16 28 c0 3.3 7.2 6 16 6 s16-2.7 16-6" />
  <line x1="4" y1="38" x2="14" y2="38" />
  <line x1="4" y1="42" x2="12" y2="42" />
  <line x1="4" y1="46" x2="10" y2="46" />
  <line x1="50" y1="38" x2="60" y2="38" />
  <line x1="52" y1="42" x2="60" y2="42" />
  <line x1="54" y1="46" x2="60" y2="46" />
</svg>`;

/** Redshift — data warehouse (cylinder with column chart). */
export const AWS_PRO_REDSHIFT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <ellipse cx="32" cy="14" rx="18" ry="6" />
  <path d="M14 14 v36 c0 3.3 8 6 18 6 s18-2.7 18-6 V14" />
  <rect x="22" y="34" width="4" height="14" fill="currentColor" opacity="0.2" />
  <rect x="30" y="26" width="4" height="22" fill="currentColor" opacity="0.2" />
  <rect x="38" y="30" width="4" height="18" fill="currentColor" opacity="0.2" />
  <line x1="22" y1="34" x2="22" y2="48" />
  <line x1="26" y1="34" x2="26" y2="48" />
  <line x1="30" y1="26" x2="30" y2="48" />
  <line x1="34" y1="26" x2="34" y2="48" />
  <line x1="38" y1="30" x2="38" y2="48" />
  <line x1="42" y1="30" x2="42" y2="48" />
</svg>`;

// ── Networking ────────────────────────────────────────────

/** VPC — network cloud with lock. */
export const AWS_PRO_VPC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M12 38 C4 38 4 28 10 26 C8 18 16 12 24 14 C28 8 38 8 42 14 C50 12 56 18 54 26 C60 28 60 38 52 38" />
  <path d="M12 38 L12 52 H52 V38" />
  <rect x="26" y="40" width="12" height="10" rx="2" />
  <path d="M28 40 V37 C28 33 36 33 36 37 V40" />
  <circle cx="32" cy="46" r="2" fill="currentColor" />
</svg>`;

/** CloudFront — globe with CDN distribution rays. */
export const AWS_PRO_CLOUDFRONT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="32" cy="32" r="20" />
  <ellipse cx="32" cy="32" rx="8" ry="20" />
  <line x1="12" y1="32" x2="52" y2="32" />
  <line x1="32" y1="12" x2="32" y2="52" />
  <line x1="4" y1="20" x2="12" y2="24" />
  <line x1="60" y1="20" x2="52" y2="24" />
  <line x1="4" y1="44" x2="12" y2="40" />
  <line x1="60" y1="44" x2="52" y2="40" />
  <line x1="32" y1="4" x2="32" y2="10" />
  <line x1="32" y1="54" x2="32" y2="60" />
</svg>`;

/** Route 53 — DNS globe with route arrows. */
export const AWS_PRO_ROUTE53_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="28" cy="32" r="18" />
  <ellipse cx="28" cy="32" rx="7" ry="18" />
  <line x1="10" y1="32" x2="46" y2="32" />
  <line x1="28" y1="14" x2="28" y2="50" />
  <path d="M46 20 L56 16 L54 26" fill="none" stroke-width="2" />
  <path d="M46 44 L56 48 L54 38" fill="none" stroke-width="2" />
  <text x="54" y="32" text-anchor="middle" font-size="8" font-family="sans-serif" fill="currentColor" stroke="none">53</text>
</svg>`;

/** ELB/ALB — balanced arrows through a bar. */
export const AWS_PRO_ELB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="26" y="8" width="12" height="48" rx="3" />
  <line x1="8" y1="22" x2="26" y2="22" />
  <polygon points="8,22 14,19 14,25" fill="currentColor" stroke="none" />
  <line x1="38" y1="16" x2="56" y2="16" />
  <polygon points="56,16 50,13 50,19" fill="currentColor" stroke="none" />
  <line x1="38" y1="32" x2="56" y2="32" />
  <polygon points="56,32 50,29 50,35" fill="currentColor" stroke="none" />
  <line x1="38" y1="48" x2="56" y2="48" />
  <polygon points="56,48 50,45 50,51" fill="currentColor" stroke="none" />
</svg>`;

/** API Gateway — gateway arch with API label. */
export const AWS_PRO_API_GATEWAY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M12 56 V20 C12 12 22 8 32 8 C42 8 52 12 52 20 V56" />
  <line x1="12" y1="56" x2="52" y2="56" />
  <line x1="12" y1="28" x2="52" y2="28" />
  <line x1="32" y1="28" x2="32" y2="56" />
  <circle cx="22" cy="42" r="4" />
  <circle cx="42" cy="42" r="4" />
  <path d="M4 36 L12 36" />
  <polygon points="4,36 8,33 8,39" fill="currentColor" stroke="none" />
  <path d="M52 36 L60 36" />
  <polygon points="60,36 56,33 56,39" fill="currentColor" stroke="none" />
</svg>`;

/** Direct Connect — dedicated line (cable with plugs). */
export const AWS_PRO_DIRECT_CONNECT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="4" y="22" width="16" height="20" rx="3" />
  <rect x="44" y="22" width="16" height="20" rx="3" />
  <line x1="20" y1="28" x2="44" y2="28" stroke-width="3" />
  <line x1="20" y1="36" x2="44" y2="36" stroke-width="3" />
  <circle cx="12" cy="32" r="3" fill="currentColor" />
  <circle cx="52" cy="32" r="3" fill="currentColor" />
  <line x1="12" y1="16" x2="12" y2="22" />
  <line x1="52" y1="16" x2="52" y2="22" />
  <line x1="12" y1="42" x2="12" y2="48" />
  <line x1="52" y1="42" x2="52" y2="48" />
</svg>`;

// ── Security ─────────────────────────────────────────────

/** IAM — key with user shield. */
export const AWS_PRO_IAM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M32 4 L48 12 V28 C48 40 32 52 32 52 C32 52 16 40 16 28 V12 Z" />
  <circle cx="32" cy="20" r="6" />
  <path d="M24 34 C24 28 28 26 32 26 C36 26 40 28 40 34" />
  <circle cx="50" cy="44" r="6" />
  <line x1="50" y1="50" x2="50" y2="60" />
  <line x1="50" y1="54" x2="56" y2="52" />
  <line x1="50" y1="58" x2="56" y2="56" />
</svg>`;

/** WAF — web application firewall (shield with web grid). */
export const AWS_PRO_WAF_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M32 4 L52 14 V32 C52 44 32 56 32 56 C32 56 12 44 12 32 V14 Z" />
  <line x1="20" y1="22" x2="44" y2="22" />
  <line x1="18" y1="32" x2="46" y2="32" />
  <line x1="20" y1="42" x2="44" y2="42" />
  <line x1="28" y1="14" x2="26" y2="48" />
  <line x1="36" y1="14" x2="38" y2="48" />
</svg>`;

/** Shield — protective shield with checkmark. */
export const AWS_PRO_SHIELD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M32 4 L54 14 V32 C54 46 32 58 32 58 C32 58 10 46 10 32 V14 Z" />
  <path d="M32 4 L54 14 V32 C54 46 32 58 32 58 C32 58 10 46 10 32 V14 Z" fill="currentColor" opacity="0.08" />
  <polyline points="22,30 30,40 44,22" stroke-width="3" />
</svg>`;

/** KMS — key management (key with gear). */
export const AWS_PRO_KMS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="22" cy="24" r="10" />
  <circle cx="22" cy="24" r="4" fill="currentColor" opacity="0.2" />
  <line x1="32" y1="24" x2="56" y2="24" />
  <line x1="56" y1="24" x2="56" y2="32" />
  <line x1="48" y1="24" x2="48" y2="30" />
  <circle cx="44" cy="48" r="8" />
  <circle cx="44" cy="48" r="4" />
  <line x1="44" y1="40" x2="44" y2="36" />
  <line x1="38" y1="42" x2="35" y2="39" />
  <line x1="50" y1="42" x2="53" y2="39" />
  <line x1="36" y1="48" x2="33" y2="48" />
  <line x1="52" y1="48" x2="55" y2="48" />
</svg>`;

/** Cognito — user pool (users with ID badge). */
export const AWS_PRO_COGNITO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="24" cy="18" r="8" />
  <path d="M12 38 C12 30 18 28 24 28 C30 28 36 30 36 38" />
  <circle cx="44" cy="22" r="6" />
  <path d="M34 40 C34 34 38 32 44 32 C50 32 54 34 54 40" />
  <rect x="18" y="42" width="28" height="16" rx="2" />
  <line x1="24" y1="48" x2="40" y2="48" />
  <line x1="24" y1="52" x2="34" y2="52" />
</svg>`;

// ── Management ───────────────────────────────────────────

/** CloudWatch — monitoring eye/gauge. */
export const AWS_PRO_CLOUDWATCH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="32" cy="32" r="22" />
  <circle cx="32" cy="32" r="16" />
  <line x1="32" y1="32" x2="42" y2="22" stroke-width="2.5" />
  <circle cx="32" cy="32" r="3" fill="currentColor" />
  <line x1="32" y1="10" x2="32" y2="14" />
  <line x1="32" y1="50" x2="32" y2="54" />
  <line x1="10" y1="32" x2="14" y2="32" />
  <line x1="50" y1="32" x2="54" y2="32" />
  <line x1="16" y1="16" x2="19" y2="19" />
  <line x1="45" y1="16" x2="48" y2="19" />
</svg>`;

/** CloudFormation — stack of layers (infrastructure as code). */
export const AWS_PRO_CLOUDFORMATION_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M8 40 L32 52 L56 40" />
  <path d="M8 32 L32 44 L56 32" />
  <path d="M8 24 L32 36 L56 24 L32 12 Z" fill="currentColor" opacity="0.1" />
  <path d="M8 24 L32 36 L56 24 L32 12 Z" />
  <path d="M32 36 V44" stroke-dasharray="2 2" />
  <path d="M32 44 V52" stroke-dasharray="2 2" />
  <path d="M8 24 V32" />
  <path d="M56 24 V32" />
  <path d="M8 32 V40" />
  <path d="M56 32 V40" />
</svg>`;

/** CloudTrail — trail/footprints with magnifying glass. */
export const AWS_PRO_CLOUDTRAIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M8 48 C16 44 20 36 28 32 C36 28 44 32 52 24" stroke-width="2.5" stroke-dasharray="4 3" />
  <circle cx="52" cy="24" r="3" fill="currentColor" />
  <circle cx="20" cy="20" r="10" />
  <line x1="27" y1="27" x2="34" y2="34" stroke-width="2.5" />
  <circle cx="20" cy="20" r="4" fill="currentColor" opacity="0.15" />
  <circle cx="12" cy="52" r="3" fill="currentColor" opacity="0.4" />
  <circle cx="24" cy="48" r="2" fill="currentColor" opacity="0.3" />
  <circle cx="36" cy="44" r="2" fill="currentColor" opacity="0.2" />
</svg>`;

// ── Messaging ────────────────────────────────────────────

/** SQS — queue (messages through a pipeline). */
export const AWS_PRO_SQS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="14" y="18" width="36" height="28" rx="3" />
  <rect x="20" y="24" width="8" height="6" rx="1" fill="currentColor" opacity="0.15" />
  <rect x="32" y="24" width="8" height="6" rx="1" fill="currentColor" opacity="0.15" />
  <rect x="20" y="34" width="8" height="6" rx="1" fill="currentColor" opacity="0.15" />
  <rect x="32" y="34" width="8" height="6" rx="1" fill="currentColor" opacity="0.15" />
  <line x1="4" y1="32" x2="14" y2="32" />
  <polygon points="4,32 8,29 8,35" fill="currentColor" stroke="none" />
  <line x1="50" y1="32" x2="60" y2="32" />
  <polygon points="60,32 56,29 56,35" fill="currentColor" stroke="none" />
</svg>`;

/** SNS — notification bell with fan-out. */
export const AWS_PRO_SNS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M24 28 C24 16 40 16 40 28 V36 H24 V28 Z" />
  <path d="M20 36 H44 C44 36 44 42 32 42 C20 42 20 36 20 36 Z" />
  <line x1="32" y1="42" x2="32" y2="46" />
  <circle cx="32" cy="48" r="2" fill="currentColor" />
  <line x1="44" y1="30" x2="56" y2="22" />
  <circle cx="58" cy="20" r="3" />
  <line x1="44" y1="36" x2="56" y2="36" />
  <circle cx="58" cy="36" r="3" />
  <line x1="44" y1="42" x2="56" y2="50" />
  <circle cx="58" cy="52" r="3" />
</svg>`;

/** EventBridge — event bus (hub with radiating connections). */
export const AWS_PRO_EVENTBRIDGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="20" y="20" width="24" height="24" rx="4" fill="currentColor" opacity="0.08" />
  <rect x="20" y="20" width="24" height="24" rx="4" />
  <line x1="32" y1="26" x2="32" y2="38" />
  <line x1="26" y1="32" x2="38" y2="32" />
  <line x1="20" y1="26" x2="10" y2="14" />
  <circle cx="8" cy="12" r="4" />
  <line x1="44" y1="26" x2="54" y2="14" />
  <circle cx="56" cy="12" r="4" />
  <line x1="20" y1="38" x2="10" y2="50" />
  <circle cx="8" cy="52" r="4" />
  <line x1="44" y1="38" x2="54" y2="50" />
  <circle cx="56" cy="52" r="4" />
</svg>`;
