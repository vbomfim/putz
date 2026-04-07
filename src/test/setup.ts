import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

/**
 * Mock @xterm/xterm — provides a minimal Terminal class for tests.
 * jsdom does not support canvas, so xterm.js cannot render.
 */
function createDisposable() {
  return { dispose: vi.fn() };
}

vi.mock("@xterm/xterm", () => {
  class MockTerminal {
    options: Record<string, unknown>;
    cols = 80;
    rows = 24;
    unicode = { activeVersion: "11" };
    buffer = {
      active: {
        length: 0,
        viewportY: 0,
        baseY: 0,
        cursorY: 0,
        getLine: () => null,
      },
    };
    private _onDataHandlers: Array<(data: string) => void> = [];
    private _onBinaryHandlers: Array<(data: string) => void> = [];
    private _onResizeHandlers: Array<
      (size: { cols: number; rows: number }) => void
    > = [];
    private _onTitleChangeHandlers: Array<(title: string) => void> = [];
    private _onWriteParsedHandlers: Array<() => void> = [];

    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
    }
    open = vi.fn();
    write = vi.fn();
    dispose = vi.fn();
    loadAddon = vi.fn();
    focus = vi.fn();
    clear = vi.fn();
    reset = vi.fn();
    scrollToBottom = vi.fn();
    registerMarker = vi.fn().mockReturnValue({
      dispose: vi.fn(),
    });
    registerDecoration = vi.fn().mockReturnValue({
      dispose: vi.fn(),
      onRender: vi.fn(),
    });
    attachCustomKeyEventHandler = vi.fn().mockReturnValue(createDisposable());

    onData(handler: (data: string) => void) {
      this._onDataHandlers.push(handler);
      return createDisposable();
    }
    onBinary(handler: (data: string) => void) {
      this._onBinaryHandlers.push(handler);
      return createDisposable();
    }
    onResize(handler: (size: { cols: number; rows: number }) => void) {
      this._onResizeHandlers.push(handler);
      return createDisposable();
    }
    onTitleChange(handler: (title: string) => void) {
      this._onTitleChangeHandlers.push(handler);
      return createDisposable();
    }
    onWriteParsed(handler: () => void) {
      this._onWriteParsedHandlers.push(handler);
      return createDisposable();
    }
  }
  return { Terminal: MockTerminal };
});

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn().mockImplementation(() => ({
    onContextLoss: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock("@xterm/addon-unicode11", () => ({
  Unicode11Addon: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
  })),
}));

vi.mock("@xterm/addon-search", () => ({
  SearchAddon: vi.fn().mockImplementation(() => ({
    findNext: vi.fn().mockReturnValue(false),
    findPrevious: vi.fn().mockReturnValue(false),
    clearDecorations: vi.fn(),
    dispose: vi.fn(),
    onDidChangeResults: vi.fn().mockReturnValue(createDisposable()),
  })),
}));

// Mock xterm CSS import
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
