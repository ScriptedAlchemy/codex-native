import type { Usage } from "@codex-native/sdk";

// Model context limits (tokens)
// Source: codex-rs/core/src/openai_model_info.rs
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // GPT-5/Codex models - 272K context window
  "gpt-5.1-codex": 272_000,
  "gpt-5-codex": 272_000,
  "codex-latest": 272_000,
  "codex-mini-latest": 200_000,

  // O-series models
  "o3": 200_000,
  "o4-mini": 200_000,

  // GPT-4 models
  "gpt-4.1": 1_047_576, // ~1M tokens!
  "gpt-4o": 128_000,
  "gpt-4o-2024-08-06": 128_000,
  "gpt-4o-2024-11-20": 128_000,
  "gpt-4o-mini": 128_000,

  // Claude models
  "claude-sonnet-4-5": 200_000,
  "claude-sonnet-3-5": 200_000,

  // Default fallback
  "default": 128_000,
};

// Fork/handoff thresholds (aligned with codex-rs auto_compact_token_limit)
// Backend uses 90% for auto-compact: (context_window * 9) / 10
const FORK_THRESHOLD = 0.70; // 70% - start considering fork
const HANDOFF_THRESHOLD = 0.85; // 85% - urgently fork/handoff (before 90% auto-compact)

export class TokenTracker {
  private input = 0;
  private cached = 0;
  private output = 0;
  private modelName?: string;

  constructor(modelName?: string) {
    this.modelName = modelName;
  }

  record(usage?: Usage | null): void {
    if (!usage) {
      return;
    }
    this.input += usage.input_tokens ?? 0;
    this.cached += usage.cached_input_tokens ?? 0;
    this.output += usage.output_tokens ?? 0;
  }

  summary(): string {
    return `input=${this.input} cached=${this.cached} output=${this.output}`;
  }

  totals(): { input: number; cached: number; output: number } {
    return { input: this.input, cached: this.cached, output: this.output };
  }

  /**
   * Get current total token usage (input + output)
   */
  currentUsage(): number {
    return this.input + this.output;
  }

  /**
   * Get context limit for the current model
   * Matches exact names first, then tries prefix matching (like codex-rs does)
   */
  contextLimit(): number {
    const model = this.modelName ?? "default";

    // Try exact match first
    if (MODEL_CONTEXT_LIMITS[model]) {
      return MODEL_CONTEXT_LIMITS[model];
    }

    // Try prefix matching (aligned with codex-rs logic)
    if (model.startsWith("gpt-5.1-codex") || model.startsWith("gpt-5-codex")) {
      return 272_000;
    }
    if (model.startsWith("gpt-5")) {
      return 272_000;
    }
    if (model.startsWith("codex-")) {
      return 272_000;
    }
    if (model.startsWith("gpt-4o")) {
      return 128_000;
    }
    if (model.startsWith("claude-sonnet")) {
      return 200_000;
    }

    // Default fallback
    return MODEL_CONTEXT_LIMITS.default;
  }

  /**
   * Check if we should fork to a new thread to avoid context limit
   */
  shouldFork(): boolean {
    const usage = this.currentUsage();
    const limit = this.contextLimit();
    const percentage = usage / limit;
    return percentage >= FORK_THRESHOLD;
  }

  /**
   * Check if we should hand off to a new agent (more urgent than fork)
   */
  shouldHandoff(): boolean {
    const usage = this.currentUsage();
    const limit = this.contextLimit();
    const percentage = usage / limit;
    return percentage >= HANDOFF_THRESHOLD;
  }

  /**
   * Get usage percentage (0.0 to 1.0)
   */
  usagePercentage(): number {
    return this.currentUsage() / this.contextLimit();
  }

  /**
   * Get remaining tokens before hitting limit
   */
  remainingTokens(): number {
    return Math.max(0, this.contextLimit() - this.currentUsage());
  }
}
