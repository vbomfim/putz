#!/usr/bin/env node
// setup.mjs — Symlink this in-repo extension into ~/.copilot/extensions/colleagues
// Usage:  node extensions/colleagues/setup.mjs
// Idempotent: safe to re-run.

import { existsSync, lstatSync, readlinkSync, mkdirSync, symlinkSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const SOURCE = __dirname; // repo's extensions/colleagues/
const EXTENSIONS_DIR = join(homedir(), ".copilot", "extensions");
const LINK_PATH = join(EXTENSIONS_DIR, "colleagues");

function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

// On Windows, junctions work without admin/dev-mode. On Unix, regular symlinks.
const linkType = platform() === "win32" ? "junction" : "dir";

// 1. Ensure parent directory exists
if (!existsSync(EXTENSIONS_DIR)) {
  mkdirSync(EXTENSIONS_DIR, { recursive: true });
  console.log(`Created ${EXTENSIONS_DIR}`);
}

// 2. Check existing link / directory
if (existsSync(LINK_PATH) || isSymlink(LINK_PATH)) {
  if (isSymlink(LINK_PATH)) {
    const target = resolve(readlinkSync(LINK_PATH));
    if (target === SOURCE) {
      console.log(`✔ Already linked: ${LINK_PATH} → ${SOURCE}`);
      process.exit(0);
    }
    // Points elsewhere — remove stale link
    console.log(`Removing stale link: ${LINK_PATH} → ${target}`);
    unlinkSync(LINK_PATH);
  } else {
    // It's a real directory — don't clobber
    console.error(
      `✘ ${LINK_PATH} exists and is not a symlink.\n` +
        `  Remove it manually if you want this script to manage it.`
    );
    process.exit(1);
  }
}

// 3. Create the symlink (or junction on Windows)
try {
  symlinkSync(SOURCE, LINK_PATH, linkType);
  console.log(`✔ Linked: ${LINK_PATH} → ${SOURCE}`);
} catch (err) {
  if (err.code === "EPERM" && platform() === "win32") {
    console.error(
      `✘ Permission denied creating junction.\n` +
        `  On Windows, try running from an elevated terminal, or enable\n` +
        `  Developer Mode (Settings → For developers → Developer Mode).\n` +
        `\n  Manual fallback (PowerShell as admin):\n` +
        `    New-Item -ItemType Junction -Path "${LINK_PATH}" -Target "${SOURCE}"`
    );
  } else {
    console.error(`✘ Failed to create link: ${err.message}`);
  }
  process.exit(1);
}
