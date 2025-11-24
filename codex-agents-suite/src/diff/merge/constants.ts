import type { ApprovalMode, SandboxMode } from "@codex-native/sdk";

export const DEFAULT_COORDINATOR_MODEL = "gpt-5.1-codex-max";
export const DEFAULT_WORKER_MODEL = "gpt-5.1-codex-max";
export const DEFAULT_REVIEWER_MODEL = "gpt-5.1-codex-max";
export const DEFAULT_SANDBOX_MODE: SandboxMode = "workspace-write";
export const DEFAULT_APPROVAL_MODE: ApprovalMode = "on-request";
export const MAX_CONTEXT_CHARS = 5000;
export const CI_LOG_CONTEXT_LIMIT = 15000;
export const CI_OVERFLOW_SUMMARY_MAX_TOKENS = 100_000;
export const CI_OVERFLOW_SUMMARY_CHARS_PER_TOKEN = 4;
export const CI_OVERFLOW_SUMMARY_CHAR_LIMIT =
  CI_OVERFLOW_SUMMARY_MAX_TOKENS * CI_OVERFLOW_SUMMARY_CHARS_PER_TOKEN;

export const SUPERVISOR_OUTPUT_SCHEMA = {
  name: "merge_conflict_approval_decision",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      decision: { type: "string", enum: ["approve", "deny"] },
      reason: { type: "string", minLength: 4 },
      corrective_actions: {
        type: "array",
        items: { type: "string", minLength: 4 },
      },
    },
    required: ["decision", "reason"],
  },
};

export const HISTORICAL_PLAYBOOK = `Session 019a8536-2265-7353-8669-7451ddaa2855 surfaced the following merge heuristics:
- Inspect each conflicting file to understand what our branch changed versus upstream before editing anything.
- Keep merges minimally invasive when replaying them; prefer integrating upstream intent instead of rewriting our local work.
- If sdk/typescript changes ripple through platform bindings, mirror the necessary adjustments in sdk/native during the same pass.
- Preserve intentional resource/size increases (buffers, limits, etc.) that we previously raised unless upstream explicitly supersedes them.
- Announce resolved files so parallel agents know which conflicts remain and what decisions were made.
- After conflicts are resolved, run pnpm install, pnpm build, and pnpm run ci (or at least outline how/when those checks will run).`;

export const CI_SNIPPET_KEYWORDS = /\b(fail(?:ed)?|error|panic|pass(?:ed)?|ok)\b/i;
export const CI_SNIPPET_CONTEXT_LINES = 2;
export const CI_SNIPPET_MAX_SECTIONS = 5;
