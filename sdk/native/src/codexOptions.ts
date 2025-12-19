import type { NativeToolInfo, NativeToolInvocation, NativeToolResult } from "./nativeBinding";
import type { SkillDefinition, SkillMentionTrigger } from "./skills";

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
};
