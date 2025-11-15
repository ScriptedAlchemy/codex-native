import test from "node:test";
import assert from "node:assert/strict";
import { runThreadTui, waitForTuiSession } from "../src/tui-util.js";
import type { Thread, TuiSession } from "@codex-native/sdk";

type Listener = (event: { type: string }) => void;

class FakeSession implements TuiSession {
  closed = false;
  private resolver!: () => void;
  private readonly waitPromise: Promise<void>;

  constructor() {
    this.waitPromise = new Promise((resolve) => {
      this.resolver = resolve;
    });
  }

  async wait(): Promise<void> {
    return this.waitPromise;
  }

  shutdown(): void {
    if (!this.closed) {
      this.closed = true;
      this.resolver();
    }
  }
}

class FakeThread {
  private listener: Listener | null = null;
  public unsubscribeCalled = false;
  constructor(private readonly session: FakeSession) {}

  launchTui(): TuiSession {
    return this.session;
  }

  onEvent(listener: Listener): () => void {
    this.listener = listener;
    return () => {
      this.unsubscribeCalled = true;
      if (this.listener === listener) {
        this.listener = null;
      }
    };
  }
}

function forceTty(): () => void {
  const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

  return () => {
    if (stdoutDescriptor) {
      Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
    }
    if (stdinDescriptor) {
      Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
    }
  };
}

test("runThreadTui auto-detaches idle session", async () => {
  const restoreTty = forceTty();
  try {
    const session = new FakeSession();
    const fakeThread = new FakeThread(session);
    const tuiSession = runThreadTui(
      fakeThread as unknown as Thread,
      { prompt: "Auto detach demo" },
      "auto-detach",
      {
        autoDetach: true,
        autoDetachDelayMs: 10,
      },
    );

    const waitPromise = waitForTuiSession(tuiSession, "auto-detach");
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.equal(session.closed, true, "session should auto shutdown when thread is idle");
    await waitPromise;
    assert.equal(fakeThread.unsubscribeCalled, true, "event subscription should be cleaned up");
  } finally {
    restoreTty();
  }
});
