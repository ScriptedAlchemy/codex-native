import process from "node:process";
import type { NativeTuiRequest, Thread, TuiSession } from "@codex-native/sdk";

function assertInteractiveTerminal(): void {
  if (!process.stdout?.isTTY || !process.stdin?.isTTY) {
    throw new Error("Codex TUI requires an interactive terminal. Run this command directly from a TTY session.");
  }
}

function runThreadTui(
  thread: Thread,
  overrides: Partial<NativeTuiRequest> & { prompt: string },
  label?: string,
): TuiSession {
  assertInteractiveTerminal();
  try {
    const session = thread.launchTui(overrides);
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
  }
}

export { runThreadTui, waitForTuiSession };
