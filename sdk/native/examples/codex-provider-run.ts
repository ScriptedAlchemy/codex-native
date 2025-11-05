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

  // Create an agent (without a model specified)
  const agent = new Agent({
    name: 'TaskSpecificAgent',
    instructions: 'You are a helpful assistant that answers questions concisely. You support both text and image inputs.',
  });

  // Run with the provider specified for this execution
  const result = await run(agent, 'Explain what Codex Native SDK does', {
    provider: provider,
  });

  console.log('Result:');
  console.log(result.finalOutput);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
