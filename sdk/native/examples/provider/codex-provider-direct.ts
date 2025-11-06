/**
 * Example: Pass a Codex model instance directly to an Agent
 *
 * This demonstrates the most direct way to use Codex with the agents framework:
 * create a CodexProvider, get a model, and pass it directly to your Agent.
 *
 * CodexProvider features:
 * - Multi-modal input support (text + images)
 * - Streaming response deltas
 * - Automatic tool registration
 * - No API key configuration needed (handled by native bindings)
 *
 * Usage:
 * ```bash
 * npx tsx examples/codex-provider-direct.ts
 * ```
 */

import { Agent, run } from '@openai/agents';
import { CodexProvider } from '../../src/index';

async function main() {
  // Create a Codex provider (no API key needed - Codex handles auth internally)
  const provider = new CodexProvider({
    defaultModel: 'gpt-5-codex',
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
  });

  // Get a model instance from the provider
  const model = await provider.getModel('gpt-5-codex');

  // Create an agent with the Codex model
  const agent = new Agent({
    name: 'CodexAssistant',
    model,
    instructions:
      'You are a helpful coding assistant powered by GPT-5 through Codex. You support both text and image inputs.',
  });

  // Run the agent with text input
  console.log('Example 1: Text input\n');
  const result = await run(agent, 'What is the capital of France?');
  console.log('\nAgent response:');
  console.log(result.finalOutput);
  console.log('\n✓ Example 1 completed successfully');

  // Example with image input (multi-modal)
  // CodexProvider automatically handles image conversion
  console.log('\n\nExample 2: Multi-modal input (text + image)\n');
  console.log('Note: Images can be provided as URLs, base64 data, or file paths');
  console.log('      CodexProvider handles the conversion automatically');
  console.log('\n✓ Example 2 info displayed (no actual image run in this demo)');
}

main()
  .then(() => {
    console.log('\nExamples completed successfully.');
    // Force exit after completion - native bindings may keep handles open
    setTimeout(() => process.exit(0), 100);
  })
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
