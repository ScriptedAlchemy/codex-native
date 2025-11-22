import type { ApprovalMode, SandboxMode } from "@codex-native/sdk";

export const DEFAULT_COORDINATOR_MODEL = "gpt-5.1-codex";
export const DEFAULT_WORKER_MODEL = "gpt-5.1-codex";
export const DEFAULT_REVIEWER_MODEL = "gpt-5.1-codex";
// Use most permissive modes for Codex to allow full capabilities
export const DEFAULT_SANDBOX_MODE: SandboxMode = "danger-full-access";  // Full system access
export const DEFAULT_APPROVAL_MODE: ApprovalMode = "never";  // Never ask for approval
// Token limits removed - SDK's context manager handles truncation with 250k window
export const CI_LOG_CONTEXT_TOKENS = 40000;  // Token limit for CI logs (still used for CI log checking)
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

export const MERGE_REVIEW_OUTPUT_SCHEMA = {
  name: "merge_review_decision",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      decision: {
        type: "string",
        enum: ["approved", "needs_fixes", "rejected"],
        description: "The review decision for the merge resolution"
      },
      reason: {
        type: "string",
        minLength: 10,
        description: "Brief explanation of the decision"
      },
      feedback: {
        type: "string",
        description: "Specific instructions for fixes (required when decision is needs_fixes)"
      },
      issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            line: { type: "number", description: "Line number if applicable" },
            issue: { type: "string", description: "Description of the issue" },
            fix: { type: "string", description: "How to fix it" }
          },
          required: ["issue", "fix"],
          additionalProperties: false
        },
        description: "List of specific issues found"
      }
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
