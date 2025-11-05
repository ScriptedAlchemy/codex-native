/**
 * Example: Configure Codex as a global model provider
 *
 * This demonstrates how to set up Codex as a globally available provider
 * that can be used across multiple agents and runs.
 *
 * CodexProvider features:
 * - Multi-modal input support (text + images)
 * - Streaming response deltas for real-time updates
 * - Automatic tool registration when passed to agents
 * - Thread continuity across multiple agent runs
 *
 * Usage:
 * ```bash
 * npx tsx examples/codex-provider-global.ts
 * ```
 */

import { Agent, run, registerProvider } from '@openai/agents';
import { CodexProvider } from '../src/index.js';

async function main() {
  // Register Codex as a global provider (no API key needed)
  const codexProvider = new CodexProvider({
    defaultModel: 'claude-sonnet-4-5',
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
  });

  registerProvider('codex', codexProvider);

  // Now you can create agents that use 'codex' as their provider
  const agent = new Agent({
    name: 'GlobalCodexAgent',
    instructions: 'You are a helpful assistant powered by Codex. You support text and image inputs.',
    // No model specified - will use the globally registered provider
  });

  // Run multiple queries
  console.log('Query 1:');
  const result1 = await run(agent, 'What is 2+2?');
  console.log(result1.finalOutput);

  console.log('\nQuery 2:');
  const result2 = await run(agent, 'What is the largest planet in our solar system?');
  console.log(result2.finalOutput);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
