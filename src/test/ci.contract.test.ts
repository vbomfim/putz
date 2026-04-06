/**
 * Contract tests for CI/CD workflow configuration.
 *
 * Validates that the GitHub Actions workflow is correctly configured
 * to meet AC4 (CI pipeline passes) and AC5 (cross-platform build).
 * These tests read the YAML file as text and validate its structure.
 *
 * Tags: [CONTRACT], [AC-4], [AC-5]
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ESM-compatible __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = resolve(__dirname, "../..");
const ciPath = resolve(projectRoot, ".github/workflows/ci.yml");

describe("CI Workflow Contract", () => {
  /**
   * [CONTRACT] [AC-4] CI workflow file must exist.
   */
  it("CI workflow file exists", () => {
    expect(existsSync(ciPath)).toBe(true);
  });

  const ciContent = existsSync(ciPath) ? readFileSync(ciPath, "utf-8") : "";

  /**
   * [CONTRACT] [AC-4] CI must trigger on push to main and pull requests.
   */
  it("triggers on push to main and pull requests", () => {
    expect(ciContent).toContain("push:");
    expect(ciContent).toContain("pull_request:");
    expect(ciContent).toContain("branches: [main]");
  });

  /**
   * [CONTRACT] [AC-4] CI must have frontend lint job.
   */
  it("has frontend lint job", () => {
    expect(ciContent).toContain("lint-frontend:");
    expect(ciContent).toContain("eslint");
  });

  /**
   * [CONTRACT] [AC-4] CI must have backend lint job with rustfmt and clippy.
   */
  it("has backend lint job with rustfmt and clippy", () => {
    expect(ciContent).toContain("lint-backend:");
    expect(ciContent).toContain("cargo fmt --check");
    expect(ciContent).toContain("cargo clippy");
  });

  /**
   * [CONTRACT] [AC-4] CI must have frontend test job.
   */
  it("has frontend test job", () => {
    expect(ciContent).toContain("test-frontend:");
    expect(ciContent).toContain("vitest run");
  });

  /**
   * [CONTRACT] [AC-4] CI must have backend test job.
   */
  it("has backend test job", () => {
    expect(ciContent).toContain("test-backend:");
    expect(ciContent).toContain("cargo test");
  });

  /**
   * [CONTRACT] [AC-5] CI must have a build job that runs on all 3 platforms.
   */
  it("has cross-platform build matrix", () => {
    expect(ciContent).toContain("ubuntu-latest");
    expect(ciContent).toContain("macos-latest");
    expect(ciContent).toContain("windows-latest");
  });

  /**
   * [CONTRACT] [AC-5] Build job must use tauri build command.
   */
  it("build job uses tauri build", () => {
    expect(ciContent).toContain("tauri build");
  });

  /**
   * [CONTRACT] [AC-4] CI must install Linux system dependencies
   * (webkit2gtk is required for Tauri on Linux).
   */
  it("installs Linux system dependencies for Tauri", () => {
    expect(ciContent).toContain("libwebkit2gtk");
  });

  /**
   * [CONTRACT] CI must set least-privilege permissions.
   */
  it("sets permissions to contents read", () => {
    expect(ciContent).toContain("permissions:");
    expect(ciContent).toContain("contents: read");
  });

  /**
   * [CONTRACT] Build job depends on tests passing first.
   */
  it("build job depends on test jobs", () => {
    expect(ciContent).toContain("needs: [test-frontend, test-backend]");
  });

  /**
   * [CONTRACT] CI uses proper caching for Cargo registry.
   */
  it("uses Cargo caching for faster builds", () => {
    expect(ciContent).toContain("actions/cache@v4");
    expect(ciContent).toContain("~/.cargo/registry");
  });
});
