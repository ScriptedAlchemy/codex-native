import type { SkillDefinition, SkillMentionTrigger } from "./skills";

export type ApprovalMode = "never" | "on-request" | "on-failure" | "untrusted";

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

/**
 * Reasoning effort level for reasoning-capable models (e.g., o1, o3).
 * See https://platform.openai.com/docs/guides/reasoning
 *
 * @default "medium" - When undefined, codex uses "medium" as the default
 */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * Controls whether reasoning summaries are included for reasoning-capable models.
 * See https://platform.openai.com/docs/guides/reasoning#reasoning-summaries
 *
 * @default "auto" - When undefined, codex uses "auto" as the default
 */
export type ReasoningSummary = "auto" | "concise" | "detailed" | "none";

export type WorkspaceWriteOptions = {
  /** Enable network access in workspace-write mode. Default: false */
  networkAccess?: boolean;
  /** Additional directories that should be writable */
  writableRoots?: string[];
  /** Exclude the TMPDIR environment variable from writable roots. Default: false */
  excludeTmpdirEnvVar?: boolean;
  /** Exclude /tmp from writable roots on Unix. Default: false */
  excludeSlashTmp?: boolean;
};

// ============================================================================
// MCP Server Configuration Types
// ============================================================================

/**
 * Configuration for an MCP server using stdio transport.
 * The server is spawned as a child process.
 */
export type McpStdioTransport = {
  /** The command to run (e.g., "npx", "python") */
  command: string;
  /** Command arguments */
  args?: string[];
  /** Environment variables to set for the process */
  env?: Record<string, string>;
  /** Environment variable names to inherit from the parent process */
  envVars?: string[];
  /** Working directory for the process */
  cwd?: string;
};

/**
 * Configuration for an MCP server using HTTP transport.
 */
export type McpHttpTransport = {
  /** The URL of the MCP server endpoint */
  url: string;
  /** Environment variable name containing a bearer token for authentication */
  bearerTokenEnvVar?: string;
  /** Static HTTP headers to include in requests */
  httpHeaders?: Record<string, string>;
  /** HTTP headers where the value is read from an environment variable */
  envHttpHeaders?: Record<string, string>;
};

/**
 * Configuration for a single MCP server.
 */
export type McpServerConfig = (McpStdioTransport | McpHttpTransport) & {
  /** When false, skip initializing this MCP server. Default: true */
  enabled?: boolean;
  /** Startup timeout in seconds. Default: server-specific */
  startupTimeoutSec?: number;
  /** Default timeout for tool calls in seconds */
  toolTimeoutSec?: number;
  /** Allow-list of tools to expose from this server */
  enabledTools?: string[];
  /** Deny-list of tools to hide from this server */
  disabledTools?: string[];
};

export type ThreadOptions = {
  model?: string;
  /** Override the model provider declared in config.toml */
  modelProvider?: string;
  /** Use local OSS provider via Ollama (pulls models as needed) */
  oss?: boolean;
  sandboxMode?: SandboxMode;
  /** Approval policy for command execution */
  approvalMode?: ApprovalMode;
  /** Options for workspace-write sandbox mode */
  workspaceWriteOptions?: WorkspaceWriteOptions;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  /** Reasoning effort level (only honored for reasoning-capable models). Defaults to "medium" when undefined. */
  reasoningEffort?: ReasoningEffort;
  /** Reasoning summary preference (only honored for reasoning-capable models). Defaults to "auto" when undefined. */
  reasoningSummary?: ReasoningSummary;
  /** @deprecated Use sandboxMode and approvalMode instead */
  fullAuto?: boolean;
  /**
   * Programmatically registered skills (no SKILL.md files required) for this thread.
   * These augment any skills registered on the parent Codex instance.
   */
  skills?: SkillDefinition[] | Record<string, string | Omit<SkillDefinition, "name">>;
  /**
   * Prefixes that activate skills when present immediately before the skill name.
   *
   * Defaults to `["$"]` when omitted.
   */
  skillMentionTriggers?: SkillMentionTrigger[];
  /**
   * MCP servers to register for this thread.
   * Keys are server names, values are server configurations.
   *
   * Example:
   * ```ts
   * mcp: {
   *   "github": { url: "https://api.github.com/mcp", bearerTokenEnvVar: "GITHUB_TOKEN" },
   *   "local-tool": { command: "npx", args: ["-y", "my-mcp-server"] }
   * }
   * ```
   */
  mcp?: Record<string, McpServerConfig>;
  /**
   * When false, ignores globally registered MCP servers from config.toml
   * and only uses the servers specified in the `mcp` option.
   * When true (default), merges the `mcp` option with global config.
   *
   * @default true
   */
  inheritMcp?: boolean;
};
