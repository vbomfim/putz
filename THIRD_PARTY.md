# Third-Party Notices

This project includes test fixtures adapted from the following open-source projects.
Only **test inputs and expected outcomes** were ported — no implementation code was copied.

---

## Microsoft Windows Terminal

- **Repository:** https://github.com/microsoft/terminal
- **License:** MIT (see `LICENSE-3RD-PARTY/MICROSOFT_TERMINAL_LICENSE`)
- **Commit:** `059986e` (shallow clone, 2025)
- **Files used:**
  - `src/terminal/parser/ut_parser/OutputEngineTest.cpp` — OSC, CSI, SGR, DCS parser test data
  - `src/terminal/parser/ut_parser/StateMachineTest.cpp` — state machine edge cases
  - `src/types/ut_types/CodepointWidthDetectorTests.cpp` — CJK/Unicode width test data
- **What was ported:** Input byte sequences and expected parse outcomes for VT100/ANSI
  escape sequence handling.

---

## xterm.js

- **Repository:** https://github.com/xtermjs/xterm.js
- **License:** MIT (see `LICENSE-3RD-PARTY/XTERMJS_LICENSE`)
- **Commit:** `6ba731d` (shallow clone, 2025)
- **Files used:**
  - `src/common/parser/EscapeSequenceParser.test.ts` — CSI, ESC, DCS, OSC state transitions
  - `src/common/parser/OscParser.test.ts` — OSC identifier parsing, payload limits
  - `src/common/parser/DcsParser.test.ts` — DCS handler lifecycle
  - `src/common/parser/Params.test.ts` — CSI parameter parsing edge cases
- **What was ported:** Input sequences and expected parser behavior, adapted from
  Mocha/Chai to Vitest assertions. Putz uses xterm.js v6 as its terminal renderer,
  so these tests verify correctness of our integrated dependency.

---

All source repositories are licensed under the MIT license, which is compatible
with this project's license.
