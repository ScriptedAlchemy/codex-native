import type { LogLevel, LogScope, LoggerConfig, LogOutput, LogEntry, ThreadLoggingSink } from "./types";
import { LogLevel as Level } from "./types";

/**
 * ANSI color codes for different log levels and scopes
 */
const COLORS = {
  reset: "\x1b[0m",
  // Log levels
  debug: "\x1b[90m", // Gray
  info: "\x1b[36m", // Cyan
  warn: "\x1b[33m", // Yellow
  error: "\x1b[31m", // Red
  // Scopes
  thread: "\x1b[94m", // Bright blue
  merge: "\x1b[35m", // Magenta
  git: "\x1b[34m", // Blue
  coordinator: "\x1b[36m", // Cyan
  worker: "\x1b[33m", // Yellow
  supervisor: "\x1b[95m", // Bright magenta
  reviewer: "\x1b[32m", // Green
  validation: "\x1b[92m", // Bright green
  lsp: "\x1b[96m", // Bright cyan
  agent: "\x1b[93m", // Bright yellow
  provider: "\x1b[91m", // Bright red
  ci: "\x1b[35m", // Magenta
  test: "\x1b[32m", // Green
  system: "\x1b[37m", // White
};

/**
 * Default console output
 */
const consoleOutput: LogOutput = {
  debug: (msg) => console.debug(msg),
  info: (msg) => console.log(msg),
  warn: (msg) => console.warn(msg),
  error: (msg) => console.error(msg),
};

/**
 * Centralized logger with support for scopes, levels, and structured output
 */
export class Logger {
  private level: LogLevel;
  private colors: boolean;
  private timestamps: boolean;
  private prefix: string;
  private json: boolean;
  private output: LogOutput;

  constructor(config: LoggerConfig = {}) {
    this.level = config.level ?? Level.INFO;
    this.colors = config.colors ?? (typeof process !== "undefined" && process.stdout?.isTTY === true);
    this.timestamps = config.timestamps ?? false;
    this.prefix = config.prefix ?? "";
    this.json = config.json ?? false;
    this.output = config.output ?? consoleOutput;
  }

  /**
   * Create a new logger with modified configuration
   */
  configure(config: Partial<LoggerConfig>): Logger {
    return new Logger({
      level: config.level ?? this.level,
      colors: config.colors ?? this.colors,
      timestamps: config.timestamps ?? this.timestamps,
      prefix: config.prefix ?? this.prefix,
      json: config.json ?? this.json,
      output: config.output ?? this.output,
    });
  }

  /**
   * Create a scoped logger
   */
  scope(scope: LogScope, subject?: string): ScopedLogger {
    return new ScopedLogger(this, scope, subject);
  }

  /**
   * Log a debug message
   */
  debug(message: string, data?: Record<string, unknown>): void {
    this.log(Level.DEBUG, message, data);
  }

  /**
   * Log an info message
   */
  info(message: string, data?: Record<string, unknown>): void {
    this.log(Level.INFO, message, data);
  }

  /**
   * Log a warning message
   */
  warn(message: string, data?: Record<string, unknown>): void {
    this.log(Level.WARN, message, data);
  }

  /**
   * Log an error message
   */
  error(message: string, data?: Record<string, unknown>): void {
    this.log(Level.ERROR, message, data);
  }

  /**
   * Internal log method
   */
  private log(level: LogLevel, message: string, data?: Record<string, unknown>, scope?: LogScope, subject?: string): void {
    if (level < this.level) {
      return;
    }

    if (this.json) {
      this.logJson(level, message, data, scope, subject);
    } else {
      this.logFormatted(level, message, scope, subject);
    }
  }

  /**
   * Log in JSON format
   */
  private logJson(level: LogLevel, message: string, data?: Record<string, unknown>, scope?: LogScope, subject?: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: Level[level],
      message,
      ...(scope && { scope }),
      ...(subject && { subject }),
      ...(data && { data }),
    };

    const output = JSON.stringify(entry);
    this.output.info(output);
  }

  /**
   * Log in formatted text
   */
  private logFormatted(level: LogLevel, message: string, scope?: LogScope, subject?: string): void {
    const parts: string[] = [];

    // Timestamp
    if (this.timestamps) {
      const ts = new Date().toISOString();
      parts.push(this.colors ? `\x1b[90m[${ts}]\x1b[0m` : `[${ts}]`);
    }

    // Level
    const levelName = Level[level];
    if (this.colors) {
      const color = COLORS[levelName.toLowerCase() as keyof typeof COLORS] ?? COLORS.reset;
      parts.push(`${color}[${levelName}]${COLORS.reset}`);
    } else {
      parts.push(`[${levelName}]`);
    }

    // Scope and subject
    if (scope) {
      const label = subject ? `${scope}:${subject}` : scope;
      if (this.colors) {
        const color = COLORS[scope] ?? COLORS.reset;
        parts.push(`${color}[${label}]${COLORS.reset}`);
      } else {
        parts.push(`[${label}]`);
      }
    }

    // Prefix
    if (this.prefix) {
      parts.push(this.prefix);
    }

    // Message
    parts.push(message);

    const formatted = parts.join(" ");

    // Output based on level
    switch (level) {
      case Level.DEBUG:
        this.output.debug(formatted);
        break;
      case Level.INFO:
        this.output.info(formatted);
        break;
      case Level.WARN:
        this.output.warn(formatted);
        break;
      case Level.ERROR:
        this.output.error(formatted);
        break;
    }
  }

  /**
   * Internal scoped log method (used by ScopedLogger)
   */
  logScoped(level: LogLevel, message: string, scope: LogScope, subject?: string, data?: Record<string, unknown>): void {
    this.log(level, message, data, scope, subject);
  }
}

/**
 * Scoped logger for a specific subsystem
 */
export class ScopedLogger {
  constructor(
    private logger: Logger,
    private scope: LogScope,
    private subject?: string,
  ) {}

  /**
   * Log a debug message
   */
  debug(message: string, data?: Record<string, unknown>): void {
    this.logger.logScoped(Level.DEBUG, message, this.scope, this.subject, data);
  }

  /**
   * Log an info message
   */
  info(message: string, data?: Record<string, unknown>): void {
    this.logger.logScoped(Level.INFO, message, this.scope, this.subject, data);
  }

  /**
   * Log a warning message
   */
  warn(message: string, data?: Record<string, unknown>): void {
    this.logger.logScoped(Level.WARN, message, this.scope, this.subject, data);
  }

  /**
   * Log an error message
   */
  error(message: string, data?: Record<string, unknown>): void {
    this.logger.logScoped(Level.ERROR, message, this.scope, this.subject, data);
  }

  /**
   * Create a ThreadLoggingSink adapter
   */
  asThreadSink(): ThreadLoggingSink {
    return {
      info: (message: string) => this.info(message),
      warn: (message: string) => this.warn(message),
    };
  }
}

/**
 * Global default logger instance
 */
export const logger = new Logger({
  level: process.env.CODEX_LOG_LEVEL
    ? (Level[process.env.CODEX_LOG_LEVEL as keyof typeof Level] ?? Level.INFO)
    : Level.INFO,
  colors: process.env.CODEX_LOG_COLORS !== "false",
  timestamps: process.env.CODEX_LOG_TIMESTAMPS === "true",
  json: process.env.CODEX_LOG_JSON === "true",
});
