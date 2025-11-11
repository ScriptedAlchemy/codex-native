import { Codex } from "@codex-native/sdk";

/**
 * Example: Starting an agent programmatically, then transitioning to interactive TUI mode.
 *
 * This demonstrates the workflow where you:
 * 1. Create a Codex instance and start a thread
 * 2. Do some programmatic work (e.g., automated analysis)
 * 3. Transition to interactive TUI mode to continue chatting with the same agent session
 */
async function main(): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.warn(
      "This example requires an interactive terminal (TTY). Run from a terminal session."
    );
    return;
  }

  console.log("=== Phase 1: Programmatic Interaction ===\n");

  const codex = new Codex();
  const thread = codex.startThread({
    sandboxMode: "workspace-write",
    approvalMode: "on-request",
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
  });

  // Do some automated work first
  console.log("Running initial analysis...");
  const result = await thread.run("List the files in the current directory and summarize the project structure.");

  console.log("\nAgent Response:");
  console.log(result.finalResponse);
  console.log("\nToken Usage:", result.usage);
  console.log("Thread ID:", thread.id);

  console.log("\n=== Phase 2: Switching to Interactive TUI Mode ===\n");
  console.log("Launching TUI to continue chatting with the same agent...");
  console.log("Press Ctrl+C in the TUI to exit.\n");

  // Wait a moment so user can read the message
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Now hand over to the interactive TUI - same session continues!
  const exitInfo = await thread.tui();

  console.log("\n=== TUI Session Ended ===");
  console.log("Conversation ID:", exitInfo.conversationId ?? "<none>");
  console.log("Total Token Usage:", exitInfo.tokenUsage);

  if (exitInfo.updateAction) {
    console.log("Suggested follow-up:", exitInfo.updateAction);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exitCode = 1;
});
