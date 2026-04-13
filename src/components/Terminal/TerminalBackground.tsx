/**
 * TerminalBackground — Animated canvas backgrounds and hostname watermark.
 *
 * Two modes:
 * 1. Animated effects (matrix, starfield, network, rain) — fun/aesthetic
 * 2. Hostname watermark — large faded text showing which device you're on
 *
 * Renders behind the terminal with the xterm background semi-transparent.
 *
 * @module TerminalBackground
 */
import { useEffect, useRef, useCallback } from "react";

export type BackgroundEffect = "none" | "matrix" | "starfield" | "rain" | "network" | "copilot";

interface TerminalBackgroundProps {
  effect: BackgroundEffect;
  opacity?: number;
  color?: string;
  speed?: number;
  /** Hostname/label watermark — shown as large faded text behind terminal. */
  hostname?: string;
}

// ── Hostname Watermark ─────────────────────────────────────────
function hostnameWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, hostname: string, color: string) {
  ctx.clearRect(0, 0, w, h);

  // Large centered hostname
  const fontSize = Math.min(w / (hostname.length * 0.55), h * 0.25, 120);
  ctx.font = `bold ${fontSize}px "JetBrains Mono", "Cascadia Code", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.07;
  ctx.fillText(hostname, w / 2, h / 2);

  // Smaller repeated pattern (subtle)
  ctx.font = `${Math.max(12, fontSize * 0.15)}px monospace`;
  ctx.globalAlpha = 0.03;
  const smallSize = Math.max(12, fontSize * 0.15);
  const cols = Math.ceil(w / (hostname.length * smallSize * 0.6));
  const rows = Math.ceil(h / (smallSize * 3));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * (hostname.length * smallSize * 0.6) + (r % 2 ? smallSize * 2 : 0);
      const y = r * smallSize * 3;
      if (Math.abs(y - h / 2) < fontSize * 0.7 && Math.abs(x - w / 2) < hostname.length * fontSize * 0.3) continue;
      ctx.fillText(hostname, x, y);
    }
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

// ── Matrix Digital Rain ────────────────────────────────────────
function matrixRain(ctx: CanvasRenderingContext2D, w: number, h: number, state: MatrixState, color: string, speed: number) {
  const fontSize = 14;
  const cols = Math.ceil(w / fontSize);

  if (state.drops.length !== cols) {
    state.drops = Array.from({ length: cols }, () => Math.random() * -100);
    state.chars = Array.from({ length: cols }, () => randomMatrixChar());
    state.speeds = Array.from({ length: cols }, () => 0.3 + Math.random() * 0.7);
  }

  // Clear to transparent
  ctx.clearRect(0, 0, w, h);
  ctx.font = `${fontSize}px monospace`;

  for (let i = 0; i < cols; i++) {
    const y = state.drops[i] * fontSize;

    // Draw trail (dimming upward)
    for (let j = 0; j < 12; j++) {
      const trailY = y - j * fontSize;
      if (trailY < 0 || trailY > h) continue;
      ctx.fillStyle = color;
      ctx.globalAlpha = j === 0 ? 1 : Math.max(0, 0.6 - j * 0.05);
      ctx.fillText(randomMatrixChar(), i * fontSize, trailY);
    }

    state.drops[i] += state.speeds[i] * speed;

    if (Math.random() > 0.95) {
      state.chars[i] = randomMatrixChar();
    }

    if (y > h && Math.random() > 0.975) {
      state.drops[i] = Math.random() * -20;
      state.speeds[i] = 0.3 + Math.random() * 0.7;
    }
  }
  ctx.globalAlpha = 1;
}

interface MatrixState {
  drops: number[];
  chars: string[];
  speeds: number[];
}

function randomMatrixChar(): string {
  const sets = [
    "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン",
    "0123456789",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "{}[]<>|/\\@#$%&*+=~",
  ];
  const set = sets[Math.floor(Math.random() * sets.length)];
  return set[Math.floor(Math.random() * set.length)];
}

// ── Starfield ──────────────────────────────────────────────────
interface Star {
  x: number;
  y: number;
  z: number;
  pz: number;
}

function starfield(ctx: CanvasRenderingContext2D, w: number, h: number, state: { stars: Star[] }, color: string, speed: number) {
  const numStars = 200;
  if (state.stars.length !== numStars) {
    state.stars = Array.from({ length: numStars }, () => ({
      x: Math.random() * w - w / 2,
      y: Math.random() * h - h / 2,
      z: Math.random() * w,
      pz: 0,
    }));
  }

  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;

  for (const star of state.stars) {
    star.pz = star.z;
    star.z -= 2 * speed;

    if (star.z <= 0) {
      star.x = Math.random() * w - w / 2;
      star.y = Math.random() * h - h / 2;
      star.z = w;
      star.pz = w;
    }

    const sx = (star.x / star.z) * w + cx;
    const sy = (star.y / star.z) * h + cy;
    const px = (star.x / star.pz) * w + cx;
    const py = (star.y / star.pz) * h + cy;
    const size = Math.max(0, (1 - star.z / w) * 3);

    ctx.strokeStyle = color;
    ctx.globalAlpha = Math.min(1, size / 2);
    ctx.lineWidth = size;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(sx, sy);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ── Digital Rain (subtle) ──────────────────────────────────────
function digitalRain(ctx: CanvasRenderingContext2D, w: number, h: number, state: { offset: number }, color: string, speed: number) {
  ctx.clearRect(0, 0, w, h);

  state.offset += 0.5 * speed;
  const cols = Math.ceil(w / 20);

  ctx.font = "10px monospace";
  ctx.fillStyle = color;

  for (let i = 0; i < cols; i++) {
    const x = i * 20;
    const baseY = ((state.offset * (0.5 + (i % 3) * 0.3)) % (h + 200)) - 100;

    for (let j = 0; j < 8; j++) {
      const y = baseY + j * 16;
      if (y < 0 || y > h) continue;
      ctx.globalAlpha = 0.1 + (1 - j / 8) * 0.3;
      ctx.fillText(
        String.fromCharCode(0x30 + Math.floor(Math.random() * 10)),
        x + Math.sin(y * 0.01) * 3,
        y,
      );
    }
  }
  ctx.globalAlpha = 1;
}

// ── Network Particles ──────────────────────────────────────────
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function networkParticles(ctx: CanvasRenderingContext2D, w: number, h: number, state: { particles: Particle[] }, color: string, speed: number) {
  const count = 60;
  if (state.particles.length !== count) {
    state.particles = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
    }));
  }

  ctx.clearRect(0, 0, w, h);

  const connectionDist = 120;

  for (const p of state.particles) {
    p.x += p.vx * speed;
    p.y += p.vy * speed;

    if (p.x < 0 || p.x > w) p.vx *= -1;
    if (p.y < 0 || p.y > h) p.vy *= -1;

    ctx.fillStyle = color;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw connections
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  for (let i = 0; i < state.particles.length; i++) {
    for (let j = i + 1; j < state.particles.length; j++) {
      const dx = state.particles[i].x - state.particles[j].x;
      const dy = state.particles[i].y - state.particles[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < connectionDist) {
        ctx.globalAlpha = (1 - dist / connectionDist) * 0.3;
        ctx.beginPath();
        ctx.moveTo(state.particles[i].x, state.particles[i].y);
        ctx.lineTo(state.particles[j].x, state.particles[j].y);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
}

// ── Copilot Avatar ─────────────────────────────────────────────
const AVATAR_FRAMES = {
  normal: [
    "       ▄██████▄       ",
    "   ▄█▀▀▀▀▀██▀▀▀▀▀█▄   ",
    "  ▐█      ▐▌      █▌  ",
    "  ▐█▄    ▄██▄    ▄█▌  ",
    " ▄▄███████▀▀███████▄▄ ",
    "████     ▄  ▄     ████",
    "████     █  █     ████",
    "▀███▄            ▄███▀",
    "   ▀▀████████████▀▀   ",
  ],
  blink: [
    "       ▄██████▄       ",
    "   ▄█▀▀▀▀▀██▀▀▀▀▀█▄   ",
    "  ▐█      ▐▌      █▌  ",
    "  ▐█▄    ▄██▄    ▄█▌  ",
    " ▄▄███████▀▀███████▄▄ ",
    "████     ─  ─     ████",
    "████              ████",
    "▀███▄            ▄███▀",
    "   ▀▀████████████▀▀   ",
  ],
  halfBlink: [
    "       ▄██████▄       ",
    "   ▄█▀▀▀▀▀██▀▀▀▀▀█▄   ",
    "  ▐█      ▐▌      █▌  ",
    "  ▐█▄    ▄██▄    ▄█▌  ",
    " ▄▄███████▀▀███████▄▄ ",
    "████     ▀  ▀     ████",
    "████              ████",
    "▀███▄            ▄███▀",
    "   ▀▀████████████▀▀   ",
  ],
  yawn: [
    "       ▄██████▄       ",
    "   ▄█▀▀▀▀▀██▀▀▀▀▀█▄   ",
    "  ▐█      ▐▌      █▌  ",
    "  ▐█▄    ▄██▄    ▄█▌  ",
    " ▄▄███████▀▀███████▄▄ ",
    "████     ▀  ▀     ████",
    "████              ████",
    "▀███▄    ▄▄▄▄    ▄███▀",
    "   ▀▀████████████▀▀   ",
  ],
  yawnWide: [
    "       ▄██████▄       ",
    "   ▄█▀▀▀▀▀██▀▀▀▀▀█▄   ",
    "  ▐█      ▐▌      █▌  ",
    "  ▐█▄    ▄██▄    ▄█▌  ",
    " ▄▄███████▀▀███████▄▄ ",
    "████     ─  ─     ████",
    "████              ████",
    "▀███▄   ▄████▄   ▄███▀",
    "   ▀▀████████████▀▀   ",
  ],
  smile: [
    "       ▄██████▄       ",
    "   ▄█▀▀▀▀▀██▀▀▀▀▀█▄   ",
    "  ▐█      ▐▌      █▌  ",
    "  ▐█▄    ▄██▄    ▄█▌  ",
    " ▄▄███████▀▀███████▄▄ ",
    "████     ▀  ▀     ████",
    "████              ████",
    "▀███▄     ‿‿     ▄███▀",
    "   ▀▀████████████▀▀   ",
  ],
};

type AvatarFrame = keyof typeof AVATAR_FRAMES;

interface CopilotState {
  frame: AvatarFrame;
  timer: number;
  blinkTimer: number;
  idleTimer: number;
  phase: string;
  phaseStep: number;
}

function copilotAvatar(ctx: CanvasRenderingContext2D, w: number, h: number, state: CopilotState, color: string, speed: number) {
  ctx.clearRect(0, 0, w, h);

  state.timer += speed;

  if (state.phase === "idle") {
    state.blinkTimer += 1;
    state.idleTimer += 1;
    // Blink every ~480 frames (~8s at 60fps)
    if (state.blinkTimer > 480) {
      state.phase = "blinking";
      state.phaseStep = 0;
      state.blinkTimer = 0;
    }
    // Yawn after ~1200 frames (~20s idle)
    if (state.idleTimer > 1200) {
      state.phase = "yawning";
      state.phaseStep = 0;
      state.idleTimer = 0;
    }
    state.frame = "normal";
  } else if (state.phase === "blinking") {
    state.phaseStep += speed;
    if (state.phaseStep < 6) state.frame = "halfBlink";
    else if (state.phaseStep < 18) state.frame = "blink";
    else if (state.phaseStep < 24) state.frame = "halfBlink";
    else { state.frame = "normal"; state.phase = "idle"; }
  } else if (state.phase === "yawning") {
    state.phaseStep += speed;
    if (state.phaseStep < 24) state.frame = "yawn";
    else if (state.phaseStep < 48) state.frame = "yawnWide";
    else if (state.phaseStep < 72) state.frame = "yawn";
    else if (state.phaseStep < 84) state.frame = "smile";
    else { state.frame = "normal"; state.phase = "idle"; }
  }

  const lines = AVATAR_FRAMES[state.frame];
  const maxLineLen = Math.max(...lines.map((l) => l.length));
  const targetH = h * 0.4;
  const fontSize = Math.min(targetH / lines.length, w / (maxLineLen * 0.6), 32);

  ctx.font = `${fontSize}px monospace`;
  ctx.textBaseline = "middle";

  // Per-character color maps: P=purple, C=cyan, G=green, R=red, .=default
  const PURPLE = "#C78CE1";
  const CYAN = "#9BDCDF";
  const GREEN = "#8ABC81";
  const RED = "#F38BA8";

  const colorMapTop = [
    ".......PPPPPPPP.......",
    "...CCCCCCCCCCCCCCCC...",
    "..CC......CC......CC..",
    "..CCC....CCCC....CCC..",
    ".PPPCCCCCCCCCCCCCCPPP.",
  ];
  // Eyes/mouth rows vary per expression
  const eyeColorMaps: Record<string, string[]> = {
    normal:   ["PPPP.....G..G.....PPPP", "PPPP.....G..G.....PPPP", "PPPPP............PPPPP"],
    blink:    ["PPPP.....G..G.....PPPP", "PPPP..............PPPP", "PPPPP............PPPPP"],
    halfBlink:["PPPP.....G..G.....PPPP", "PPPP..............PPPP", "PPPPP............PPPPP"],
    yawn:     ["PPPP.....G..G.....PPPP", "PPPP..............PPPP", "PPPPP............PPPPP"],
    yawnWide: ["PPPP.....G..G.....PPPP", "PPPP..............PPPP", "PPPPP............PPPPP"],
    smile:    ["PPPP.....G..G.....PPPP", "PPPP..............PPPP", "PPPPP............PPPPP"],
  };
  const colorMapRow8 = "...PPPPPPPPPPPPPPPP...";

  const eyeRows = eyeColorMaps[state.frame] || eyeColorMaps.normal;
  const colorMap = [...colorMapTop, ...eyeRows, colorMapRow8];

  const useMultiColor = color === "multicolor";
  const colorLookup: Record<string, string> = { P: PURPLE, C: CYAN, G: GREEN, R: RED };

  // Measure char width
  const charW = ctx.measureText("█").width;
  const totalW = maxLineLen * charW;
  const startX = (w - totalW) / 2;
  const startY = h / 2 - (lines.length * fontSize) / 2;

  ctx.textAlign = "start";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cmap = i < colorMap.length ? colorMap[i] : "";
    const y = startY + i * fontSize + fontSize / 2;

    if (!useMultiColor) {
      // Single color — draw whole line
      ctx.fillStyle = color;
      ctx.fillText(line, startX, y);
    } else {
      // Multi-color — draw char by char
      for (let c = 0; c < line.length; c++) {
        const ch = line[c];
        if (ch === " ") continue;
        const code = c < cmap.length ? cmap[c] : ".";
        ctx.fillStyle = colorLookup[code] || "#CDD6F4";
        ctx.fillText(ch, startX + c * charW, y);
      }
    }
  }

  ctx.textBaseline = "alphabetic";
}

// ── Main Component ─────────────────────────────────────────────
export function TerminalBackground({
  effect,
  opacity = 0.15,
  color = "#50fa7b",
  speed = 1,
  hostname,
}: TerminalBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const stateRef = useRef<Record<string, unknown>>({
    drops: [], chars: [], speeds: [],
    stars: [],
    offset: 0,
    particles: [],
    frame: "normal" as AvatarFrame, timer: 0, blinkTimer: 0, idleTimer: 0, phase: "idle", phaseStep: 0,
  });

  // Static hostname watermark (no animation loop needed)
  const hostnameCanvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!hostname) return;
    const canvas = hostnameCanvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const draw = () => {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) hostnameWatermark(ctx, canvas.width, canvas.height, hostname, color);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [hostname, color]);

  const frameCountRef = useRef(0);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || effect === "none") return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const s = stateRef.current;

    // Resolve rainbow color — cycle hue each frame
    frameCountRef.current += 1;
    const resolvedColor = color === "rainbow"
      ? `hsl(${(frameCountRef.current * 0.5) % 360}, 100%, 60%)`
      : color;

    switch (effect) {
      case "matrix":
        matrixRain(ctx, w, h, s as unknown as MatrixState, resolvedColor, speed);
        break;
      case "starfield":
        starfield(ctx, w, h, s as unknown as { stars: Star[] }, resolvedColor, speed);
        break;
      case "rain":
        digitalRain(ctx, w, h, s as unknown as { offset: number }, resolvedColor, speed);
        break;
      case "network":
        networkParticles(ctx, w, h, s as unknown as { particles: Particle[] }, resolvedColor, speed);
        break;
      case "copilot":
        copilotAvatar(ctx, w, h, s as unknown as CopilotState, resolvedColor, speed);
        break;
    }

    animRef.current = requestAnimationFrame(render);
  }, [effect, color, speed]);

  useEffect(() => {
    if (effect === "none") return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    if (canvas.parentElement) observer.observe(canvas.parentElement);

    animRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animRef.current);
      observer.disconnect();
    };
  }, [effect, render]);

  if (effect === "none" && !hostname) return null;

  return (
    <>
      {hostname && (
        <canvas
          ref={hostnameCanvasRef}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 10,
            pointerEvents: "none",
          }}
        />
      )}
      {effect !== "none" && (
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 10,
            opacity,
            pointerEvents: "none",
          }}
        />
      )}
    </>
  );
}
