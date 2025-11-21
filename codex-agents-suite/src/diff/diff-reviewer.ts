import process from "node:process";

import { logger } from "@codex-native/sdk";

import { runEnhancedCiOrchestrator } from "./ci/enhanced-ci-orchestrator.js";
import { describeDiffEnvironment, loadDiffEnvironment } from "./shared/environment.js";
import { MergeConflictSolver, createDefaultSolverConfig } from "./merge-conflict-solver.js";

const LOG_LABEL = "[AgentsSuite]";
const log = logger.scope("reviewer");

export async function runDiffReview(args: string[] = process.argv.slice(2)): Promise<void> {
  const env = loadDiffEnvironment();
  log.info(`${LOG_LABEL} Environment: ${describeDiffEnvironment(env)}`);

  if (args.includes("--merge")) {
    const solver = new MergeConflictSolver(createDefaultSolverConfig(process.cwd()));
    await solver.run();
    return;
  }

  if (args.includes("--ci")) {
    await runEnhancedCiOrchestrator(process.cwd(), {
      visualize: true,
      autoFix: true,
      maxIterations: 5,
    });
    return;
  }

  log.info(
    `${LOG_LABEL} Diff reviewer entry point is available. Run the merged suite workflows (review/merge/ci) via the CLI menu or dedicated scripts.`,
  );
}

export async function main(): Promise<void> {
  await runDiffReview();
}
