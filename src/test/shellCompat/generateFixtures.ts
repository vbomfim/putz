/**
 * Shell Compatibility Fixture Generator
 *
 * Generates synthetic PTY byte streams that match the escape sequences
 * produced by each tier-1 shell. These are checked into the repo as
 * binary .bytes files for deterministic, CI-friendly testing.
 *
 * Run: npx tsx src/test/shellCompat/generateFixtures.ts
 *
 * Each fixture is a short sequence (< 5 KB) representing a single
 * shell interaction scenario. The sequences are hand-crafted from
 * documented shell behavior, not recorded from live sessions.
 *
 * See docs/shell-compat-fixtures.md for the full fixture inventory
 * and instructions on capturing real fixtures to replace these.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");
mkdirSync(FIXTURES_DIR, { recursive: true });

/** Encode a string (with escape sequences) to a Uint8Array */
function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function writeFixture(name: string, data: Uint8Array): void {
  const path = join(FIXTURES_DIR, name);
  writeFileSync(path, data);
  console.log(`  ✓ ${name} (${data.length} bytes)`);
}

// ─── Escape sequence building blocks ───────────────────────────────

const ESC = "\x1b";
const CSI = `${ESC}[`;
const OSC = `${ESC}]`;
// ST (String Terminator) = `${ESC}\\` — reserved for future OSC fixtures
const BEL = "\x07";
const CR = "\r";
const LF = "\n";
const CRLF = `${CR}${LF}`;

/** Set Graphics Rendition */
const sgr = (code: string) => `${CSI}${code}m`;

/** Erase in Line — 0: to end, 1: to start, 2: whole line */
const eraseInLine = (mode = 0) => `${CSI}${mode}K`;

/** Cursor position (1-indexed) */
const cursorTo = (row: number, col: number) => `${CSI}${row};${col}H`;

/** Cursor backward */
const cursorBackward = (n: number) => `${CSI}${n}D`;

/** Save / restore cursor */
const saveCursor = `${ESC}7`;
const restoreCursor = `${ESC}8`;

/** 256-color foreground */
const fg256 = (n: number) => sgr(`38;5;${n}`);

/** Reset all attributes */
const reset = sgr("0");

/** Dim/faint text (used for autosuggestions) */
const dim = sgr("2");

/** SGR 90 = bright black (dark grey — used by PSReadLine for predictions) */
const grey = sgr("90");

/** Bracketed paste mode enable/disable */
const bracketedPasteEnable = `${CSI}?2004h`;
const bracketedPasteStart = `${CSI}200~`;
const bracketedPasteEnd = `${CSI}201~`;

/** OSC 7 — report CWD */
const osc7 = (cwd: string) => `${OSC}7;file://localhost${cwd}${BEL}`;

// ─── zsh fixtures ──────────────────────────────────────────────────

console.log("Generating zsh fixtures...");

// zsh-cold-prompt: A typical oh-my-zsh style colored prompt
writeFixture(
  "zsh-cold-prompt.bytes",
  encode(
    // Prompt: colored user@host + path + arrow
    `${sgr("1;32")}user@host${reset}:${sgr("1;34")}~/projects${reset}$ ${eraseInLine()}`,
  ),
);

// zsh-autosuggest: User types "git" and zsh-autosuggestions shows dim completion
writeFixture(
  "zsh-autosuggest.bytes",
  encode(
    // Prompt
    `${sgr("1;32")}❯${reset} ` +
      // User typed "git"
      `git` +
      // zsh-autosuggestions appends dim ghost text
      `${saveCursor}${dim} status --short${reset}${restoreCursor}` +
      // Cursor stays after "git"
      "",
  ),
);

// zsh-multiline-redraw: Prompt redrawn with \e[K erase sequences
writeFixture(
  "zsh-multiline-redraw.bytes",
  encode(
    // First draw: full prompt
    `${sgr("1;32")}❯${reset} echo hello${CRLF}` +
      `hello${CRLF}` +
      // Redraw: cursor returns to prompt line, erases, redraws
      `${CR}${eraseInLine()}${sgr("1;32")}❯${reset} echo hello world${eraseInLine()}`,
  ),
);

// zsh-256color: printf producing 256-color output
writeFixture(
  "zsh-256color.bytes",
  encode(
    `${sgr("1;32")}❯${reset} printf '\\e[38;5;82m hello\\e[0m\\n'${CRLF}` +
      `${fg256(82)} hello${reset}${CRLF}` +
      `${sgr("1;32")}❯${reset} `,
  ),
);

