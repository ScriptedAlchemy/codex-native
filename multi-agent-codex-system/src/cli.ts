import process from "node:process";
import { pathToFileURL } from "node:url";
import { CONFIG } from "./constants.js";
import { MultiAgentOrchestrator } from "./orchestrator.js";
import type { MultiAgentConfig } from "./types.js";

function installSignalHandlers(): void {
  let exiting = false;

  const handleSignal = (signal: NodeJS.Signals, exitCode: number) => {
    if (exiting) {
      return;
    }
    exiting = true;
    const label = signal === "SIGINT" ? "Ctrl+C" : signal;
    console.log(`\nReceived ${label}; aborting active Codex tasks and exiting...`);
    process.exit(exitCode);
  };

  process.once("SIGINT", () => handleSignal("SIGINT", 130));
  process.once("SIGTERM", () => handleSignal("SIGTERM", 143));
}

async function main(): Promise<void> {
  const config: MultiAgentConfig = { ...CONFIG };
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.error("❌ Interactive mode requires a TTY terminal.");
    process.exit(1);
  }
  installSignalHandlers();
  const orchestrator = new MultiAgentOrchestrator(config);
  await orchestrator.runWorkflow();
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error("💥 Fatal error:", error);
    process.exit(1);
  });
}

export { main };
