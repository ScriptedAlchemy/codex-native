/**
 * Example: Streaming response deltas with CodexProvider
 *
 * This example demonstrates how to use CodexProvider's streaming capabilities
 * to receive incremental updates as the model generates a response. This is
 * useful for building responsive UIs that show progress in real-time.
 *
 * Features demonstrated:
 * - Streaming text deltas (character-by-character updates)
 * - Streaming reasoning deltas (for extended thinking models)
 * - Handling different stream event types
 * - Building up the full response from deltas
 * - Image input support with streaming
 *
 * Installation:
 * ```bash
 * npm install @codex-native/sdk @openai/agents
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/streaming-deltas.ts
 * ```
 */

import { Agent, run } from '@openai/agents';
import { CodexProvider } from '../src/index.js';

async function streamingTextExample() {
  console.log('\n' + '='.repeat(70));
  console.log('Example 1: Streaming Text Deltas');
  console.log('='.repeat(70) + '\n');

  // Create provider and model
  const provider = new CodexProvider({
    defaultModel: 'claude-sonnet-4-5',
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
  });

  const model = await provider.getModel();

  // Create a simple agent
  const agent = new Agent({
    name: 'StreamingAssistant',
    model: model,
    instructions: 'You are a helpful assistant. Provide detailed explanations.',
  });

  console.log('Requesting: "Explain how neural networks work in 3 paragraphs"\n');
  console.log('─'.repeat(70));
  console.log('Streaming response:');
  console.log('─'.repeat(70) + '\n');

  // Use the streaming API to get incremental updates
  const request = {
    systemInstructions: 'You are a helpful assistant.',
    input: 'Explain how neural networks work in 3 paragraphs',
    modelSettings: {},
    tools: [],
    outputType: { type: 'json_schema' as const, schema: {} },
    handoffs: [],
    tracing: { enabled: false },
  };

  let fullText = '';
  let fullReasoning = '';

  // Stream the response
  for await (const event of model.getStreamedResponse(request)) {
    switch (event.type) {
      case 'response_started':
        console.log('[Stream started]\n');
        break;

      case 'output_text_delta':
        // Print each delta as it arrives (character-by-character)
        process.stdout.write(event.delta);
        fullText += event.delta;
        break;

      case 'output_text_done':
        console.log('\n\n[Text complete]');
        break;

      case 'reasoning_delta':
        // If the model is using extended thinking, we'll see reasoning deltas
        fullReasoning += event.delta;
        break;

      case 'reasoning_done':
        if (fullReasoning) {
          console.log(`\n[Reasoning complete: ${fullReasoning.length} chars]`);
        }
        break;

      case 'response_done':
        console.log(`\n[Response done]`);
        console.log(`  Input tokens: ${event.response.usage.inputTokens}`);
        console.log(`  Output tokens: ${event.response.usage.outputTokens}`);
        console.log(`  Total tokens: ${event.response.usage.totalTokens}`);
        break;

      case 'error':
        console.error(`\n[Error]: ${event.error.message}`);
        break;
    }
  }

  console.log('\n' + '─'.repeat(70));
  console.log(`Final text length: ${fullText.length} characters`);
}

async function streamingWithImageExample() {
  console.log('\n\n' + '='.repeat(70));
  console.log('Example 2: Streaming with Image Input');
  console.log('='.repeat(70) + '\n');

  const provider = new CodexProvider({
    defaultModel: 'claude-sonnet-4-5',
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
  });

  const model = await provider.getModel();

  console.log('Sending multi-modal input (text + image)...');
  console.log('CodexProvider automatically handles image conversion for streaming\n');
  console.log('─'.repeat(70));
  console.log('Streaming response:');
  console.log('─'.repeat(70) + '\n');

  // Example with image - using a sample image URL
  const imageUrl = 'https://www.noaa.gov/sites/default/files/styles/landscape_width_1275/public/2022-03/PHOTO-Climate-Collage-Diagonal-Design-NOAA-Communications-NO-NOAA-Logo.jpg';

  const request = {
    systemInstructions: 'You are a helpful assistant that can analyze images.',
    input: [
      { type: 'input_text' as const, text: 'Describe what you see in this image concisely' },
      { type: 'input_image' as const, image: imageUrl }
    ],
    modelSettings: {},
    tools: [],
    outputType: { type: 'json_schema' as const, schema: {} },
    handoffs: [],
    tracing: { enabled: false },
  };

  let responseText = '';

  for await (const event of model.getStreamedResponse(request)) {
    switch (event.type) {
      case 'response_started':
        console.log('[Stream started - processing image...]\n');
        break;

      case 'output_text_delta':
        process.stdout.write(event.delta);
        responseText += event.delta;
        break;

      case 'output_text_done':
        console.log('\n\n[Text complete]');
        break;

      case 'response_done':
        console.log(`\n[Response done]`);
        console.log(`  Tokens used: ${event.response.usage.totalTokens}`);
        break;

      case 'error':
        console.error(`\n[Error]: ${event.error.message}`);
        break;
    }
  }
}

