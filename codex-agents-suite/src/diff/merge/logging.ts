/**
 * Re-export unified logging from SDK
 * This maintains backward compatibility while using the centralized logging system
 */
export { logger, LogLevel } from "@codex-native/sdk";
export type { LogScope, ThreadLoggingSink } from "@codex-native/sdk";

/**
 * Helper to create a scoped logger (backward compatibility)
 */
import { logger as defaultLogger } from "@codex-native/sdk";
import type { LogScope } from "@codex-native/sdk";

export function logInfo(scope: LogScope, message: string, subject?: string): void {
  const scopedLogger = defaultLogger.scope(scope, subject);
  scopedLogger.info(message);
}

export function logWarn(scope: LogScope, message: string, subject?: string): void {
  const scopedLogger = defaultLogger.scope(scope, subject);
  scopedLogger.warn(message);
}

export function logError(scope: LogScope, message: string, subject?: string): void {
  const scopedLogger = defaultLogger.scope(scope, subject);
  scopedLogger.error(message);
}

export function createThreadLogger(scope: LogScope, subject?: string) {
  const scopedLogger = defaultLogger.scope(scope, subject);
  return scopedLogger.asThreadSink();
}
