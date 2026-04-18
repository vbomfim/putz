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
