/**
 * OpenAI Agents framework integration for Codex
 *
 * This module provides a ModelProvider implementation that allows using Codex
 * as the backend for the OpenAI Agents JS framework.
 *
 * @example
 * ```typescript
 * import { CodexProvider } from '@openai/codex-native/agents';
 * import { Agent, Runner } from '@openai/agents';
 *
 * const provider = new CodexProvider({
 *   apiKey: process.env.CODEX_API_KEY,
 *   defaultModel: 'claude-sonnet-4.5'
 * });
 *
 * const agent = new Agent({
 *   name: 'CodeAssistant',
 *   instructions: 'You are a helpful coding assistant'
 * });
 *
 * const runner = new Runner({ modelProvider: provider });
 * const result = await runner.run(agent, 'Fix the failing tests');
 * console.log(result.finalOutput);
 * ```
 *
 * @module agents
 */

export { CodexProvider } from "./CodexProvider";
export type { CodexProviderOptions } from "./CodexProvider";

// Re-export types for convenience
export type {
  ModelProvider,
  Model,
  ModelRequest,
  ModelResponse,
  StreamEvent,
  AgentInputItem,
  AgentOutputItem,
  Usage,
  ModelSettings,
} from "./types";
