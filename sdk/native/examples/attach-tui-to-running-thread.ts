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

async function main() {
  console.log("=== Phase 1: Programmatic Agent Start ===\n");

  // Start a thread programmatically
  const codex = new Codex();
  const thread = codex.startThread({
    model: "gpt-5-codex-mini",
    sandboxMode: "workspace-write",
    approvalMode: "on-request",
    skipGitRepoCheck: true,
  });

  console.log(`Thread ID: ${thread.id}\n`);

  // Run some messages programmatically
  console.log("Running messages programmatically...");
  const result1 = await thread.run("What files are in the current directory?");
  console.log(`Response 1 (truncated): ${result1.text.slice(0, 80)}...\n`);

  const result2 = await thread.run("What is the git status?");
  console.log(`Response 2 (truncated): ${result2.text.slice(0, 80)}...\n`);

  console.log(`History: ${thread.history.length} messages\n`);

  // Check if we're in a TTY environment
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.log("⚠ Not in an interactive terminal. Skipping TUI demo.");
    console.log("Run this script in a terminal to see the full attach/detach cycle.");
    return;
  }

  // === First TUI Attach ===
  console.log("=== Phase 2: First TUI Attach ===\n");
  console.log("Attaching TUI to the running thread...");
  console.log("The TUI will show all conversation history.");
  console.log("You can interact, then exit the TUI to continue programmatically.\n");

  const exitInfo1 = await thread.tui({
    prompt: "Continue the conversation interactively!",
  });

  console.log("\n=== Phase 3: TUI Detached (Back to Programmatic) ===");
  console.log(`TUI exited. Tokens used: ${exitInfo1.tokenUsage.totalTokens}`);
  console.log(`History now: ${thread.history.length} messages\n`);

  // Continue programmatically after TUI exit
  console.log("Continuing programmatically after TUI...");
  const result3 = await thread.run("Summarize what we've discussed so far.");
  console.log(`Response 3 (truncated): ${result3.text.slice(0, 80)}...\n`);

  // === Second TUI Attach ===
  console.log("=== Phase 4: Second TUI Attach ===\n");
  console.log("Re-attaching TUI to the same thread...");
  console.log("All history including programmatic messages will be visible.\n");

  const exitInfo2 = await thread.tui({
    prompt: "Let's continue our discussion!",
  });

  console.log("\n=== Phase 5: Complete ===");
  console.log(`Final TUI session exited. Total tokens: ${exitInfo2.tokenUsage.totalTokens}`);
  console.log(`Final history: ${thread.history.length} messages`);
  console.log("\nThis demonstrates seamless attach/detach cycles between");
  console.log("programmatic and interactive modes! 🎉");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
