import * as process from "node:process";
import { pathToFileURL } from "node:url";
import { CONFIG } from "./constants.js";
import { MultiAgentOrchestrator } from "./orchestrator.js";
import type { MultiAgentConfig } from "./types.js";

async function main(): Promise<void> {
  const config: MultiAgentConfig = { ...CONFIG };
  if (config.interactive && (!process.stdout.isTTY || !process.stdin.isTTY)) {
    console.error("❌ Interactive mode requires a TTY terminal.");
    process.exit(1);
  }
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
