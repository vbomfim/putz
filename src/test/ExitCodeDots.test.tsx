import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExitCodeDots, EXIT_CODE_DOTS_TOTAL } from "../components/Swarm/ExitCodeDots";

describe("ExitCodeDots", () => {
  it("always renders 10 slots", () => {
    render(<ExitCodeDots codes={[0, 0, 1]} />);
    for (let i = 0; i < EXIT_CODE_DOTS_TOTAL; i++) {
      expect(screen.getByTestId(`swarm-exit-dot-${i}`)).toBeInTheDocument();
    }
  });

  it("pads on the left so newest entries sit on the right", () => {
    render(<ExitCodeDots codes={[0, 1]} />);
    // Last two slots get the supplied data.
    expect(screen.getByTestId("swarm-exit-dot-8")).toHaveAttribute(
      "data-state",
      "success",
    );
    expect(screen.getByTestId("swarm-exit-dot-9")).toHaveAttribute(
      "data-state",
      "failure",
    );
    // Earlier slots are pending.
    expect(screen.getByTestId("swarm-exit-dot-0")).toHaveAttribute(
      "data-state",
      "pending",
    );
  });

  it("renders zero codes as success", () => {
    render(<ExitCodeDots codes={[0]} />);
    expect(screen.getByTestId("swarm-exit-dot-9")).toHaveAttribute(
      "data-state",
      "success",
    );
  });

  it("renders non-zero codes as failure", () => {
    render(<ExitCodeDots codes={[127]} />);
    expect(screen.getByTestId("swarm-exit-dot-9")).toHaveAttribute(
      "data-state",
      "failure",
    );
  });

  it("renders null/undefined codes as pending", () => {
    render(<ExitCodeDots codes={[null]} />);
    expect(screen.getByTestId("swarm-exit-dot-9")).toHaveAttribute(
      "data-state",
      "pending",
    );
  });

  it("provides accessible aria-label", () => {
    render(<ExitCodeDots codes={[0, 1, 0]} />);
    expect(screen.getByLabelText(/Last 10 command exit codes/)).toBeInTheDocument();
  });

  it("handles null codes prop", () => {
    render(<ExitCodeDots codes={null} />);
    // All 10 slots pending.
    for (let i = 0; i < 10; i++) {
      expect(screen.getByTestId(`swarm-exit-dot-${i}`)).toHaveAttribute(
        "data-state",
        "pending",
      );
    }
  });

  it("trims overflow from the head when more than 10 codes provided", () => {
    const codes = Array.from({ length: 15 }, (_, i) => (i < 5 ? 1 : 0));
    render(<ExitCodeDots codes={codes} />);
    // Only the last 10 should appear; all should be 0/success.
    for (let i = 0; i < 10; i++) {
      expect(screen.getByTestId(`swarm-exit-dot-${i}`)).toHaveAttribute(
        "data-state",
        "success",
      );
    }
  });
});
