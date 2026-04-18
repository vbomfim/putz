import { describe, it, expect } from "vitest";
import { parseCwdFromTitle } from "../components/Terminal/cwdRegistry";

describe("parseCwdFromTitle", () => {
  it("parses PowerShell title with 'PS C:\\path' prefix", () => {
    expect(parseCwdFromTitle("PS C:\\Users\\john\\dev\\proj")).toBe(
      "C:\\Users\\john\\dev\\proj",
    );
  });

  it("parses CMD title 'C:\\path>'", () => {
    expect(parseCwdFromTitle("C:\\Users\\john>")).toBe("C:\\Users\\john");
  });

  it("parses 'Administrator: C:\\path'", () => {
    expect(parseCwdFromTitle("Administrator: C:\\Users\\john\\dev")).toBe(
      "C:\\Users\\john\\dev",
    );
  });

  it("parses bash 'user@host:/path' format", () => {
    expect(parseCwdFromTitle("john@laptop:/home/john/dev")).toBe(
      "/home/john/dev",
    );
  });

  it("parses bash 'user@host: ~/path' with tilde", () => {
    expect(parseCwdFromTitle("john@laptop: ~/dev/proj")).toBe("~/dev/proj");
  });

  it("parses zsh suffix '/path — zsh'", () => {
    expect(parseCwdFromTitle("/Users/john/dev/proj — zsh")).toBe(
      "/Users/john/dev/proj",
    );
  });

  it("parses Windows path with forward slashes", () => {
    expect(parseCwdFromTitle("C:/Users/john")).toBe("C:/Users/john");
  });

  it("returns null for empty title", () => {
    expect(parseCwdFromTitle("")).toBe(null);
  });

  it("returns null for plain titles without paths", () => {
    expect(parseCwdFromTitle("Terminal")).toBe(null);
    expect(parseCwdFromTitle("My Window")).toBe(null);
  });

  it("strips trailing slashes from Windows paths", () => {
    expect(parseCwdFromTitle("PS C:\\Users\\john\\")).toBe(
      "C:\\Users\\john",
    );
  });
});

import {
  recordSessionCwd,
  getSessionCwd,
  getSessionCwdAtLine,
  clearSessionCwd,
} from "../components/Terminal/cwdRegistry";

describe("session cwd history", () => {
  it("returns latest cwd via getSessionCwd", () => {
    const sid = "test-sid-1";
    clearSessionCwd(sid);
    recordSessionCwd(sid, "/home/foo", null, 10);
    recordSessionCwd(sid, "/home/foo/projects", null, 25);
    expect(getSessionCwd(sid)).toBe("/home/foo/projects");
    clearSessionCwd(sid);
  });

  it("resolves to the cwd active at the clicked buffer line", () => {
    const sid = "test-sid-2";
    clearSessionCwd(sid);
    recordSessionCwd(sid, "/home/foo", null, 10);
    recordSessionCwd(sid, "/home/foo/projects", null, 50);
    recordSessionCwd(sid, "/tmp", null, 100);

    // Click on line 30 → should use /home/foo (active at lines 10-49)
    expect(getSessionCwdAtLine(sid, 30)).toBe("/home/foo");
    // Click on line 75 → should use /home/foo/projects (active 50-99)
    expect(getSessionCwdAtLine(sid, 75)).toBe("/home/foo/projects");
    // Click on line 150 → should use /tmp (latest)
    expect(getSessionCwdAtLine(sid, 150)).toBe("/tmp");
    // Click on line 5 (before any cd) → falls back to oldest known
    expect(getSessionCwdAtLine(sid, 5)).toBe("/home/foo");
    clearSessionCwd(sid);
  });

  it("coalesces consecutive identical cwd entries", () => {
    const sid = "test-sid-3";
    clearSessionCwd(sid);
    recordSessionCwd(sid, "/a", null, 1);
    recordSessionCwd(sid, "/a", null, 2);
    recordSessionCwd(sid, "/a", null, 3);
    recordSessionCwd(sid, "/b", null, 4);
    expect(getSessionCwdAtLine(sid, 3)).toBe("/a");
    expect(getSessionCwdAtLine(sid, 4)).toBe("/b");
    clearSessionCwd(sid);
  });

  it("returns undefined for unknown session", () => {
    expect(getSessionCwd("nonexistent")).toBeUndefined();
    expect(getSessionCwdAtLine("nonexistent", 0)).toBeUndefined();
  });
});
