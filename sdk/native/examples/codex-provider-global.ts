/**
 * Example: Reuse a shared Codex model across multiple runs
 *
 * This demonstrates how to create a CodexProvider once and reuse
 * the same model instance across multiple agents and queries.
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

import { Agent, run } from '@openai/agents';
import { CodexProvider } from '../src/index.js';

async function main() {
  // Create a shared Codex provider (no API key needed)
  const codexProvider = new CodexProvider({
    defaultModel: 'gpt-5',
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
  });

  // Get the model once and reuse it across multiple agents
  const model = await codexProvider.getModel();

  // Create an agent with the Codex model
  const agent = new Agent({
    name: 'SharedCodexAgent',
    model: model,
    instructions: 'You are a helpful assistant powered by Codex. You support text and image inputs.',
  });

  // Run multiple queries
  console.log('Query 1:');
  const result1 = await run(agent, 'What is 2+2?');
  console.log(result1.finalOutput);

  console.log('\nQuery 2:');
  const result2 = await run(agent, 'What is the largest planet in our solar system?');
  console.log(result2.finalOutput);
}

main()
  .then(() => {
    // Force exit after completion to avoid hanging
    process.exit(0);
  })
  .catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