async function detailedStreamEventExample() {
  console.log('\n\n' + '='.repeat(70));
  console.log('Example 3: Understanding All Stream Event Types');
  console.log('='.repeat(70) + '\n');

  const provider = new CodexProvider({
    defaultModel: 'claude-sonnet-4-5',
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
  });

  const model = await provider.getModel();

  console.log('This example shows all possible stream event types:\n');
  console.log('Event Types:');
  console.log('  • response_started - Stream begins');
  console.log('  • output_text_delta - Incremental text chunk');
  console.log('  • output_text_done - Text generation complete');
  console.log('  • reasoning_delta - Incremental reasoning (if extended thinking is used)');
  console.log('  • reasoning_done - Reasoning complete');
  console.log('  • response_done - Full response complete with usage stats');
  console.log('  • error - An error occurred\n');

  console.log('─'.repeat(70));
  console.log('Event stream:\n');

  const request = {
    systemInstructions: 'You are a helpful assistant.',
    input: 'Count from 1 to 5 and explain each number.',
    modelSettings: {},
    tools: [],
    outputType: { type: 'json_schema' as const, schema: {} },
    handoffs: [],
    tracing: { enabled: false },
  };

  const eventCounts = new Map<string, number>();

  for await (const event of model.getStreamedResponse(request)) {
    // Track event counts
    const count = eventCounts.get(event.type) || 0;
    eventCounts.set(event.type, count + 1);

    // Log each event type (but limit delta events for readability)
    switch (event.type) {
      case 'response_started':
        console.log(`[${event.type}]`);
        break;

      case 'output_text_delta':
        // Only log the first few deltas to avoid spam
        if (count < 3) {
          console.log(`[${event.type}] delta="${event.delta}"`);
        } else if (count === 3) {
          console.log(`[${event.type}] ... (${count} more delta events) ...`);
        }
        break;

      case 'output_text_done':
        console.log(`[${event.type}] text length=${event.text.length}`);
        break;

      case 'reasoning_delta':
        if (count < 3) {
          console.log(`[${event.type}] delta="${event.delta}"`);
        }
        break;

      case 'reasoning_done':
        console.log(`[${event.type}] reasoning length=${event.reasoning.length}`);
        break;

      case 'response_done':
        console.log(`[${event.type}] usage=${JSON.stringify(event.response.usage)}`);
        break;

      case 'error':
        console.log(`[${event.type}] message="${event.error.message}"`);
        break;
    }
  }

  console.log('\n' + '─'.repeat(70));
  console.log('Event Statistics:');
  for (const [eventType, count] of eventCounts.entries()) {
    console.log(`  ${eventType}: ${count} events`);
  }
}

async function main() {
  console.log('🌊 CodexProvider Streaming Deltas Examples\n');
  console.log('These examples demonstrate real-time streaming capabilities');
  console.log('with incremental updates as the model generates responses.\n');

  try {
    // Run all examples
    await streamingTextExample();
    await streamingWithImageExample();
    await detailedStreamEventExample();

    console.log('\n\n' + '='.repeat(70));
    console.log('✓ All streaming examples complete!');
    console.log('='.repeat(70));
    console.log('\nKey takeaways:');
    console.log('  • Stream events provide real-time updates during generation');
    console.log('  • output_text_delta events give character-by-character updates');
    console.log('  • reasoning_delta events show extended thinking process');
    console.log('  • Image inputs work seamlessly with streaming');
    console.log('  • Usage statistics are provided in the response_done event');
  } catch (error) {
    console.error('\n✗ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main };
