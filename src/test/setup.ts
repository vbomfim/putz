import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";

/**
 * Stub HTMLCanvasElement.getContext for jsdom — xterm.js probes canvas for its
 * DomRenderer and emits noisy "Not implemented" warnings to stderr otherwise.
 */
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
});

/**
 * Polyfill document.queryCommandSupported for jsdom — required by
 * monaco-editor's clipboard module which calls this at import time.
 * Without this, any test that transitively imports monaco will crash.
 */
if (
  typeof document !== "undefined" &&
  typeof document.queryCommandSupported !== "function"
) {
  document.queryCommandSupported = () => false;
}

/**
 * Polyfill PointerEvent for jsdom — required by components using
 * pointer-based drag and drop (BookmarksBar, RegionTabBar).
 * jsdom does not implement PointerEvent natively.
 */
if (typeof globalThis.PointerEvent === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).PointerEvent = class PointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? "";
    }
  };
}

/**
 * Polyfill ResizeObserver for jsdom — required by useTerminal.ts
 * which uses ResizeObserver to re-fit terminals on container resize.
 */
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

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
    private _onBellHandlers: Array<() => void> = [];
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
    registerLinkProvider = vi.fn().mockReturnValue(createDisposable());
    getSelection = vi.fn().mockReturnValue("");
    paste = vi.fn();

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
    onBell(handler: () => void) {
      this._onBellHandlers.push(handler);
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

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn().mockImplementation(() => ({
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
