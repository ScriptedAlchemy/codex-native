import type { Usage } from "@codex-native/sdk";

export class TokenTracker {
  private input = 0;
  private cached = 0;
  private output = 0;

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
}