// zsh-cursor-movement: Typing, then arrow keys to move within the line
writeFixture(
  "zsh-cursor-movement.bytes",
  encode(
    `${sgr("1;32")}❯${reset} echo test` +
      // Move cursor 4 left (back to start of "test")
      `${cursorBackward(4)}` +
      // Cursor is now at 't' in 'test', position after "echo "
      "",
  ),
);

// zsh-cjk: Chinese characters taking 2 cells each
writeFixture(
  "zsh-cjk.bytes",
  encode(
    `${sgr("1;32")}❯${reset} echo 你好世界${CRLF}` +
      `你好世界${CRLF}` +
      `${sgr("1;32")}❯${reset} `,
  ),
);

// zsh-osc7: Prompt with OSC 7 CWD reporting
writeFixture(
  "zsh-osc7.bytes",
  encode(
    `${osc7("/Users/dev/projects")}` +
      `${sgr("1;32")}❯${reset} cd /tmp${CRLF}` +
      `${osc7("/tmp")}` +
      `${sgr("1;32")}❯${reset} `,
  ),
);

// ─── bash fixtures ─────────────────────────────────────────────────

console.log("Generating bash fixtures...");

// bash-cold-prompt: Standard PS1 colored prompt
writeFixture(
  "bash-cold-prompt.bytes",
  encode(
    `${sgr("1;32")}user@host${reset}:${sgr("1;34")}~/projects${reset}$ ${eraseInLine()}`,
  ),
);

// bash-history-search: Ctrl+R reverse-i-search rendering
writeFixture(
  "bash-history-search.bytes",
  encode(
    `${sgr("1;32")}user@host${reset}:${sgr("1;34")}~${reset}$ ` +
      // User presses Ctrl+R — bash shows reverse-i-search prompt
      `${CR}${eraseInLine()}(reverse-i-search)\`git': git commit -m "initial"${eraseInLine()}`,
  ),
);

// bash-multiline-redraw: Readline redraws with \e[K
writeFixture(
  "bash-multiline-redraw.bytes",
  encode(
    `${sgr("1;32")}user@host${reset}:${sgr("1;34")}~${reset}$ ls -la${CRLF}` +
      `total 42${CRLF}` +
      `drwxr-xr-x  5 user user 160 Jan  1 12:00 .${CRLF}` +
      // Next prompt
      `${CR}${eraseInLine()}${sgr("1;32")}user@host${reset}:${sgr("1;34")}~${reset}$ ${eraseInLine()}`,
  ),
);

// bash-256color: 256-color output
writeFixture(
  "bash-256color.bytes",
  encode(
    `${sgr("1;32")}user@host${reset}:${sgr("1;34")}~${reset}$ ` +
      `printf '\\e[38;5;196mred\\e[0m \\e[38;5;82mgreen\\e[0m\\n'${CRLF}` +
      `${fg256(196)}red${reset} ${fg256(82)}green${reset}${CRLF}` +
      `${sgr("1;32")}user@host${reset}:${sgr("1;34")}~${reset}$ `,
  ),
);

// bash-bracketed-paste: Bracketed paste mode interaction
writeFixture(
  "bash-bracketed-paste.bytes",
  encode(
    // Enable bracketed paste mode
    `${bracketedPasteEnable}` +
      `${sgr("1;32")}user@host${reset}:${sgr("1;34")}~${reset}$ ` +
      // Simulated paste event (the markers are consumed by the terminal, not displayed)
      `${bracketedPasteStart}echo "pasted line 1"\necho "pasted line 2"${bracketedPasteEnd}` +
      "",
  ),
);

// ─── fish fixtures ─────────────────────────────────────────────────

console.log("Generating fish fixtures...");

// fish-cold-prompt: Fish default prompt with colored path
writeFixture(
  "fish-cold-prompt.bytes",
  encode(
    `${sgr("1;32")}user${reset}@${sgr("1;36")}host ${sgr("1;34")}~/projects${reset}> ${eraseInLine()}`,
  ),
);

// fish-suggestions: Fish autosuggestion — grey ghost text
writeFixture(
  "fish-suggestions.bytes",
  encode(
    // Prompt
    `${sgr("1;32")}user${reset}@${sgr("1;36")}host ${sgr("1;34")}~${reset}> ` +
      // User typed "git"
      `${sgr("1")}git${reset}` +
      // Fish shows grey autosuggestion
      `${saveCursor}${grey} status${reset}${restoreCursor}`,
  ),
);

