#!/usr/bin/env node

/**
 * Version bump script — keeps version consistent across:
 *   - package.json
 *   - src-tauri/Cargo.toml
 *   - src-tauri/tauri.conf.json
 *
 * Usage:
 *   npm run version:bump 0.2.0
 *   npm run version:bump -- --patch   (auto-increment patch)
 *   npm run version:bump -- --minor   (auto-increment minor)
 *   npm run version:bump -- --major   (auto-increment major)
 *
 * @module version-bump
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

/** Paths to files containing version strings. */
const FILES = {
  packageJson: resolve(ROOT, "package.json"),
  cargoToml: resolve(ROOT, "src-tauri", "Cargo.toml"),
  tauriConf: resolve(ROOT, "src-tauri", "tauri.conf.json"),
};

/** Semver regex for validation. */
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

/**
 * Parse a semver string into [major, minor, patch].
 */
function parseSemver(version) {
  const parts = version.split(".").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid semver: ${version}`);
  }
  return parts;
}

/**
 * Read current version from package.json.
 */
function getCurrentVersion() {
  const pkg = JSON.parse(readFileSync(FILES.packageJson, "utf-8"));
  return pkg.version;
}

/**
 * Compute the next version based on the bump type or explicit version.
 */
function resolveVersion(arg) {
  const current = getCurrentVersion();

  if (SEMVER_RE.test(arg)) {
    return arg;
  }

  const [major, minor, patch] = parseSemver(current);

  switch (arg) {
    case "--patch":
      return `${major}.${minor}.${patch + 1}`;
    case "--minor":
      return `${major}.${minor + 1}.0`;
    case "--major":
      return `${major + 1}.0.0`;
    default:
      throw new Error(
        `Invalid argument: "${arg}". Use a semver (e.g. 1.2.3) or --patch/--minor/--major.`
      );
  }
}

/**
 * Update version in package.json.
 */
function updatePackageJson(version) {
  const content = readFileSync(FILES.packageJson, "utf-8");
  const pkg = JSON.parse(content);
  pkg.version = version;
  writeFileSync(FILES.packageJson, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
  console.log(`  ✓ package.json → ${version}`);
}

/**
 * Update version in Cargo.toml (first occurrence of version = "x.y.z" under [package]).
 */
function updateCargoToml(version) {
  let content = readFileSync(FILES.cargoToml, "utf-8");
  const replaced = content.replace(
    /^(version\s*=\s*")[^"]+(")/m,
    `$1${version}$2`
  );
  if (replaced === content) {
    throw new Error("Could not find version field in Cargo.toml");
  }
  writeFileSync(FILES.cargoToml, replaced, "utf-8");
  console.log(`  ✓ src-tauri/Cargo.toml → ${version}`);
}

/**
 * Update version in tauri.conf.json.
 */
function updateTauriConf(version) {
  const content = readFileSync(FILES.tauriConf, "utf-8");
  const conf = JSON.parse(content);
  conf.version = version;
  writeFileSync(FILES.tauriConf, JSON.stringify(conf, null, 2) + "\n", "utf-8");
  console.log(`  ✓ src-tauri/tauri.conf.json → ${version}`);
}

// --- Main ---

const arg = process.argv[2];

if (!arg) {
  console.error(
    "Usage: node scripts/version-bump.mjs <version|--patch|--minor|--major>"
  );
  console.error("  Examples:");
  console.error("    npm run version:bump 0.2.0");
  console.error("    npm run version:bump -- --patch");
  process.exit(1);
}

try {
  const currentVersion = getCurrentVersion();
  const newVersion = resolveVersion(arg);

  console.log(`\nBumping version: ${currentVersion} → ${newVersion}\n`);

  updatePackageJson(newVersion);
  updateCargoToml(newVersion);
  updateTauriConf(newVersion);

  console.log(`\n✅ Version bumped to ${newVersion}\n`);
  console.log("Next steps:");
  console.log(`  git add -A && git commit -m "chore: bump version to ${newVersion}"`);
  console.log(`  git tag v${newVersion}`);
  console.log(`  git push origin main --tags`);
} catch (err) {
  console.error(`\n❌ ${err.message}\n`);
  process.exit(1);
}
