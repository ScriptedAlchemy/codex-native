/**
 * Example: Use CodexProvider for a single execution run
 *
 * This demonstrates how to create and use a Codex provider for a specific
 * operation without registering it globally.
 *
 * CodexProvider capabilities:
 * - Multi-modal inputs (text and images)
 * - Streaming deltas for real-time response updates
 * - Automatic tool registration
 * - Local file path, URL, and base64 image support
 *
 * Usage:
 * ```bash
 * npx tsx examples/codex-provider-run.ts
 * ```
 */

import { Agent, run } from '@openai/agents';
import { CodexProvider } from '../../src/index';

async function main() {
  // Create a provider instance for this specific run (no API key needed)
  const provider = new CodexProvider({
    defaultModel: 'gpt-5-codex',
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
  });

  const codexModel = await provider.getModel();

  // Create an agent configured for this specific run
  const agent = new Agent({
    name: 'TaskSpecificAgent',
    model: codexModel,
    instructions:
      'You are a helpful assistant. Answer questions directly and concisely in 1-2 sentences.',
  });

  // Run the agent once with the model obtained from the provider
  const result = await run(agent, 'What is 2+2? Answer with just the number.');

  console.log('Result:');
  console.log(result.finalOutput);
}

main()
  .then(() => {
    console.log('\nMain completed successfully.');
    // Force exit after completion - native bindings may keep handles open
    // Using setTimeout to ensure output is flushed before exit
    setTimeout(() => process.exit(0), 100);
  })
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
