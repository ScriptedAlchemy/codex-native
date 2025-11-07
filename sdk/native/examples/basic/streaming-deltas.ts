/**
 * Example: Streaming responses with CodexProvider
 *
 * This example demonstrates how to use CodexProvider's streaming capabilities
 * to receive events as the model generates a response. This is useful for
 * building responsive UIs that show progress in real-time.
 *
 * Features demonstrated:
 * - Streaming text responses (complete text when generation finishes)
 * - Streaming reasoning updates (for extended thinking models)
 * - Handling different stream event types
 * - Real-time progress monitoring
 * - Image input support with streaming
 *
 * Note: The current implementation emits complete text/reasoning blocks
 * rather than character-by-character deltas. Events are emitted when
 * each phase completes (reasoning done, text done, etc.).
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
import { CodexProvider } from '../../src/index';

async function streamingTextExample() {
  console.log('\n' + '='.repeat(70));
  console.log('Example 1: Streaming Text Response');
  console.log('='.repeat(70) + '\n');

  // Create provider and model
  const provider = new CodexProvider({
    defaultModel: 'gpt-5-codex',
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
    outputType: { type: 'text' as const },
    handoffs: [],
    tracing: { enabled: false },
  };

  let fullText = '';
  let fullReasoning = '';

  // Stream the response
  for await (const event of model.getStreamedResponse(request)) {
    switch (event.type) {
      case 'response_started':
        console.log('[Stream started]');
        console.log('[Generating response...]\n');
        break;

      case 'output_text_delta':
        // Note: Delta events are not currently emitted by the backend
        // Text is provided as a complete block in output_text_done
        process.stdout.write(event.delta);
        fullText += event.delta;
        break;

      case 'output_text_done':
        // Text is provided here as a complete block
        fullText = event.text;
        console.log(event.text);
        console.log('\n[Text generation complete]');
        break;

      case 'reasoning_delta':
        // Note: Delta events are not currently emitted by the backend
        // Reasoning is provided as a complete block in reasoning_done
        fullReasoning += event.delta;
        break;

      case 'reasoning_done':
        if (event.reasoning) {
          fullReasoning = event.reasoning;
          console.log(`[Extended thinking complete: ${event.reasoning.length} chars]`);
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
  if (fullReasoning) {
    console.log(`Reasoning length: ${fullReasoning.length} characters`);
  }
}

async function streamingWithImageExample() {
  console.log('\n\n' + '='.repeat(70));
  console.log('Example 2: Streaming with Image Input');
  console.log('='.repeat(70) + '\n');

  const provider = new CodexProvider({
    defaultModel: 'gpt-5-codex',
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
  const imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/1200px-Cat03.jpg';

  const request = {
    systemInstructions: 'You are a helpful assistant that can analyze images.',
    input: [
      { type: 'input_text' as const, text: 'Describe what you see in this image concisely' },
      { type: 'input_image' as const, image: imageUrl }
    ],
    modelSettings: {},
    tools: [],
    outputType: { type: 'text' as const },
    handoffs: [],
    tracing: { enabled: false },
  };

  let responseText = '';

  for await (const event of model.getStreamedResponse(request)) {
    switch (event.type) {
      case 'response_started':
        console.log('[Stream started - processing image...]');
        console.log('[Generating response...]\n');
        break;

      case 'output_text_delta':
        process.stdout.write(event.delta);
        responseText += event.delta;
        break;

      case 'output_text_done':
        responseText = event.text;
        console.log(event.text);
        console.log('\n[Text generation complete]');
        break;

      case 'reasoning_done':
        if (event.reasoning) {
          console.log(`[Extended thinking complete: ${event.reasoning.length} chars]`);
        }
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

  console.log('\n' + '─'.repeat(70));
  console.log(`Response length: ${responseText.length} characters`);
}

async function detailedStreamEventExample() {
  console.log('\n\n' + '='.repeat(70));
  console.log('Example 3: Understanding All Stream Event Types');
  console.log('='.repeat(70) + '\n');

  const provider = new CodexProvider({
    defaultModel: 'gpt-5-codex',
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
  });

  const model = await provider.getModel();

  console.log('This example shows all possible stream event types:\n');
  console.log('Event Types:');
  console.log('  • response_started - Stream begins');
  console.log('  • output_text_delta - Incremental text chunk (not currently emitted)');
  console.log('  • output_text_done - Text generation complete (includes full text)');
  console.log('  • reasoning_delta - Incremental reasoning (not currently emitted)');
  console.log('  • reasoning_done - Reasoning complete (includes full reasoning)');
  console.log('  • response_done - Full response complete with usage stats');
  console.log('  • error - An error occurred\n');
  console.log('Note: Currently only complete blocks are emitted (reasoning_done, output_text_done)');
  console.log('      rather than incremental deltas.\n');

  console.log('─'.repeat(70));
  console.log('Event stream:\n');

  const request = {
    systemInstructions: 'You are a helpful assistant.',
    input: 'Count from 1 to 5 and explain each number.',
    modelSettings: {},
    tools: [],
    outputType: { type: 'text' as const },
    handoffs: [],
    tracing: { enabled: false },
  };

  const eventCounts = new Map<string, number>();

  for await (const event of model.getStreamedResponse(request)) {
    // Track event counts
    const count = eventCounts.get(event.type) || 0;
    eventCounts.set(event.type, count + 1);

    // Log each event type
    switch (event.type) {
      case 'response_started':
        console.log(`[${event.type}]`);
        break;

      case 'output_text_delta':
        // Delta events are not currently emitted, but handler is here for future compatibility
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
        // Delta events are not currently emitted, but handler is here for future compatibility
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
  console.log('🌊 CodexProvider Streaming Response Examples\n');
  console.log('These examples demonstrate streaming capabilities for monitoring');
  console.log('response generation in real-time.\n');

  try {
    // Run all examples
    await streamingTextExample();
    await streamingWithImageExample();
    await detailedStreamEventExample();

    console.log('\n\n' + '='.repeat(70));
    console.log('✓ All streaming examples complete!');
    console.log('='.repeat(70));
    console.log('\nKey takeaways:');
    console.log('  • Stream events provide real-time progress updates');
    console.log('  • output_text_done provides the complete generated text');
    console.log('  • reasoning_done provides the complete extended thinking');
    console.log('  • Image inputs work seamlessly with streaming');
    console.log('  • Usage statistics are provided in the response_done event');
    console.log('  • Current implementation emits complete blocks rather than character deltas');
  } catch (error) {
    console.error('\n✗ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
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

export { main };
