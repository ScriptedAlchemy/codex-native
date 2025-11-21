import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import type { NativeBinding } from "../src/nativeBinding";
import type { Thread } from "../src/thread";
import type { ThreadEvent } from "../src/events";

const detachMock = jest.fn();
const attachLspDiagnosticsMock = jest.fn(
  (host: Pick<Thread, "onEvent" | "sendBackgroundEvent">) => {
    host.onEvent?.(() => {});
    capturedHost = host;
    return detachMock;
  },
);

let capturedHost: Pick<Thread, "onEvent" | "sendBackgroundEvent"> | null = null;

jest.unstable_mockModule("../src/lsp", () => ({
  attachLspDiagnostics: attachLspDiagnosticsMock,
}));

const { createRunCommandLspBridge } = await import("../src/cli/lspBridge");

describe("createRunCommandLspBridge", () => {
  beforeEach(() => {
    capturedHost = null;
    detachMock.mockClear();
    attachLspDiagnosticsMock.mockClear();
  });

  it("relays thread IDs and emits background events", async () => {
    const emitBackgroundEvent = jest.fn(async () => {});
    const binding = { emitBackgroundEvent } as unknown as NativeBinding;
    const bridge = createRunCommandLspBridge({
      binding,
      workingDirectory: "/repo",
    });

    expect(bridge).not.toBeNull();
    const event: ThreadEvent = {
      type: "thread.started",
      thread_id: "thread-123",
    };
    bridge!.handleEvent(event);

    if (!capturedHost) {
      throw new Error("Host was not captured");
    }

    await capturedHost.sendBackgroundEvent("Diagnostics ready");

    expect(emitBackgroundEvent).toHaveBeenCalledWith({
      threadId: "thread-123",
      message: "Diagnostics ready",
    });
  });

  it("disposes the diagnostics bridge", () => {
    const binding = { emitBackgroundEvent: jest.fn(async () => {}) } as unknown as NativeBinding;
    const bridge = createRunCommandLspBridge({
      binding,
      workingDirectory: "/repo",
    });
    bridge?.dispose();
    expect(detachMock).toHaveBeenCalledTimes(1);
  });
});
