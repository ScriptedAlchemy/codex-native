/**
 * Centralized Agent Registry for Merge Solver
 *
 * Uses @openai/agents SDK with CodexProvider for:
 * - Coordinator Agent: Plans global merge strategy
 * - Worker Agents: Handle individual conflict resolution
 */

export * from "./coordinator-agent.js";
export * from "./worker-agent.js";
export * from "./workflow-orchestrator.js";
export * from "./types.js";
export { convertToAgentConfig } from "./adapter.js";
