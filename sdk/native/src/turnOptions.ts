export type TurnOptions = {
  /** JSON schema describing the expected agent output. */
  outputSchema?: unknown;
  /** Whether to use OSS mode with Ollama models */
  oss?: boolean;
};
