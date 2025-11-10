/**
 * Example: Basic Streaming with Native SDK
 *
 * This example demonstrates how to use streaming responses directly from the
 * Codex Native SDK (similar to the TypeScript SDK API).
 *
 * Key concepts:
 * - Real-time streaming of agent responses
 * - Handling different stream event types
 * - Token usage tracking
 *
 * Installation:
 * ```bash
 * npm install @codex-native/sdk
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/basic_streaming.ts
 * ```
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { Codex } from '../src/index';

async function main() {
  console.log('🌊 Basic Streaming with Native SDK\n');
  console.log('This example demonstrates real-time streaming of agent responses');
  console.log('directly from the Codex Native SDK.\n');

  // Create a temporary directory to avoid loading workspace AGENTS.md
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-streaming-'));
  console.log(`Working directory: ${tmpDir}\n`);

  // Create Codex instance
  const codex = new Codex();

  // Start a thread with working directory options
  const thread = codex.startThread({
    workingDirectory: tmpDir,
    skipGitRepoCheck: true,
  });

  // ============================================================================
  // Example 1: Basic Streaming
  // ============================================================================

  console.log('Example 1: Basic Streaming');
  console.log('─'.repeat(40));

  console.log('Query: "Explain how streaming works in AI agents"\n');
  console.log('[Streaming Response]\n');

  try {
    const stream = await thread.runStreamed('Explain how streaming works in AI agents');

    let accumulatedText = '';
    let tokenCount = 0;

    for await (const event of stream.events) {
      switch (event.type) {
        case 'thread.started':
          console.log('📡 Thread started...\n');
          break;

        case 'turn.started':
          console.log('🔄 Turn started...\n');
          break;

        case 'item.completed':
          if (event.item.type === 'agent_message') {
            const text = event.item.text;
            // Print deltas as they arrive
            process.stdout.write(text.slice(accumulatedText.length));
            accumulatedText = text;
            tokenCount += text.split(/\s+/).length;
          }
          break;

        case 'turn.completed':
          console.log('\n\n✓ Turn completed');
          console.log(`📊 Usage: ${event.usage.input_tokens} input + ${event.usage.output_tokens} output = ${event.usage.input_tokens + event.usage.output_tokens} total tokens`);
          break;

        case 'turn.failed':
          console.error('\n✗ Turn failed:', event.error.message);
          break;
      }
    }

    console.log('\n✓ Example 1 completed');
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
  }

  // ============================================================================
  // Example 2: Streaming with Progress Tracking
  // ============================================================================

  console.log('\n\nExample 2: Streaming with Progress Tracking');
  console.log('─'.repeat(50));

  console.log('Query: "Write a function to calculate fibonacci numbers"\n');
  console.log('[Streaming with Progress]\n');

  try {
    const stream = await thread.runStreamed('Write a function to calculate fibonacci numbers');

    let chunkCount = 0;
    let lastUpdate = Date.now();

    for await (const event of stream.events) {
      switch (event.type) {
        case 'item.completed':
          if (event.item.type === 'agent_message') {
            chunkCount++;
            const now = Date.now();
            // Update progress indicator every 500ms
            if (now - lastUpdate > 500) {
              process.stdout.write(`\r📝 Received ${chunkCount} chunks... `);
              lastUpdate = now;
            }
            // Still print the actual content
            const text = event.item.text;
            process.stdout.write(text.slice(Math.max(0, text.length - 100))); // Show last 100 chars
          }
          break;

        case 'turn.completed':
          console.log(`\n\n✓ Completed (${chunkCount} chunks)`);
          console.log(`📊 Usage: ${event.usage.input_tokens + event.usage.output_tokens} tokens`);
          break;
      }
    }

    console.log('\n✓ Example 2 completed');
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
  }

  // ============================================================================
  // Summary
  // ============================================================================

  console.log('\n\n' + '='.repeat(60));
  console.log('📋 Summary');
  console.log('='.repeat(60));
  console.log('\nKey takeaways:');
  console.log('  • Streaming works directly with thread.runStreamed()');
  console.log('  • Handle different event types: thread.started, turn.started, item.completed, turn.completed');
  console.log('  • Real-time updates as responses are generated');
  console.log('  • Same API as TypeScript SDK');
  console.log('\nAPI parity:');
  console.log('  • Native SDK supports same streaming as TypeScript SDK');
  console.log('  • Use thread.runStreamed(input) for streaming');
  console.log('  • Same event types and structure');

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
