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
};
