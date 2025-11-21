import type { SolverConfig } from "../merge/types.js";

export type CiRunnerConfig = SolverConfig & {
  ciCommand?: string[];
  maxIterations?: number;
};

export type CiStageStatus = "pending" | "in_progress" | "completed";
