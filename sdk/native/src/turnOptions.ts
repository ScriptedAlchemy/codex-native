export type TurnOptions = {
  /** JSON schema describing the expected agent output. */
  outputSchema?: unknown;
  /** Whether to use OSS mode with Ollama models */
  oss?: boolean;
  /** Override the model provider for this specific turn. */
  modelProvider?: string;
  /** Optional tool choice override (passed through to the provider payload). */
  toolChoice?: unknown;
};
