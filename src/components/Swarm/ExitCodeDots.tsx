/**
 * `ExitCodeDots` — render a row of up to 10 dots showing recent
 * command exit codes (T4 / ticket #143 AC3).
 *
 * Color coding (WCAG AA against the dark background):
 *  - green (0 / success)
 *  - red (non-zero)
 *  - gray (null / in-flight / abandoned)
 *
 * Newest is on the right. Always renders 10 dot slots — missing
 * positions on the left render as gray "no data" dots so the row
 * width stays visually stable as history accumulates.
 *
 * @module components/Swarm/ExitCodeDots
 */

interface Props {
  codes: ReadonlyArray<number | null> | null | undefined;
}

const TOTAL_DOTS = 10;

function colorClassFor(code: number | null | undefined): string {
  if (code === null || code === undefined) return "pending";
  return code === 0 ? "success" : "failure";
}

function labelFor(code: number | null | undefined, idx: number): string {
  if (code === null || code === undefined) return `slot ${idx + 1}: no data`;
  if (code === 0) return `slot ${idx + 1}: success (exit 0)`;
  return `slot ${idx + 1}: failure (exit ${code})`;
}

export function ExitCodeDots({ codes }: Props) {
  // Pad with null on the LEFT so the newest entries sit on the right.
  const provided = codes ?? [];
  const padded: ReadonlyArray<number | null> = [
    ...new Array<number | null>(Math.max(0, TOTAL_DOTS - provided.length)).fill(
      null,
    ),
    ...provided.slice(-TOTAL_DOTS),
  ];

  return (
    <span
      className="swarm-exit-dots"
      role="img"
      aria-label={`Last ${TOTAL_DOTS} command exit codes`}
      data-testid="swarm-exit-dots"
    >
      {padded.map((code, idx) => {
        const state = colorClassFor(code);
        return (
          <span
            key={idx}
            className={`swarm-exit-dots__dot swarm-exit-dots__dot--${state}`}
            data-testid={`swarm-exit-dot-${idx}`}
            data-state={state}
            title={labelFor(code, idx)}
          />
        );
      })}
    </span>
  );
}

export const EXIT_CODE_DOTS_TOTAL = TOTAL_DOTS;
