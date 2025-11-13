import process from "node:process";
import type { NativeTuiRequest, Thread } from "@codex-native/sdk";

function assertInteractiveTerminal(): void {
  if (!process.stdout?.isTTY || !process.stdin?.isTTY) {
    throw new Error("Codex TUI requires an interactive terminal. Run this command directly from a TTY session.");
  }
}

async function runThreadTui(
  thread: Thread,
  overrides: Partial<NativeTuiRequest> & { prompt: string },
  label?: string,
): Promise<void> {
  assertInteractiveTerminal();
  try {
    await thread.tui(overrides);
  } catch (error) {
    const suffix = label ? ` (${label})` : "";
    throw new Error(`Failed to run Codex TUI${suffix}`, { cause: error as Error });
  }
}

export { runThreadTui };
