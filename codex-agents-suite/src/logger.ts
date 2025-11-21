/**
 * Re-export unified logging from SDK
 * This maintains backward compatibility while using the centralized logging system
 */
export { logger, Logger, LogLevel } from "@codex-native/sdk";
export type { LogScope } from "@codex-native/sdk";

/**
 * Helper functions for backward compatibility with label-based logging
 */
import { logger as defaultLogger } from "@codex-native/sdk";
import type { LogScope } from "@codex-native/sdk";

// Map legacy labels to scopes - labels are treated as agent/system scopes
function labelToScope(label: string): LogScope {
  const lowerLabel = label.toLowerCase();

  // Map known labels to scopes
  if (lowerLabel.includes("coordinator")) return "coordinator";
  if (lowerLabel.includes("reviewer")) return "reviewer";
  if (lowerLabel.includes("worker")) return "worker";
  if (lowerLabel.includes("supervisor")) return "supervisor";
  if (lowerLabel.includes("agent")) return "agent";
  if (lowerLabel.includes("ci")) return "ci";
  if (lowerLabel.includes("test")) return "test";
  if (lowerLabel.includes("lsp")) return "lsp";

  // Default to system scope
  return "system";
}

export function logWithLabel(label: string, message: string): void {
  const scope = labelToScope(label);
  const scopedLogger = defaultLogger.scope(scope, label);
  scopedLogger.info(message);
}

export function warnWithLabel(label: string, message: string): void {
  const scope = labelToScope(label);
  const scopedLogger = defaultLogger.scope(scope, label);
  scopedLogger.warn(message);
}

export function errorWithLabel(label: string, message: string): void {
  const scope = labelToScope(label);
  const scopedLogger = defaultLogger.scope(scope, label);
  scopedLogger.error(message);
}

/**
 * Create a labeled logger (returns a scoped logger)
 */
export function createLabeledLogger(label: string) {
  const scope = labelToScope(label);
  return defaultLogger.scope(scope, label);
}
