# VT Correctness Test Corpus

Battle-tested VT/ANSI escape sequence test fixtures ported from mature terminal
emulators. These tests verify that Putz's xterm.js-based terminal correctly
handles the full spectrum of terminal control sequences.

## Sources

| Source | License | What was ported |
|--------|---------|-----------------|
| [Microsoft Windows Terminal](https://github.com/microsoft/terminal) | MIT | OSC, CSI, SGR, DCS parser inputs + CJK width data |
| [xterm.js](https://github.com/xtermjs/xterm.js) | MIT | Parser state transitions, OSC handling, edge cases |

## Test Files

| File | Category | Count | What it tests |
|------|----------|-------|---------------|
| `osc.test.ts` | OSC sequences | 30+ | OSC 0/7/133/1337, terminators, payload limits, malformed |
| `csi.test.ts` | CSI/SGR sequences | 50+ | Cursor movement, colors, attributes, scroll, modes |
| `edge-cases.test.ts` | Edge cases | 20+ | Malformed sequences, oversized payloads, C1 controls |
| `width.test.ts` | Unicode/width | 20+ | CJK, combining chars, emoji, surrogate pairs, BiDi |

## Fixture Provenance

Each test includes a comment identifying the source:
- `// Source: microsoft/terminal OutputEngineTest.cpp (MIT)`
- `// Source: xtermjs/xterm.js EscapeSequenceParser.test.ts (MIT)`
- `// Source: putz-custom` — test cases authored by the Putz team

## Running

```bash
# Run just the VT corpus
npx vitest run src/test/vt-corpus/

# Run with verbose output
npx vitest run src/test/vt-corpus/ --reporter=verbose
```

## Design

Tests use `createTerminalFromBytes()` from the shell compatibility harness
(S7) to feed raw byte sequences into a headless xterm.js Terminal instance.
Assertions check buffer content, cursor position, cell attributes, and
parser behavior.

For OSC-specific tests, the `createOscParser()` factory from S2 is used
to verify event emission.

## License

See `LICENSE-3RD-PARTY/MICROSOFT_TERMINAL_LICENSE` and
`LICENSE-3RD-PARTY/XTERMJS_LICENSE` for full license texts.
