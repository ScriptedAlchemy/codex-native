import type { ThreadLoggingSink } from "../threadLogging.js";

export type LogScope =
  | "merge"
  | "git"
  | "coordinator"
  | "worker"
  | "supervisor"
  | "reviewer"
  | "validation";

const LOG_SCOPE_COLORS: Record<LogScope, string> = {
  merge: "\x1b[35m",
  git: "\x1b[34m",
  coordinator: "\x1b[36m",
  worker: "\x1b[33m",
  supervisor: "\x1b[95m",
  reviewer: "\x1b[32m",
  validation: "\x1b[92m",
};

function formatScope(scope: LogScope, subject?: string): string {
  const color = LOG_SCOPE_COLORS[scope] ?? "";
  const reset = "\x1b[0m";
  const label = subject ? `${scope}:${subject}` : scope;
  return `${color}[merge-solver:${label}]${reset}`;
}

export function logInfo(scope: LogScope, message: string, subject?: string): void {
  console.log(`${formatScope(scope, subject)} ${message}`);
}

export function logWarn(scope: LogScope, message: string, subject?: string): void {
  console.warn(`${formatScope(scope, subject)} ${message}`);
}

export function logError(scope: LogScope, message: string, subject?: string): void {
  console.error(`${formatScope(scope, subject)} ${message}`);
}

export function createThreadLogger(scope: LogScope, subject?: string): ThreadLoggingSink {
  return {
    info: (message) => logInfo(scope, message, subject),
    warn: (message) => logWarn(scope, message, subject),
  };
}
