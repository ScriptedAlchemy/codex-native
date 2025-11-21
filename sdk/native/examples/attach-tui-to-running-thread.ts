/**
 * Example: Attach the TUI to a Running Thread
 *
 * This script shows how to attach the Codex TUI to an already-running thread
 * without waiting for the current turn to finish, and then programmatically
 * detach after a short delay:
 *
 * 1. Kick off a long-running `thread.run(...)` without awaiting it.
 * 2. Attach the TUI mid-flight so you can observe or guide the thread.
 * 3. Automatically request TUI shutdown after a configurable delay, then await
 *    the pending run.
 * 4. Submit another request, then reattach the TUI while that run executes.
 *
 * Run this inside a real terminal so the TUI can take over the screen:
 *   npx tsx sdk/native/examples/attach-tui-to-running-thread.ts
 */

import { Codex } from "@codex-native/sdk";

type ThreadInstance = ReturnType<InstanceType<typeof Codex>["startThread"]>;

const DEFAULT_MODEL = "gpt-5.1-codex-mini";

async function main() {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.error("This example requires an interactive terminal (TTY).");
    console.error("Please run it in a regular shell session (auto-detach still occurs).");
    process.exit(1);
  }

  console.log("=== Phase 1: Programmatic Agent Start ===\n");

  const codex = new Codex();
  const thread = codex.startThread({
    model: process.env.CODEX_MODEL ?? DEFAULT_MODEL,
    sandboxMode: "workspace-write",
    approvalMode: "on-request",
    skipGitRepoCheck: true,
  });

  console.log(`Thread ID: ${thread.id ?? "(pending…)"}\n`);

  console.log("Launching a long-running analysis turn (without awaiting)...");
  const initialPrompt = `Do a comprehensive project scan.\n- List notable directories\n- Describe git status\n- Explain how you would triage tests\n- Spend some time thinking before you answer`;
  const pendingInitialTurn = thread.run(initialPrompt);

  console.log("Attaching the TUI while that first turn is still running.");
  console.log("Press Esc (or Ctrl+C) inside the TUI to detach.\n");
  await attachAutoDetachedTui(thread, "Help finish the ongoing project scan.", "First TUI session");

  console.log("Detaching back to code. Waiting for the long-running turn to finish…");
  const initialResult = await pendingInitialTurn;
  console.log(`Initial turn completed. Summary snippet: ${truncate(initialResult.finalResponse ?? "(no response)")}\n`);

  console.log("Submitting a follow-up prompt programmatically…\n");
  const followUpPrompt = "Summarize what we've discussed so far and outline next steps.";
  const pendingFollowUp = thread.run(followUpPrompt);

  console.log("Re-attaching the TUI while the follow-up runs.\n");
  await attachAutoDetachedTui(thread, "Continue the follow-up interactively.", "Second TUI session");

  console.log("Detached again. Awaiting the follow-up turn…");
  const followUpResult = await pendingFollowUp;
  console.log(`Follow-up completed. Summary snippet: ${truncate(followUpResult.finalResponse ?? "(no response)")}\n`);

  console.log("=== Demo Complete ===");
  console.log("You can re-run this script and try different prompts or models using CODEX_MODEL.");
}

const DEFAULT_TUI_DURATION_MS = 3_000;

async function attachAutoDetachedTui(thread: ThreadInstance, prompt: string, label: string) {
  const durationMs = readNumberEnv("CODEX_TUI_AUTO_DETACH_MS", DEFAULT_TUI_DURATION_MS);
  console.log(`[${label}] Launching TUI (auto-detaching after ${durationMs}ms)…`);

  const session = thread.launchTui({ prompt });
  const waitPromise = session.wait();

  await delay(durationMs);
  console.log(`[${label}] Requesting shutdown…`);
  try {
    session.shutdown();
  } catch (error) {
    console.warn(`[${label}] Failed to request shutdown: ${String(error)}`);
  }

  const exitInfo = await waitPromise;
  console.log(`[${label}] Detached (total tokens: ${exitInfo.tokenUsage.totalTokens})\n`);
  return exitInfo;
}

function truncate(text: string, maxLength: number = 160): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
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
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
