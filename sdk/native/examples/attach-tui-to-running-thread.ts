/**
 * Example: Attach and Detach TUI to Running Thread
 *
 * This example demonstrates the full attach/detach cycle:
 * 1. Start an agent programmatically (non-interactive)
 * 2. Run some messages programmatically
 * 3. Attach TUI to continue interactively
 * 4. Exit TUI (detach) back to programmatic mode
 * 5. Continue programmatically after TUI exit
 * 6. Re-attach TUI again for another interactive session
 *
 * This showcases the flexibility of seamlessly switching between
 * programmatic and interactive modes while maintaining conversation state.
 *
 * Usage:
 *   npx tsx sdk/native/examples/attach-tui-to-running-thread.ts
 */

import { Codex } from "@codex-native/sdk";

import { getNativeBinding } from "../src/nativeBinding";
import { describeError } from "./utils";

type ThreadInstance = ReturnType<Codex["startThread"]>;
type TuiExitInfo = Awaited<ReturnType<ThreadInstance["tui"]>>;

const AUTOMATED_TUI_ENV = "CODEX_AUTOMATE_TUI";
const DEFAULT_AUTOMATED_SHUTDOWN_DELAY_MS = 1_500;
const DEFAULT_AUTOMATED_TIMEOUT_MS = 20_000;

