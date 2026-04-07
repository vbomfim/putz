/**
 * HostKeyDialog component tests.
 *
 * Tests rendering for new host key, MITM warning, and user interactions
 * (accept/reject buttons).
 *
 * Tags: [TDD], [AC-SSH-3], [AC-SSH-4]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HostKeyDialog } from "../components/Terminal/HostKeyDialog";
import type { HostKeyPayload } from "../components/Terminal/connectionTypes";

describe("HostKeyDialog", () => {
  let onAccept: ReturnType<typeof vi.fn>;
  let onReject: ReturnType<typeof vi.fn>;

  const newHostKey: HostKeyPayload = {
    host: "example.com",
    port: 22,
    fingerprint: "SHA256:abcdef1234567890abcdef1234567890abcdef12",
    keyType: "ssh-ed25519",
    action: "new",
  };

  const changedHostKey: HostKeyPayload = {
    host: "example.com",
    port: 22,
    fingerprint: "SHA256:newfingerprint1234567890abcdef123456",
    keyType: "ssh-rsa",
    action: "changed",
    expectedFingerprint: "SHA256:oldfingerprintexpected0000000000000",
  };

  beforeEach(() => {
    onAccept = vi.fn();
    onReject = vi.fn();
  });

  // ─── New host key (unknown) ─────────────────────────────

  it("renders the dialog overlay", () => {
    render(
      <HostKeyDialog
        hostKey={newHostKey}
        host="example.com"
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    expect(screen.getByTestId("hostkey-dialog")).toBeInTheDocument();
  });

  it("shows 'New SSH Host Key' title for new status", () => {
    render(
      <HostKeyDialog
        hostKey={newHostKey}
        host="example.com"
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    expect(screen.getByText("New SSH Host Key")).toBeInTheDocument();
  });

  it("displays the host name and port", () => {
    render(
      <HostKeyDialog
        hostKey={newHostKey}
        host="switch.lab.local"
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    expect(screen.getByText(/switch\.lab\.local:22/)).toBeInTheDocument();
  });

  it("displays the key fingerprint", () => {
    render(
      <HostKeyDialog
        hostKey={newHostKey}
        host="example.com"
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    expect(
      screen.getByText(newHostKey.fingerprint),
    ).toBeInTheDocument();
  });

  it("displays the key type", () => {
    render(
      <HostKeyDialog
        hostKey={newHostKey}
        host="example.com"
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    expect(screen.getByText("ssh-ed25519")).toBeInTheDocument();
  });

  it("shows accept and reject buttons for new key", () => {
    render(
      <HostKeyDialog
        hostKey={newHostKey}
        host="example.com"
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    expect(screen.getByTestId("hostkey-accept")).toBeInTheDocument();
    expect(screen.getByTestId("hostkey-reject")).toBeInTheDocument();
  });

  it("calls onAccept when accept button is clicked", () => {
    render(
      <HostKeyDialog
        hostKey={newHostKey}
        host="example.com"
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    fireEvent.click(screen.getByTestId("hostkey-accept"));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("calls onReject when reject button is clicked", () => {
    render(
      <HostKeyDialog
        hostKey={newHostKey}
        host="example.com"
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    fireEvent.click(screen.getByTestId("hostkey-reject"));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  // ─── Changed host key (MITM warning) ────────────────────

  it("shows warning title for changed key", () => {
    render(
      <HostKeyDialog
        hostKey={changedHostKey}
        host="example.com"
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    expect(
      screen.getByText(/HOST KEY CHANGED/i),
    ).toBeInTheDocument();
  });

  it("shows MITM warning text for changed key", () => {
    render(
      <HostKeyDialog
        hostKey={changedHostKey}
        host="example.com"
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    expect(
      screen.getByText(/man-in-the-middle/i),
    ).toBeInTheDocument();
  });

  it("shows expected fingerprint for changed key", () => {
    render(
      <HostKeyDialog
        hostKey={changedHostKey}
        host="example.com"
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    expect(
      screen.getByText(changedHostKey.expectedFingerprint!),
    ).toBeInTheDocument();
  });

  it("shows new fingerprint for changed key", () => {
    render(
      <HostKeyDialog
        hostKey={changedHostKey}
        host="example.com"
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    expect(
      screen.getByText(changedHostKey.fingerprint),
    ).toBeInTheDocument();
  });
});
