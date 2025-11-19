import type { Thread } from "../thread";
import type { ThreadEvent } from "../events";
import type { NativeBinding } from "../nativeBinding";
import { attachLspDiagnostics } from "../lsp";

type EventListener = (event: ThreadEvent) => void;

class RunCommandThreadRelay implements Pick<Thread, "onEvent" | "sendBackgroundEvent"> {
  private readonly listeners = new Set<EventListener>();
  private threadId: string | null;

  constructor(private readonly binding: NativeBinding, initialThreadId?: string) {
    this.threadId = initialThreadId ?? null;
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async sendBackgroundEvent(message: string): Promise<void> {
    const trimmed = typeof message === "string" ? message.trim() : "";
    if (!trimmed) {
      throw new Error("Background event message must be a non-empty string");
    }
    if (!this.threadId) {
      throw new Error("Cannot emit a background event before the thread has started");
    }
    if (typeof this.binding.emitBackgroundEvent !== "function") {
      throw new Error("emitBackgroundEvent is not available in this build");
    }
    await this.binding.emitBackgroundEvent({ threadId: this.threadId, message: trimmed });
  }

  handleEvent(event: ThreadEvent): void {
    if (event.type === "thread.started" && typeof event.thread_id === "string") {
      this.threadId = event.thread_id;
    }
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.warn("[codex-native] LSP listener failed", error);
      }
    }
  }

  setThreadId(id: string | undefined): void {
    if (id) {
      this.threadId = id;
    }
  }
}

export function createRunCommandLspBridge(params: {
  binding: NativeBinding;
  workingDirectory: string;
  initialThreadId?: string;
}): {
  handleEvent: (event: ThreadEvent) => void;
  dispose: () => void;
} | null {
  try {
    const relay = new RunCommandThreadRelay(params.binding, params.initialThreadId);
    const detach = attachLspDiagnostics(relay as unknown as Thread, {
      workingDirectory: params.workingDirectory,
      waitForDiagnostics: true,
    });
    relay.setThreadId(params.initialThreadId);
    return {
      handleEvent: (event: ThreadEvent) => relay.handleEvent(event),
      dispose: () => detach(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[codex-native] Failed to initialize LSP diagnostics bridge: ${message}`);
    return null;
  }
}
