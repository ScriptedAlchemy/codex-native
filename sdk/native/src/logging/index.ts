/**
 * Unified logging system for Codex SDK and consuming packages
 *
 * This module provides:
 * - Scoped logging with colors and customizable output
 * - Thread event logging for Codex threads
 * - Structured JSON logging support
 * - Configurable log levels
 * - Environment variable configuration
 *
 * @example Basic usage
 * ```ts
 * import { logger } from '@codex-native/sdk';
 *
 * logger.info('Application started');
 * logger.warn('Something might be wrong');
 * ```
 *
 * @example Scoped logging
 * ```ts
 * import { logger } from '@codex-native/sdk';
 *
 * const ciLogger = logger.scope('ci', 'orchestrator');
 * ciLogger.info('Starting CI run');
 * ciLogger.warn('Tests failed');
 * ```
 *
 * @example Thread logging
 * ```ts
 * import { createThreadLogger, runThreadTurnWithLogs } from '@codex-native/sdk';
 *
 * const threadLogger = logger.scope('worker', 'task-1');
 * const sink = createThreadLogger(threadLogger, (usage) => {
 *   console.log('Token usage:', usage);
 * });
 *
 * await runThreadTurnWithLogs(thread, sink, 'Do something');
 * ```
 *
 * @example Custom configuration
 * ```ts
 * import { Logger, LogLevel } from '@codex-native/sdk';
 *
 * const customLogger = new Logger({
 *   level: LogLevel.DEBUG,
 *   colors: true,
 *   timestamps: true,
 *   json: false,
 * });
 * ```
 *
 * Environment variables:
 * - `CODEX_LOG_LEVEL`: Set log level (DEBUG, INFO, WARN, ERROR, SILENT)
 * - `CODEX_LOG_COLORS`: Enable/disable colors (default: auto-detect TTY)
 * - `CODEX_LOG_TIMESTAMPS`: Enable timestamps (default: false)
 * - `CODEX_LOG_JSON`: Enable JSON output (default: false)
 */

export { Logger, ScopedLogger, logger } from "./logger";
export { createThreadLogger, runThreadTurnWithLogs } from "./threadLogger";
export { LogLevel } from "./types";
export type { LogScope, LoggerConfig, LogOutput, ThreadLoggingSink, LogEntry } from "./types";
