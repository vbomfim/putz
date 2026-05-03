#!/usr/bin/env node
/**
 * PTY spawn-time measurement script.
 *
 * Wrapper around the Rust `measure_spawn` binary that:
 * 1. Builds the binary (if needed)
 * 2. Runs it with the specified number of samples
 * 3. Saves output to docs/perf/baseline-{platform}-{arch}.json
 *
 * Usage:
 *   node scripts/measure-spawn.mjs [--samples N] [--shell /path/to/shell] [--save]
 *
 * Options:
 *   --samples, -n   Number of spawn cycles (default: 20)
 *   --shell, -s     Shell to measure (default: $SHELL)
 *   --save          Save output to docs/perf/ directory
 */

import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

// Parse args
const args = process.argv.slice(2);
let samples = "20";
let shell = "";
let save = false;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--samples":
    case "-n":
      samples = args[++i];
      break;
    case "--shell":
    case "-s":
      shell = args[++i];
      break;
    case "--save":
      save = true;
      break;
    case "--help":
    case "-h":
      console.log(
        "Usage: node scripts/measure-spawn.mjs [--samples N] [--shell /path] [--save]",
      );
      process.exit(0);
  }
}

// Build the measurement binary
console.error("Building measure_spawn binary...");
try {
  execSync("cargo build --bin measure_spawn --release", {
    cwd: join(projectRoot, "src-tauri"),
    stdio: "inherit",
  });
} catch {
  console.error("Failed to build measure_spawn. Ensure Rust toolchain is installed.");
  process.exit(1);
}

// Run the measurement
const binaryPath = join(
  projectRoot,
  "src-tauri",
  "target",
  "release",
  "measure_spawn",
);

const runArgs = ["--samples", samples];
if (shell) {
  runArgs.push("--shell", shell);
}

console.error(`\nRunning: ${binaryPath} ${runArgs.join(" ")}\n`);

const result = spawnSync(binaryPath, runArgs, {
  stdio: ["inherit", "pipe", "inherit"],
  encoding: "utf-8",
});

if (result.status !== 0) {
  console.error("Measurement failed!");
  process.exit(result.status || 1);
}

const jsonOutput = result.stdout;

// Print JSON to stdout
process.stdout.write(jsonOutput);

// Save if requested
if (save) {
  try {
    const data = JSON.parse(jsonOutput);
    const platform = data.platform || "unknown";
    const arch = data.arch || "unknown";
    const filename = `baseline-${platform}-${arch}.json`;
    const outDir = join(projectRoot, "docs", "perf");
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, filename);
    writeFileSync(outPath, JSON.stringify(data, null, 2) + "\n");
    console.error(`\nSaved to ${outPath}`);
  } catch (err) {
    console.error(`Failed to save: ${err.message}`);
  }
}
