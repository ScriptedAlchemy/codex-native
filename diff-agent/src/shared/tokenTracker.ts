import type { Usage } from "@codex-native/sdk";

// Model context limits (tokens)
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "gpt-5.1-codex": 200_000,
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "claude-sonnet-4-5": 200_000,
  "claude-sonnet-3-5": 200_000,
  "default": 128_000,
};

// Fork/handoff when we reach this percentage of context limit
const FORK_THRESHOLD = 0.6; // 60%
const HANDOFF_THRESHOLD = 0.75; // 75%

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
   */
  contextLimit(): number {
    const model = this.modelName ?? "default";
    return MODEL_CONTEXT_LIMITS[model] ?? MODEL_CONTEXT_LIMITS.default;
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
