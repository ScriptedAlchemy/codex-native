import type { Usage } from "../events";

/**
 * Log level enumeration
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

/**
 * Log scopes for different subsystems
 */
export type LogScope =
  | "thread"
  | "merge"
  | "git"
  | "coordinator"
  | "worker"
  | "supervisor"
  | "reviewer"
  | "validation"
  | "lsp"
  | "agent"
  | "provider"
  | "ci"
  | "test"
  | "system";

/**
 * Configuration for logger instances
 */
export interface LoggerConfig {
  /** Minimum log level to output */
  level?: LogLevel;
  /** Enable colored output (default: true for TTY) */
  colors?: boolean;
  /** Include timestamps in output (default: false) */
  timestamps?: boolean;
  /** Prefix for all log messages */
  prefix?: string;
  /** Enable structured JSON output instead of formatted text */
  json?: boolean;
  /** Custom output stream (default: console) */
  output?: LogOutput;
}

/**
 * Output interface for log messages
 */
export interface LogOutput {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Thread logging sink interface
 */
export interface ThreadLoggingSink {
  info(message: string): void;
  warn(message: string): void;
  recordUsage?(usage: Usage): void;
}

/**
 * Structured log entry for JSON output
 */
export interface LogEntry {
  timestamp: string;
  level: string;
  scope?: string;
  subject?: string;
  message: string;
  data?: Record<string, unknown>;
}
