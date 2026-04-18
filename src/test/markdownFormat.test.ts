import { describe, it, expect } from "vitest";
import { formatMarkdownTables } from "../components/Scripting/markdownFormat";

describe("formatMarkdownTables", () => {
  it("aligns columns to the widest cell", () => {
    const input = [
      "| a | bbb |",
      "| --- | --- |",
      "| 1 | 2 |",
      "| longer | x |",
    ].join("\n");
    const out = formatMarkdownTables(input);
    expect(out.split("\n")).toEqual([
      "| a      | bbb |",
      "| ------ | --- |",
      "| 1      | 2   |",
      "| longer | x   |",
    ]);
  });

  it("respects alignment markers in the separator row", () => {
    const input = [
      "| L | C | R |",
      "| :--- | :---: | ---: |",
      "| a | b | c |",
    ].join("\n");
    const out = formatMarkdownTables(input);
    expect(out.split("\n")).toEqual([
      "| L   |  C  |   R |",
      "| :-- | :-: | --: |",
      "| a   |  b  |   c |",
    ]);
  });

  it("leaves non-table content untouched", () => {
    const input = "# Heading\n\nsome prose | with pipes\nmore prose\n";
    expect(formatMarkdownTables(input)).toBe(input);
  });

  it("formats multiple tables in the same document", () => {
    const input = [
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "between",
      "",
      "| x | yy |",
      "| --- | --- |",
      "| zz | w |",
    ].join("\n");
    const out = formatMarkdownTables(input);
    expect(out).toContain("| a   | b   |");
    expect(out).toContain("| 1   | 2   |");
    expect(out).toContain("| x   | yy  |");
    expect(out).toContain("| zz  | w   |");
    expect(out).toContain("between");
  });

  it("ignores rows whose column count differs from the header", () => {
    const input = [
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "| only-one |",
    ].join("\n");
    const out = formatMarkdownTables(input);
    // The 4th line breaks the table block — it should remain untouched.
    expect(out.split("\n")[3]).toBe("| only-one |");
  });
});
