/**
 * Unit tests for FontConfig component.
 *
 * Tags: [TDD], [AC-3]
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FontConfig } from "../components/Terminal/FontConfig";
import { DEFAULT_FONT_SETTINGS } from "../components/Terminal/themeTypes";

describe("FontConfig", () => {
  it("renders font config with title", () => {
    render(
      <FontConfig settings={{ ...DEFAULT_FONT_SETTINGS }} onChange={vi.fn()} />,
    );
    expect(screen.getByText("Font Settings")).toBeInTheDocument();
  });

  it("renders font family dropdown", () => {
    render(
      <FontConfig settings={{ ...DEFAULT_FONT_SETTINGS }} onChange={vi.fn()} />,
    );
    expect(screen.getByTestId("font-family-select")).toBeInTheDocument();
  });

  it("renders font size slider", () => {
    render(
      <FontConfig settings={{ ...DEFAULT_FONT_SETTINGS }} onChange={vi.fn()} />,
    );
    const slider = screen.getByTestId("font-size-slider") as HTMLInputElement;
    expect(slider).toBeInTheDocument();
    expect(slider.type).toBe("range");
    expect(Number(slider.min)).toBe(8);
    expect(Number(slider.max)).toBe(32);
  });

  it("renders ligature toggle", () => {
    render(
      <FontConfig settings={{ ...DEFAULT_FONT_SETTINGS }} onChange={vi.fn()} />,
    );
    const toggle = screen.getByTestId(
      "font-ligatures-toggle",
    ) as HTMLInputElement;
    expect(toggle).toBeInTheDocument();
    expect(toggle.type).toBe("checkbox");
  });

  it("renders line height slider", () => {
    render(
      <FontConfig settings={{ ...DEFAULT_FONT_SETTINGS }} onChange={vi.fn()} />,
    );
    const slider = screen.getByTestId("line-height-slider") as HTMLInputElement;
    expect(slider).toBeInTheDocument();
    expect(slider.type).toBe("range");
  });

  it("renders font preview", () => {
    render(
      <FontConfig settings={{ ...DEFAULT_FONT_SETTINGS }} onChange={vi.fn()} />,
    );
    expect(screen.getByTestId("font-preview")).toBeInTheDocument();
  });

  it("calls onChange with fontFamily when dropdown changes", () => {
    const onChange = vi.fn();
    render(
      <FontConfig
        settings={{ ...DEFAULT_FONT_SETTINGS }}
        onChange={onChange}
      />,
    );
    const select = screen.getByTestId("font-family-select");
    fireEvent.change(select, {
      target: { value: "Menlo, Monaco, monospace" },
    });
    expect(onChange).toHaveBeenCalledWith({
      fontFamily: "Menlo, Monaco, monospace",
    });
  });

  it("calls onChange with fontSize when slider changes", () => {
    const onChange = vi.fn();
    render(
      <FontConfig
        settings={{ ...DEFAULT_FONT_SETTINGS }}
        onChange={onChange}
      />,
    );
    const slider = screen.getByTestId("font-size-slider");
    fireEvent.change(slider, { target: { value: "18" } });
    expect(onChange).toHaveBeenCalledWith({ fontSize: 18 });
  });

  it("calls onChange with ligatures when checkbox toggles", () => {
    const onChange = vi.fn();
    render(
      <FontConfig
        settings={{ ...DEFAULT_FONT_SETTINGS, ligatures: false }}
        onChange={onChange}
      />,
    );
    const toggle = screen.getByTestId("font-ligatures-toggle");
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ ligatures: true });
  });

  it("calls onChange with lineHeight when slider changes", () => {
    const onChange = vi.fn();
    render(
      <FontConfig
        settings={{ ...DEFAULT_FONT_SETTINGS }}
        onChange={onChange}
      />,
    );
    const slider = screen.getByTestId("line-height-slider");
    fireEvent.change(slider, { target: { value: "1.5" } });
    expect(onChange).toHaveBeenCalledWith({ lineHeight: 1.5 });
  });

  it("displays current font size value", () => {
    render(
      <FontConfig
        settings={{ ...DEFAULT_FONT_SETTINGS, fontSize: 20 }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("20px")).toBeInTheDocument();
  });

  it("displays current line height value", () => {
    render(
      <FontConfig
        settings={{ ...DEFAULT_FONT_SETTINGS, lineHeight: 1.5 }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("1.5")).toBeInTheDocument();
  });

  it("applies font settings to preview", () => {
    render(
      <FontConfig
        settings={{
          fontFamily: "Menlo, Monaco, monospace",
          fontSize: 18,
          ligatures: true,
          lineHeight: 1.4,
        }}
        onChange={vi.fn()}
      />,
    );
    const preview = screen.getByTestId("font-preview");
    expect(preview.style.fontFamily).toContain("Menlo");
    expect(preview.style.fontSize).toBe("18px");
    expect(preview.style.lineHeight).toBe("1.4");
  });
});
