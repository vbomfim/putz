# Content Security Policy (CSP) Notes

## Current Policy

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'
```

Configured in `tauri.conf.json` → `app.security.csp`.

## Why `'unsafe-inline'` in `style-src`?

**xterm.js requires `'unsafe-inline'` for style-src.** It injects inline styles at runtime for:

- Terminal cursor positioning and blinking
- Text selection highlighting
- Font metrics measurement
- Row and cell sizing
- WebGL canvas overlay positioning

There is no xterm.js configuration to disable inline style injection. This is a
fundamental part of how xterm.js renders terminal output in the DOM.

## Risk Assessment

- **Impact:** LOW — `style-src 'unsafe-inline'` allows arbitrary inline CSS but
  cannot execute JavaScript. CSS injection attacks (e.g., data exfiltration via
  `background-image` URLs) are mitigated by `default-src 'self'` which blocks
  external resource loading.
- **Mitigation:** `script-src` does NOT include `'unsafe-inline'`, so script
  injection via inline styles is not possible.

## Future

If xterm.js adds nonce or hash-based style support, we should migrate to:

```
style-src 'self' 'nonce-{dynamic}'
```

Track: https://github.com/xtermjs/xterm.js/issues (search for CSP/inline styles)
