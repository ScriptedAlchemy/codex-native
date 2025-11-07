"use strict";
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
 *   defaultModel: 'gpt-5'
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodexProvider = void 0;
var CodexProvider_1 = require("./CodexProvider");
Object.defineProperty(exports, "CodexProvider", { enumerable: true, get: function () { return CodexProvider_1.CodexProvider; } });