async function main() {
  console.log("=== Phase 1: Programmatic Agent Start ===\n");

  // Start a thread programmatically
  const codex = new Codex();
  const thread = codex.startThread({
    model: "tub 5.1 mini",
    sandboxMode: "workspace-write",
    approvalMode: "on-request",
    skipGitRepoCheck: true,
  });

  console.log(`Thread ID: ${thread.id}\n`);

  // Run some messages programmatically
  console.log("Running messages programmatically...");
  const transcript: string[] = [];
  const result1 = await thread.run("What files are in the current directory?");
  console.log(`Response 1 (truncated): ${result1.finalResponse.slice(0, 80)}...\n`);
  recordInteraction(transcript, "User", "What files are in the current directory?");
  recordInteraction(transcript, "Codex", result1.finalResponse);

  const result2 = await thread.run("What is the git status?");
  console.log(`Response 2 (truncated): ${result2.finalResponse.slice(0, 80)}...\n`);
  recordInteraction(transcript, "User", "What is the git status?");
  recordInteraction(transcript, "Codex", result2.finalResponse);

  let programmaticTurns = 2;
  console.log(`Programmatic turns so far: ${programmaticTurns}\n`);

  const interactiveTerminal = Boolean(process.stdout.isTTY && process.stdin.isTTY);
  const headlessMode = !interactiveTerminal;
  const automationMode =
    process.env["CI"] === "1" || process.env[AUTOMATED_TUI_ENV] === "1" || !interactiveTerminal;

  if (!interactiveTerminal && !automationMode) {
    console.log("⚠ Not in an interactive terminal. Skipping TUI demo.");
    console.log("Set CODEX_AUTOMATE_TUI=1 to run an automated attach/detach cycle.");
    return;
  }

  if (automationMode) {
    console.log("⚙️  Automation mode enabled. TUI will attach/detach programmatically.");
  }

  // === First TUI Attach ===
  console.log("=== Phase 2: First TUI Attach ===\n");
  console.log("Attaching TUI to the running thread...");
  console.log("The TUI will show all conversation history.");
  console.log("You can interact, then exit the TUI to continue programmatically.\n");

  const exitInfo1 = headlessMode
    ? await simulateTuiSession(thread, transcript, "First TUI session")
    : await runTuiSession(
        thread,
        {
          prompt: "Continue the conversation interactively!",
        },
        automationMode,
        "First TUI session",
      );

  if (!exitInfo1) {
    console.log("⚠ Unable to launch TUI session. Exiting early.");
    return;
  }

  console.log("\n=== Phase 3: TUI Detached (Back to Programmatic) ===");
  console.log(`TUI exited. Tokens used: ${exitInfo1.tokenUsage.totalTokens}`);
  console.log(`Programmatic turns so far: ${programmaticTurns}\n`);

  // Continue programmatically after TUI exit
  console.log("Continuing programmatically after TUI...");
  const result3 = await thread.run("Summarize what we've discussed so far.");
  console.log(`Response 3 (truncated): ${result3.finalResponse.slice(0, 80)}...\n`);
  programmaticTurns += 1;
  console.log(`Programmatic turns so far: ${programmaticTurns}\n`);
  recordInteraction(transcript, "User", "Summarize what we've discussed so far.");
  recordInteraction(transcript, "Codex", result3.finalResponse);

  // === Second TUI Attach ===
  console.log("=== Phase 4: Second TUI Attach ===\n");
  console.log("Re-attaching TUI to the same thread...");
  console.log("All history including programmatic messages will be visible.\n");

  const exitInfo2 = headlessMode
    ? await simulateTuiSession(thread, transcript, "Second TUI session")
    : await runTuiSession(
        thread,
        {
          prompt: "Let's continue our discussion!",
        },
        automationMode,
        "Second TUI session",
      );

  if (exitInfo2) {
    console.log("\n=== Phase 5: Complete ===");
    console.log(`Final TUI session exited. Total tokens: ${exitInfo2.tokenUsage.totalTokens}`);
    console.log(`Programmatic turns executed: ${programmaticTurns}`);
    console.log("\nThis demonstrates seamless attach/detach cycles between");
    console.log("programmatic and interactive modes! 🎉");
  } else {
    console.log("\n=== Phase 5: Skipped ===");
    console.log("Second TUI session did not run.");
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

type TuiOverrides = Parameters<ThreadInstance["tui"]>[0];

async function simulateTuiSession(
  thread: ThreadInstance,
  transcript: string[],
  label: string,
): Promise<TuiExitInfo | null> {
  console.log(`[${label}] Running headless TUI simulation`);
  const enhancedTranscript = [
    ...transcript,
    `${label}: Simulated interactive session`,
  ];

  const binding = safeGetNativeBinding();

  if (binding?.tuiTestRun) {
    try {
      const viewportHeight = Math.min(20, enhancedTranscript.length);
      const lines = enhancedTranscript.slice(-viewportHeight);
      const frames = await binding.tuiTestRun({
        width: 80,
        height: 24,
        viewport: { x: 0, y: 24 - viewportHeight, width: 80, height: viewportHeight },
        lines,
      });
      console.log(`[${label}] Generated ${frames.length} headless frame(s)`);
    } catch (error) {
      console.warn(`[${label}] tuiTestRun failed: ${describeError(error)}`);
      logTranscript(enhancedTranscript);
    }
  } else {
    console.log(`[${label}] Native binding did not expose tuiTestRun; printing transcript:`);
    logTranscript(enhancedTranscript);
  }

  transcript.push(`${label}: Headless TUI cycle completed`);

  return {
    tokenUsage: {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    },
    conversationId: thread.id ?? undefined,
  };
}

async function runTuiSession(
  thread: ThreadInstance,
  overrides: TuiOverrides,
  automationMode: boolean,
  label: string,
): Promise<TuiExitInfo | null> {
  if (!automationMode) {
    return thread.tui(overrides);
  }

  console.log(`[${label}] Starting automated TUI session`);

  try {
    const session = thread.launchTui(overrides);
    const exitPromise = session.wait();
    console.log(`[${label}] Session launched`);

    const delayMs = readNumberEnv("CODEX_AUTOMATED_TUI_DELAY_MS", DEFAULT_AUTOMATED_SHUTDOWN_DELAY_MS);
    const timeoutMs = readNumberEnv("CODEX_AUTOMATED_TUI_TIMEOUT_MS", DEFAULT_AUTOMATED_TIMEOUT_MS);

    await delay(delayMs);
    console.log(`[${label}] Delay completed, requesting shutdown`);

    try {
      session.shutdown();
      console.log(`[${label}] Shutdown requested`);
    } catch (error) {
      console.warn(`[${label}] Failed to request shutdown: ${describeError(error)}`);
    }

    const exitInfo = await withTimeout(exitPromise, timeoutMs, label);
    console.log(`[${label}] Session exited successfully`);
    return exitInfo;
  } catch (error) {
    console.error(`[${label}] Automated TUI session failed: ${describeError(error)}`);
    return null;
  }
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${label} did not complete within ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function safeGetNativeBinding() {
  try {
    return getNativeBinding();
  } catch (error) {
    console.warn(`Native binding unavailable: ${describeError(error)}`);
    return null;
  }
}

function logTranscript(lines: string[]): void {
  for (const line of lines) {
    console.log(`  ${line}`);
  }
}

function recordInteraction(transcript: string[], role: string, message: string): void {
  transcript.push(`${role}: ${truncate(message)}`);
}

function truncate(text: string, maxLength: number = 120): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}
