import { Codex } from "../../src/index";
import type { CommandExecutionItem, ThreadItem } from "../../src/index";

/**
 * Diagnostic script that asks Codex to run GitHub CLI commands inside a dangerous sandbox.
 *
 * Usage:
 *   pnpm exec tsx sdk/native/examples/diagnostics/gh-network-check.ts
 *
 * Environment:
 *   - Requires CODEX_API_KEY (or ~/.codex session) so Codex can connect to the cloud service.
 *   - Optional GH_DIAG_COMMAND to override the network command (defaults to `gh api https://api.github.com/rate_limit`).
 */
async function main() {
  const codex = new Codex();
  const thread = codex.startThread({
    sandboxMode: "danger-full-access",
    skipGitRepoCheck: true,
  });

  const ghCommand = process.env.GH_DIAG_COMMAND ?? "gh api https://api.github.com/rate_limit";
  const prompt = [
    "You are a diagnostics assistant.",
    "1. Run `gh --version` to confirm the GitHub CLI is available.",
    `2. Run \\"${ghCommand}\\" to confirm outgoing TLS requests succeed.`,
    "Return the captured stdout/stderr for each command and summarize the results.",
  ].join("\n");

  console.log("🚑  Running Codex network diagnostics...\n");
  const turn = await thread.run(prompt);

  logCommandItems(turn.items);

  console.log("\n📋 Agent summary:\n");
  console.log(turn.finalResponse.trim() || "(agent did not return a final response)");
}

function logCommandItems(items: ThreadItem[]) {
  const commands = items.filter((item): item is CommandExecutionItem => item.type === "command_execution");

  if (commands.length === 0) {
    console.log("No command executions were recorded.");
    return;
  }

  for (const item of commands) {
    console.log("\n══════════════════════════════════════════════════════════");
    console.log(`⚙️  Command: ${item.command}`);
    console.log(`Status : ${item.status}${item.exit_code !== undefined ? ` (exit ${item.exit_code})` : ""}`);
    if (item.aggregated_output?.trim()) {
      console.log("Output :");
      console.log(item.aggregated_output.trim());
    } else {
      console.log("Output : (no stdout/stderr captured)");
    }
  }
}

void main().catch((error) => {
  console.error("Fatal error while running diagnostics:", error);
  process.exit(1);
});
