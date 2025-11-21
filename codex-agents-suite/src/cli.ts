import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { CONFIG } from "./constants.js";
import { MultiAgentOrchestrator } from "./orchestrator.js";
import { loadDiffEnvironment, describeDiffEnvironment } from "./diff/shared/environment.js";
import { runEnhancedCiOrchestrator } from "./diff/ci/enhanced-ci-orchestrator.js";
import { MergeConflictSolver, createDefaultSolverConfig } from "./diff/merge-conflict-solver.js";
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

type EntryOption = {
  label: string;
  description: string;
  action: () => Promise<void>;
};

function buildOptions(config: MultiAgentConfig): EntryOption[] {
  const diffEnv = loadDiffEnvironment();
  return [
    {
      label: "Review & CI Orchestrator",
      description: "Run the full multi-agent workflow (review, CI triage, reverie, fixer).",
      action: async () => {
        const orchestrator = new MultiAgentOrchestrator(config);
        await orchestrator.runWorkflow();
      },
    },
    {
      label: "Diff Reviewer",
      description: `Inspect repository changes with structured diff analysis. (${describeDiffEnvironment(diffEnv)})`,
      action: async () => {
        const { runDiffReview } = await import("./diff/index.js");
        await runDiffReview();
      },
    },
    {
      label: "Merge Conflict Solver",
      description: "Launch the autonomous merge workflow for the current repository.",
      action: async () => {
        const cwd = process.cwd();
        const solver = new MergeConflictSolver(createDefaultSolverConfig(cwd));
        await solver.run();
      },
    },
    {
      label: "CI Auto-Fix Orchestrator",
      description: "Run iterative CI triage with automatic fix agents.",
      action: async () => {
        await runEnhancedCiOrchestrator(process.cwd(), { visualize: true, autoFix: true, maxIterations: 5 });
      },
    },
  ];
}

async function promptForOption(options: EntryOption[]): Promise<EntryOption> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    return options[0];
  }

  console.log("\nCodex Agents Suite");
  console.log("──────────────────\n");
  options.forEach((option, index) => {
    const number = index + 1;
    console.log(`${number}. ${option.label}`);
    console.log(`   ${option.description}\n`);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer: string = await new Promise((resolve) => {
      rl.question("Select an option (1-" + options.length + "): ", resolve);
    });
    const index = Number.parseInt(answer.trim(), 10) - 1;
    if (Number.isNaN(index) || index < 0 || index >= options.length) {
      console.log("Invalid selection; defaulting to option 1.");
      return options[0];
    }
    return options[index];
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const config: MultiAgentConfig = { ...CONFIG };
  installSignalHandlers();
  const options = buildOptions(config);
  const choice = await promptForOption(options);
  await choice.action();
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
