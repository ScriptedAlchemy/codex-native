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
import { CodexProvider } from '../src/index.js';

async function main() {
  // Create a provider instance for this specific run (no API key needed)
  const provider = new CodexProvider({
    defaultModel: 'gpt-5',
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
  });

  const codexModel = await provider.getModel();

  // Create an agent configured for this specific run
  const agent = new Agent({
    name: 'TaskSpecificAgent',
    model: codexModel,
    instructions:
      'You are a helpful assistant that answers questions concisely using GPT-5 via Codex. You support both text and image inputs.',
  });

  // Run the agent once with the model obtained from the provider
  const result = await run(agent, 'Explain what Codex Native SDK does');

  console.log('Result:');
  console.log(result.finalOutput);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