// fish-syntax-highlight: Fish syntax highlighting — valid commands green, invalid red
writeFixture(
  "fish-syntax-highlight.bytes",
  encode(
    // Prompt
    `${sgr("1;32")}user${reset}@${sgr("1;36")}host ${sgr("1;34")}~${reset}> ` +
      // Valid command "ls" highlighted green
      `${sgr("1;32")}ls${reset}` +
      // Redraw with invalid command
      `${CR}${eraseInLine()}` +
      `${sgr("1;32")}user${reset}@${sgr("1;36")}host ${sgr("1;34")}~${reset}> ` +
      `${sgr("1;31")}nocommand${reset}${eraseInLine()}`,
  ),
);

// fish-256color: Fish with 256-color output
writeFixture(
  "fish-256color.bytes",
  encode(
    `${sgr("1;32")}user${reset}@${sgr("1;36")}host ${sgr("1;34")}~${reset}> ` +
      `printf '\\e[38;5;208morange\\e[0m\\n'${CRLF}` +
      `${fg256(208)}orange${reset}${CRLF}` +
      `${sgr("1;32")}user${reset}@${sgr("1;36")}host ${sgr("1;34")}~${reset}> `,
  ),
);

// fish-cjk: Fish with CJK characters
writeFixture(
  "fish-cjk.bytes",
  encode(
    `${sgr("1;32")}user${reset}@${sgr("1;36")}host ${sgr("1;34")}~${reset}> ` +
      `echo 日本語${CRLF}` +
      `日本語${CRLF}` +
      `${sgr("1;32")}user${reset}@${sgr("1;36")}host ${sgr("1;34")}~${reset}> `,
  ),
);

// ─── pwsh fixtures ─────────────────────────────────────────────────

console.log("Generating pwsh (PSReadLine) fixtures...");

// pwsh-cold-prompt: PowerShell default prompt
writeFixture(
  "pwsh-cold-prompt.bytes",
  encode(`PS ${sgr("33")}C:\\Users\\dev${reset}> ${eraseInLine()}`),
);

// pwsh-psreadline: PSReadLine inline prediction (SGR 90 = grey)
writeFixture(
  "pwsh-psreadline.bytes",
  encode(
    // Prompt
    `PS ${sgr("33")}C:\\Users\\dev${reset}> ` +
      // User typed "Get-"
      `Get-` +
      // PSReadLine inline prediction in grey
      `${saveCursor}${grey}ChildItem -Path .${reset}${restoreCursor}`,
  ),
);

// pwsh-history-search: PSReadLine Ctrl+R history search
writeFixture(
  "pwsh-history-search.bytes",
  encode(
    `PS ${sgr("33")}C:\\Users\\dev${reset}> ` +
      // Ctrl+R triggers PSReadLine reverse search
      `${CR}${eraseInLine()}` +
      `${sgr("7")}bck-i-search: ${reset}git` +
      `${cursorTo(2, 1)}` +
      `${sgr("90")}git push origin main${reset}${eraseInLine()}`,
  ),
);

// pwsh-256color: PowerShell with 256-color output
writeFixture(
  "pwsh-256color.bytes",
  encode(
    `PS ${sgr("33")}C:\\Users\\dev${reset}> ` +
      `Write-Host "colored" -ForegroundColor Green${CRLF}` +
      `${fg256(82)}colored${reset}${CRLF}` +
      `PS ${sgr("33")}C:\\Users\\dev${reset}> `,
  ),
);

// ─── cmd fixtures (Windows Command Prompt) ─────────────────────────

console.log("Generating cmd fixtures...");

// cmd-cold-prompt: Standard cmd.exe prompt
writeFixture(
  "cmd-cold-prompt.bytes",
  encode(`C:\\Users\\dev>${eraseInLine()}`),
);

// cmd-256color: cmd with ANSI color support (Windows 10+)
writeFixture(
  "cmd-256color.bytes",
  encode(
    `C:\\Users\\dev>echo ${fg256(82)}green text${reset}${CRLF}` +
      `${fg256(82)}green text${reset}${CRLF}` +
      `C:\\Users\\dev>`,
  ),
);

console.log("\nAll fixtures generated successfully.");
