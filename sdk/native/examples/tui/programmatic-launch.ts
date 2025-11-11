import { runTui, type NativeTuiRequest } from "@codex-native/sdk";

async function main(): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.warn(
      "Codex TUI requires an interactive terminal (TTY). Run this example from a terminal, or use `codex-native run` for headless execution.",
    );
    return;
  }

  const prompt = process.argv.slice(2).join(" ") || "Review the latest git changes and summarise next steps.";

  const request: NativeTuiRequest = {
    prompt,
    resumePicker: false,
    fullAuto: false,
    workingDirectory: process.cwd(),
    sandboxMode: "workspace-write",
    approvalMode: "on-request",
  };

  console.log("Launching Codex TUI... (press Ctrl+C to exit)\n");
  const exitInfo = await runTui(request);

  console.log("\nTUI session exited.");
  console.log("Conversation ID:", exitInfo.conversationId ?? "<none>");
  console.log("Token usage:", exitInfo.tokenUsage);
  if (exitInfo.updateAction) {
    console.log("Suggested follow-up action:", exitInfo.updateAction);
  }
}

main().catch((error) => {
  console.error("Failed to launch Codex TUI:", error);
  process.exitCode = 1;
});
