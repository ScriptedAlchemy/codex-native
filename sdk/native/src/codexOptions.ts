import type { NativeToolInfo, NativeToolInvocation, NativeToolResult } from "./nativeBinding";
import type { SkillDefinition, SkillMentionTrigger } from "./skills";
import type { McpServerConfig } from "./threadOptions";

export type NativeToolDefinition = NativeToolInfo & {
  handler: (call: NativeToolInvocation) => Promise<NativeToolResult> | NativeToolResult;
};

export type CodexOptions = {
  codexPathOverride?: string;
  baseUrl?: string;
  apiKey?: string;
  /** Optional model provider override to use instead of the default */
  modelProvider?: string;
  /** Default model to use when a thread omits an explicit choice */
  defaultModel?: string;
  tools?: NativeToolDefinition[];
  /**
   * When true, constructor will not clear already-registered tools on the native binding.
   * Useful when other code (CLI, plugins) pre-register tools before instantiating Codex.
   */
  preserveRegisteredTools?: boolean;
  /**
   * Programmatically registered skills (no SKILL.md files required).
   *
   * Mention a skill by name in prompts using `$<name>` (default) or `@<name>` if enabled.
   */
  skills?: SkillDefinition[] | Record<string, string | Omit<SkillDefinition, "name">>;
  /**
   * Prefixes that activate skills when present immediately before the skill name.
   *
   * Defaults to `["$"]` to match Codex CLI/TUI behavior.
   */
  skillMentionTriggers?: SkillMentionTrigger[];
  /**
   * Default MCP servers to register for all threads created by this Codex instance.
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
