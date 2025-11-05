/**
 * Example: Using CodexProvider with OpenAI Agents framework and custom tools
 *
 * This example demonstrates how to:
 * - Use zod for type-safe tool parameters
 * - Register custom tools with the agents framework
 * - Use CodexProvider as the model backend
 * - Create a weather assistant agent with multiple tools
 * - Tools are automatically registered and available to the agent
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
 * - Automatic tool registration with the CodexProvider
 * - Multiple tools working together (weather lookup + temperature conversion)
 * - Type-safe tool parameters with Zod schemas
 */

import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { Agent, run, withTrace, tool } from '@openai/agents';
import { CodexProvider } from '../src/index.js';

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

  // Create Codex provider
  // Codex handles authentication internally via native bindings
  const codexProvider = new CodexProvider({
    defaultModel: 'gpt-5',
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
  });

  // Get the Codex model
  const codexModel = await codexProvider.getModel();

  // Create an agent with Codex model and custom tools
  // NOTE: Tools are automatically registered with the CodexProvider
  // when passed to the Agent. No additional configuration needed!
  const weatherAgent = new Agent({
    name: 'WeatherAssistant',
    model: codexModel,
    instructions: 'You are a weather information assistant. When asked about weather, use the available tools to fetch data and provide responses in haiku format. Focus only on answering weather-related questions.',
    tools: [getWeatherTool, convertTemperatureTool],
  });

  console.log('✓ Created WeatherAssistant agent with Codex (GPT-5)');
  console.log('✓ Tools automatically registered: get_weather, convert_temperature\n');

  // Example 1: Simple text query
  await withTrace('Weather Assistant Example - Text', async () => {
    console.log('Example 1: Text-only query');
    console.log('─'.repeat(60));
    console.log('Running query: "What\'s the weather in Tokyo?"\n');

    const result = await run(weatherAgent, "What's the weather in Tokyo?");

    console.log('\n[Final response]');
    console.log(result.finalOutput);
  });

  console.log('\n' + '='.repeat(60) + '\n');

  // Example 2: Multi-modal query with image input
  // Demonstrates CodexProvider's image input support
  await withTrace('Weather Assistant Example - With Image', async () => {
    console.log('Example 2: Multi-modal query with image input');
    console.log('─'.repeat(60));
    console.log('CodexProvider supports multiple image input formats:');
    console.log('  - Base64 data URLs (data:image/png;base64,...)');
    console.log('  - HTTP(S) URLs (https://example.com/image.png)');
    console.log('  - Local file paths (/path/to/image.png)\n');

    const imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f4/NOAA_Weather_Radar_Cropped.jpg/320px-NOAA_Weather_Radar_Cropped.jpg';
    let localImagePath: string | null = null;

    try {
      console.log(`Downloading sample weather image from: ${imageUrl}`);
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Unexpected status ${response.status}`);
      }

      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-weather-'));
      localImagePath = path.join(tmpDir, 'radar.jpg');
      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(localImagePath, buffer);
      console.log(`Saved image to ${localImagePath}\n`);
    } catch (downloadError) {
      console.warn(`Failed to download sample image (${downloadError}). Falling back to text-only demo.\n`);
    }

    if (localImagePath) {
      const result = await run(weatherAgent, [
        { type: 'input_text', text: 'Analyze this weather radar image and describe current conditions in a haiku.' },
        { type: 'input_image', image: localImagePath },
      ]);

      console.log('\n[Final response]');
      console.log(result.finalOutput);
    } else {
      const result = await run(
        weatherAgent,
        'Based on radar showing scattered thunderstorms with heavy rainfall moving northeast, describe the weather in a haiku.',
      );

      console.log('\n[Final response]');
      console.log(result.finalOutput);
    }
  });

  console.log('\n' + '='.repeat(60));
  console.log('✓ Example complete!');
  console.log('\nKey takeaways:');
  console.log('  • Tools are automatically registered when passed to Agent()');
  console.log('  • Images can be provided as URLs, base64, or file paths');
  console.log('  • CodexProvider handles image format conversion automatically');
  console.log('  • Multi-modal inputs work seamlessly with the Agents framework');
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
