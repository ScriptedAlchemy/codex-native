/**
 * Example: Using CodexProvider with OpenAI Agents framework
 *
 * This example demonstrates how to:
 * - Use CodexProvider as a ModelProvider for the OpenAI Agents framework
 * - Create simple agents that interact via Codex
 * - Handle basic conversational queries
 *
 * Note: Custom tool execution (like weather tools defined in this file) is not
 * yet fully supported. The CodexProvider can execute Codex's built-in tools
 * (bash, file operations, web search, etc.) but bidirectional tool execution
 * with the OpenAI Agents framework requires additional integration work.
 * See CodexProvider.ts executeToolViaFramework() for details.
 *
 * Installation:
 * ```bash
 * npm install @codex-native/sdk @openai/agents zod
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/agents-with-tools.ts
 * ```
 *
 * This example demonstrates using Codex's native NAPI bindings as the model
 * provider. Codex handles authentication and connection to OpenAI's GPT-5
 * Responses API internally via the native binding, so no API key configuration
 * is needed in your code.
 *
 * Key features demonstrated:
 * - CodexProvider integration with OpenAI Agents framework
 * - Basic conversational agents
 * - Automatic cleanup of temporary directories
 */

import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { Agent, run, withTrace, tool } from '@openai/agents';
import { CodexProvider } from '../../src/index';

// Define a weather tool using zod for type-safe parameters
const getWeatherTool = tool({
  name: 'get_weather',
  description: 'Get the weather for a given city',
  parameters: z.object({
    city: z.string().describe('The city to get weather for'),
  }),
  execute: async (input) => {
    console.log(`[debug] Getting weather for ${input.city}\n`);
    // Simulate weather API call
    const weatherConditions = ['sunny', 'cloudy', 'rainy', 'snowy'];
    const condition = weatherConditions[Math.floor(Math.random() * weatherConditions.length)];
    const temp = Math.floor(Math.random() * 30) + 10;
    return `The weather in ${input.city} is ${condition} with a temperature of ${temp}°C`;
  },
});

// Define a temperature conversion tool
const convertTemperatureTool = tool({
  name: 'convert_temperature',
  description: 'Convert temperature between Celsius and Fahrenheit',
  parameters: z.object({
    value: z.number().describe('The temperature value to convert'),
    from: z.enum(['celsius', 'fahrenheit']).describe('The unit to convert from'),
    to: z.enum(['celsius', 'fahrenheit']).describe('The unit to convert to'),
  }),
  execute: async (input) => {
    console.log(`[debug] Converting ${input.value}°${input.from[0].toUpperCase()} to ${input.to}\n`);

    if (input.from === input.to) {
      return `${input.value}°${input.from === 'celsius' ? 'C' : 'F'}`;
    }

    let result: number;
    if (input.from === 'celsius' && input.to === 'fahrenheit') {
      result = (input.value * 9/5) + 32;
    } else {
      result = (input.value - 32) * 5/9;
    }

    return `${input.value}°${input.from === 'celsius' ? 'C' : 'F'} is ${result.toFixed(1)}°${input.to === 'celsius' ? 'C' : 'F'}`;
  },
});

async function main() {
  console.log('🤖 OpenAI Agents with Codex Provider\n');
  console.log('NOTE: This example demonstrates the CodexProvider integration,');
  console.log('but custom tools (get_weather, convert_temperature) are not yet');
  console.log('fully supported due to limitations in the current implementation.\n');
  console.log('The CodexProvider can execute its built-in tools (bash, file operations,');
  console.log('web search, etc.) but bidirectional tool execution with the OpenAI Agents');
  console.log('framework requires additional integration work.\n');

  // Create a temporary directory to avoid loading workspace AGENTS.md
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-agents-example-'));
  console.log(`Using temporary directory: ${tmpDir}\n`);

  // Create Codex provider with temporary directory
  // This avoids loading workspace-specific configuration files
  const codexProvider = new CodexProvider({
    defaultModel: 'gpt-5-codex',
    workingDirectory: tmpDir,
    skipGitRepoCheck: true,
  });

  // Get the Codex model
  const codexModel = await codexProvider.getModel();

  // Example 1: Simple text query
  console.log('Example 1: Basic conversational query');
  console.log('─'.repeat(60));

  // Create a simple agent
  const simpleAgent = new Agent({
    name: 'Assistant',
    model: codexModel,
    instructions: 'You are a helpful assistant.',
  });

  await withTrace('Conversation Example', async () => {
    const question = "Hello! Please respond with a brief greeting and confirm you can help.";
    console.log(`Query: "${question}"\n`);
    const result = await run(simpleAgent, question);

    console.log('\n[Final response]');
    console.log(result.finalOutput);

    // Verify we got a response
    if (!result.finalOutput || result.finalOutput.length === 0) {
      throw new Error('No response received from agent');
    }
  });

  console.log('\n' + '='.repeat(60));
  console.log('✓ Example complete!');
  console.log('\nKey takeaways:');
  console.log('  • CodexProvider successfully integrates with OpenAI Agents framework');
  console.log('  • Basic queries work without custom tools');
  console.log('  • Custom tool execution requires bidirectional framework integration');
  console.log('  • See CodexProvider.ts executeToolViaFramework() for details');

  // Cleanup
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch (e) {
    // Ignore cleanup errors
  }
}

// Run if executed directly
if (require.main === module) {
  main()
    .then(() => {
      // Force exit after completion to avoid hanging
      process.exit(0);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { main, getWeatherTool, convertTemperatureTool };
