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
import { startMockResponsesServer } from './utils/mock-responses-server.js';

async function main() {
  const usingRealBackend = Boolean(process.env.CODEX_BASE_URL);
  const mockServer = usingRealBackend
    ? null
    : await startMockResponsesServer([
        'The Codex Native SDK provides fast GPT-5 access with built-in tool automation and project workspace management.',
      ]);
  const previousBaseUrl = process.env.CODEX_BASE_URL;
  const previousOpenAiKey = process.env.OPENAI_API_KEY;

  try {
    if (!usingRealBackend) {
      process.env.CODEX_BASE_URL = mockServer!.url;
      process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'mock-api-key';
    }

    // Create a provider instance for this specific run (no API key needed)
    const provider = new CodexProvider({
      defaultModel: 'gpt-5',
      baseUrl: process.env.CODEX_BASE_URL ?? mockServer!.url,
      apiKey: process.env.CODEX_API_KEY ?? 'mock-api-key',
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

    if (!usingRealBackend) {
      console.log(
        '\n(Mock server in use — set CODEX_BASE_URL to run against a real Codex deployment.)',
      );
    }
  } finally {
    if (mockServer) {
      await mockServer.close();
    }
    if (!usingRealBackend) {
      if (previousBaseUrl === undefined) {
        delete process.env.CODEX_BASE_URL;
      } else {
        process.env.CODEX_BASE_URL = previousBaseUrl;
      }

      if (previousOpenAiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiKey;
      }
    }
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
