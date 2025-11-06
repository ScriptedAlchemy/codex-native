/**
 * Example: Using CodexProvider with OpenAI Agents framework
 *
 * This demonstrates how to create a CodexProvider and use it
 * with the OpenAI Agents framework to run queries.
 *
 * CodexProvider features:
 * - Multi-modal input support (text + images)
 * - Streaming response deltas for real-time updates
 * - Automatic tool registration when passed to agents
 * - No API key required (uses local Codex instance)
 *
 * Usage:
 * ```bash
 * npx tsx examples/codex-provider-global.ts
 * ```
 */

import { Agent, run } from '@openai/agents';
import { CodexProvider } from '../../src/index';

async function main() {
  // Create a shared Codex provider (no API key needed)
  const codexProvider = new CodexProvider({
    defaultModel: 'gpt-5-codex',
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
  });

  // Get the model once and reuse it across multiple agents
  const model = codexProvider.getModel();

  // Create an agent with the Codex model
  const agent = new Agent({
    name: 'SharedCodexAgent',
    model: model,
    instructions: 'You are a helpful assistant powered by Codex. Answer concisely in one sentence.',
  });

  // Run a single query to demonstrate the integration
  console.log('Query:');
  const result = await run(agent, 'What is 2+2?');
  console.log(result.finalOutput);

  console.log('\nQuery completed successfully!');
}

main()
  .then(() => {
    console.log('\nExiting...');
    // Force exit after completion to avoid hanging from native binding
    // Use a small delay to ensure stdout flushes
    setTimeout(() => process.exit(0), 100);
  })
  .catch((error) => {
    console.error('Error:', error);
    setTimeout(() => process.exit(1), 100);
  });

// Fallback timeout in case the native binding hangs
setTimeout(() => {
  console.error('\nERROR: Script timed out after 30 seconds');
  process.exit(124);
}, 30000);
