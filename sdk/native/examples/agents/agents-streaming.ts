/**
 * Example: Streaming Responses with CodexProvider
 *
 * This example demonstrates how to use streaming responses in the OpenAI Agents framework
 * with CodexProvider. Streaming allows you to receive real-time updates as the agent
 * generates its response.
 *
 * Based on OpenAI Agents SDK documentation:
 * https://openai.github.io/openai-agents-js/guides/streaming
 *
 * Installation:
 * ```bash
 * npm install @codex-native/sdk @openai/agents
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/agents/agents-streaming.ts
 * ```
 *
 * Key features demonstrated:
 * - Real-time streaming deltas
 * - Handling different stream event types
 * - Token usage tracking
 * - Progress indicators
 * - Using CodexProvider as the model backend
 */

import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Agent, run } from '@openai/agents';
import { CodexProvider } from '../../src/index';

async function main() {
  console.log('🌊 Streaming Responses with CodexProvider\n');
  console.log('This example demonstrates real-time streaming of agent responses.\n');

  // Create a temporary directory to avoid loading workspace AGENTS.md
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-streaming-example-'));
  console.log(`Using temporary directory: ${tmpDir}\n`);

  // Create Codex provider
  const codexProvider = new CodexProvider({
    defaultModel: 'gpt-5-codex',
    workingDirectory: tmpDir,
    skipGitRepoCheck: true,
  });

  const codexModel = await codexProvider.getModel();

  // ============================================================================
  // Example 1: Basic Streaming
  // ============================================================================
  console.log('Example 1: Basic Streaming');
  console.log('─'.repeat(60));

  const streamingAgent = new Agent({
    name: 'StreamingAgent',
    model: codexModel,
    instructions: 'You are a helpful assistant. Provide detailed, informative responses.',
  });

  console.log('\nQuery: "Explain how streaming works in AI agents"\n');
  console.log('[Streaming Response]\n');

  const stream1 = await run(streamingAgent, 'Explain how streaming works in AI agents', {
    stream: true,
  });

  let accumulatedText = '';
  let tokenCount = 0;

  for await (const event of stream1) {
    switch (event.type) {
      case 'response_started':
        console.log('📡 Response started...\n');
        break;

      case 'output_text_delta':
        // Print deltas as they arrive
        process.stdout.write(event.delta);
        accumulatedText += event.delta;
        tokenCount += event.delta.split(/\s+/).length;
        break;

      case 'output_text_done':
        console.log('\n\n✓ Text output completed');
        break;

      case 'reasoning_delta':
        // Reasoning deltas (if supported)
        process.stdout.write(`[Reasoning] ${event.delta}`);
        break;

      case 'reasoning_done':
        console.log('\n✓ Reasoning completed');
        break;

      case 'response_done':
        console.log('\n📊 Final Statistics:');
        console.log(`  Total tokens: ${event.response.usage.totalTokens}`);
        console.log(`  Input tokens: ${event.response.usage.inputTokens}`);
        console.log(`  Output tokens: ${event.response.usage.outputTokens}`);
        break;

      case 'error':
        console.error('\n✗ Error:', event.error.message);
        break;
    }
  }

  console.log('\n✓ Example 1 completed');

  // ============================================================================
  // Example 2: Streaming with Progress Indicator
  // ============================================================================
  console.log('\n\nExample 2: Streaming with Progress Indicator');
  console.log('─'.repeat(60));

  const progressAgent = new Agent({
    name: 'ProgressAgent',
    model: codexModel,
    instructions: 'You are a coding assistant. Write clear, well-documented code.',
  });

  console.log('\nQuery: "Write a function to calculate fibonacci numbers"\n');
  console.log('[Streaming with Progress]\n');

  const stream2 = await run(progressAgent, 'Write a function to calculate fibonacci numbers', {
    stream: true,
  });

  let chunkCount = 0;
  let lastUpdate = Date.now();

  for await (const event of stream2) {
    switch (event.type) {
      case 'response_started':
        console.log('⏳ Starting response generation...\n');
        break;

      case 'output_text_delta':
        chunkCount++;
        const now = Date.now();
        // Update progress indicator every 500ms
        if (now - lastUpdate > 500) {
          process.stdout.write(`\r📝 Received ${chunkCount} chunks... `);
          lastUpdate = now;
        }
        // Still print the actual content
        process.stdout.write(event.delta);
        break;

      case 'output_text_done':
        console.log(`\n\n✓ Completed (${chunkCount} chunks)`);
        break;

      case 'response_done':
        console.log('\n📊 Usage:');
        console.log(`  Input: ${event.response.usage.inputTokens} tokens`);
        console.log(`  Output: ${event.response.usage.outputTokens} tokens`);
        console.log(`  Total: ${event.response.usage.totalTokens} tokens`);
        break;
    }
  }

  console.log('\n✓ Example 2 completed');

  // ============================================================================
  // Example 3: Streaming with Custom Processing
  // ============================================================================
  console.log('\n\nExample 3: Streaming with Custom Processing');
  console.log('─'.repeat(60));

  const customAgent = new Agent({
    name: 'CustomAgent',
    model: codexModel,
    instructions: 'You are a helpful assistant that provides structured information.',
  });

  console.log('\nQuery: "List the benefits of using streaming in AI applications"\n');
  console.log('[Custom Processing]\n');

  const stream3 = await run(
    customAgent,
    'List the benefits of using streaming in AI applications',
    { stream: true }
  );

  const lines: string[] = [];
  let currentLine = '';

  for await (const event of stream3) {
    switch (event.type) {
      case 'output_text_delta':
        currentLine += event.delta;
        // Process line by line
        if (event.delta.includes('\n')) {
          const parts = currentLine.split('\n');
          // Add all but the last part (which might be incomplete)
          for (let i = 0; i < parts.length - 1; i++) {
            if (parts[i]!.trim()) {
              lines.push(parts[i]!);
              console.log(`  ${lines.length}. ${parts[i]!.trim()}`);
            }
          }
          // Keep the last part as current line
          currentLine = parts[parts.length - 1] || '';
        }
        break;

      case 'output_text_done':
        // Process remaining line
        if (currentLine.trim()) {
          lines.push(currentLine);
          console.log(`  ${lines.length}. ${currentLine.trim()}`);
        }
        console.log(`\n✓ Processed ${lines.length} items`);
        break;

      case 'response_done':
        console.log('\n📊 Response completed');
        break;
    }
  }

  console.log('\n✓ Example 3 completed');

  // ============================================================================
  // Example 4: Error Handling in Streaming
  // ============================================================================
  console.log('\n\nExample 4: Error Handling in Streaming');
  console.log('─'.repeat(60));

  const errorHandlingAgent = new Agent({
    name: 'ErrorHandlingAgent',
    model: codexModel,
    instructions: 'You are a helpful assistant.',
  });

  console.log('\nQuery: "Explain error handling in streaming"\n');
  console.log('[Error Handling]\n');

  const stream4 = await run(
    errorHandlingAgent,
    'Explain error handling in streaming',
    { stream: true }
  );

  let hasError = false;

  try {
    for await (const event of stream4) {
      switch (event.type) {
        case 'output_text_delta':
          process.stdout.write(event.delta);
          break;

        case 'error':
          hasError = true;
          console.error('\n\n✗ Streaming error:', event.error.message);
          break;

        case 'response_done':
          if (!hasError) {
            console.log('\n\n✓ Stream completed successfully');
          }
          break;
      }
    }
  } catch (error) {
    console.error('\n\n✗ Fatal error during streaming:', error instanceof Error ? error.message : String(error));
  }

  console.log('\n✓ Example 4 completed');

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('\n\n' + '='.repeat(60));
  console.log('📋 Summary');
  console.log('='.repeat(60));
  console.log('\nKey takeaways:');
  console.log('  • Streaming provides real-time updates as responses are generated');
  console.log('  • Call run(agent, input, { stream: true }) to enable streaming');
  console.log('  • Handle different event types: deltas, done, errors');
  console.log('  • CodexProvider supports full streaming capabilities');
  console.log('  • Streaming enables better UX with progress indicators');
  console.log('\nStream event types:');
  console.log('  • response_started - Stream began');
  console.log('  • output_text_delta - Text chunk received');
  console.log('  • output_text_done - Text output completed');
  console.log('  • reasoning_delta - Reasoning chunk (if supported)');
  console.log('  • reasoning_done - Reasoning completed');
  console.log('  • response_done - Full response with usage stats');
  console.log('  • error - Error occurred');
  console.log('\nFor more information, see:');
  console.log('  https://openai.github.io/openai-agents-js/guides/streaming');

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
      process.exit(0);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { main };

