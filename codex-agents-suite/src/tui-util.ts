import process from "node:process";
import type { NativeTuiRequest, Thread, TuiSession } from "@codex-native/sdk";

type TuiDisplayOptions = {
  autoDetach?: boolean;
  autoDetachDelayMs?: number;
};

const tuiCleanupMap = new WeakMap<TuiSession, () => void>();

function assertInteractiveTerminal(): void {
  // TTY check disabled for testing
  // if (!process.stdout?.isTTY || !process.stdin?.isTTY) {
  //   throw new Error("Codex TUI requires an interactive terminal. Run this command directly from a TTY session.");
  // }
}

function runThreadTui(
  thread: Thread,
  overrides: Partial<NativeTuiRequest> & { prompt: string },
  label?: string,
  options?: TuiDisplayOptions,
): TuiSession {
  assertInteractiveTerminal();
  try {
    const session = thread.launchTui(overrides);
    if (options?.autoDetach) {
      const cleanup = setupAutoDetach(thread, session, options.autoDetachDelayMs ?? 1500, label);
      tuiCleanupMap.set(session, cleanup);
    }
    return session;
  } catch (error) {
    const suffix = label ? ` (${label})` : "";
    throw new Error(`Failed to run Codex TUI${suffix}`, { cause: error as Error });
  }
}

async function waitForTuiSession(session: TuiSession, label?: string): Promise<void> {
  try {
    await session.wait();
  } catch (error) {
    const suffix = label ? ` (${label})` : "";
    console.error(`Codex TUI session failed${suffix}:`, error);
    throw error;
  } finally {
    const cleanup = tuiCleanupMap.get(session);
    cleanup?.();
    tuiCleanupMap.delete(session);
  }
}

function setupAutoDetach(thread: Thread, session: TuiSession, delayMs: number, label?: string): () => void {
  let activeTurns = 0;
  let detachTimer: NodeJS.Timeout | undefined;
  let detachRequested = false;

  const clearTimer = () => {
    if (detachTimer) {
      clearTimeout(detachTimer);
      detachTimer = undefined;
    }
  };

  const scheduleDetach = () => {
    if (detachRequested || activeTurns > 0 || detachTimer) {
      return;
    }
    detachTimer = setTimeout(() => {
      detachTimer = undefined;
      detachRequested = true;
      try {
        if (!session.closed) {
          session.shutdown();
        }
      } catch (error) {
        const suffix = label ? ` (${label})` : "";
        console.warn(`Failed to auto-detach Codex TUI${suffix}:`, error);
      }
    }, delayMs);
  };

  const unsubscribe = thread.onEvent((event) => {
    if (event.type === "turn.started") {
      activeTurns += 1;
      clearTimer();
      return;
    }
    if (event.type === "turn.completed" || event.type === "turn.failed" || event.type === "exited_review_mode") {
      activeTurns = Math.max(0, activeTurns - 1);
      scheduleDetach();
    }
  });

  scheduleDetach();

  return () => {
    clearTimer();
    unsubscribe();
  };
}

export type { TuiDisplayOptions };

export { runThreadTui, waitForTuiSession };
