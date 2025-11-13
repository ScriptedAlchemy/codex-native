/**
 * Example: Fork a conversation at an earlier user message.
 *
 * 1. Start a thread and run a couple of turns programmatically.
 * 2. Fork before the second user message to explore an alternate plan.
 * 3. Continue both the original and forked threads independently.
 *
 * Usage:
 *   npx tsx sdk/native/examples/fork-thread.ts
 */

import { Codex } from "@codex-native/sdk";

async function main() {
  const codex = new Codex();

  const thread = codex.startThread({
    model: "gpt-5-codex-mini",
    sandboxMode: "workspace-write",
    approvalMode: "on-request",
    skipGitRepoCheck: true,
  });

  console.log(`Original thread id: ${thread.id ?? "(pending)"}`);

  await thread.run("List flaky integration tests in this repository.");
  await thread.run("Prioritize them from highest to lowest impact.");

  const forked = await thread.fork({
    nthUserMessage: 1, // Fork before the second user message (0-based index)
    threadOptions: {
      model: "gpt-5-codex",
    },
  });

  console.log(`Forked thread id: ${forked.id}`);

  const originalTurn = await thread.run("Summarize the remediation plan we agreed on.");
  console.log(`Original thread summary:\n${originalTurn.finalResponse}\n`);

  const forkedTurn = await forked.run(
    "Instead, focus only on flaky tests in the payment suite and propose targeted fixes.",
  );
  console.log(`Forked thread focus:\n${forkedTurn.finalResponse}`);
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

