/**
 * Example: Streaming Responses with Real-time Updates
 *
 * This example demonstrates how to stream responses from agents in real-time,
 * providing immediate feedback to users as the agent processes requests.
 *
 * Key concepts:
 * - Streaming agent responses as they're generated
 * - Processing deltas for incremental updates
 * - Handling different event types (text, reasoning, completion)
 * - Building responsive user experiences
 *
 * Installation:
 * ```bash
 * npm install @codex-native/sdk @openai/agents
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/agents/streaming-responses.ts
 * ```
 */

import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Agent, run } from '@openai/agents';
import { CodexProvider } from '../../src/index';

async function main() {
  console.log('🌊 Streaming Responses Example\n');
  console.log('This example demonstrates real-time streaming of agent responses');
  console.log('with incremental updates and progress tracking.\n');

  // Create a temporary directory
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-streaming-'));
  console.log(`Working directory: ${tmpDir}\n`);

  // Create Codex provider
  const codexProvider = new CodexProvider({
    defaultModel: 'gpt-5-codex',
    workingDirectory: tmpDir,
    skipGitRepoCheck: true,
  });

  const codexModel = await codexProvider.getModel();

  // ============================================================================
  // Example 1: Basic Text Streaming
  // ============================================================================

  console.log('Example 1: Basic Text Streaming');
  console.log('─'.repeat(60));

  console.log('\nStreaming explanation of async/await...\n');
  console.log('Output:');
  console.log('┌' + '─'.repeat(58) + '┐');
  
  let charCount = 0;
  const maxLineLength = 54;
  let currentLine = '│ ';

  try {
    // Use getStreamedResponse from the model
    const streamResult = codexModel.getStreamedResponse({
      systemInstructions: 'You are a technical writer who explains complex concepts clearly.',
      input: 'Explain how async/await works in JavaScript in 2-3 paragraphs.',
      modelSettings: {},
      tools: [],
      outputType: { type: 'text' },
      handoffs: [],
      tracing: { enabled: false },
    });

    for await (const chunk of streamResult) {
      if (chunk.type === 'output_text_delta') {
        const text = chunk.delta;
        for (const char of text) {
          if (char === '\n') {
            // Pad the line to the box width and print
            process.stdout.write(currentLine.padEnd(56) + ' │\n');
            currentLine = '│ ';
            charCount = 0;
          } else {
            currentLine += char;
            charCount++;
            if (charCount >= maxLineLength) {
              process.stdout.write(currentLine + ' │\n');
              currentLine = '│ ';
              charCount = 0;
            }
          }
        }
      } else if (chunk.type === 'response_done') {
        // Flush remaining line
        if (currentLine !== '│ ') {
          process.stdout.write(currentLine.padEnd(56) + ' │\n');
        }
        console.log('└' + '─'.repeat(58) + '┘\n');
        console.log(`✓ Complete (${chunk.response.usage.outputTokens} tokens)`);
      }
    }
  } catch (error) {
    console.log('\n✗ Streaming failed:', error instanceof Error ? error.message : String(error));
  }

  // ============================================================================
  // Example 2: Streaming with Progress Tracking
  // ============================================================================

  console.log('\n' + '='.repeat(60));
  console.log('Example 2: Streaming with Progress Tracking');
  console.log('─'.repeat(60));

  const sampleCode = `
function quickSort(arr) {
  if (arr.length <= 1) return arr;
  const pivot = arr[0];
  const left = arr.slice(1).filter(x => x < pivot);
  const right = arr.slice(1).filter(x => x >= pivot);
  return [...quickSort(left), pivot, ...quickSort(right)];
}
`;

  console.log('\nAnalyzing code with progress tracking...');
  console.log('Code:', sampleCode.trim());
  console.log();

  let phase = 'initializing';
  let textBuffer = '';

  try {
    const streamResult = codexModel.getStreamedResponse({
      systemInstructions: `You are a code analyzer. When analyzing code:
1. First, describe what you're analyzing
2. Then, identify key patterns and issues
3. Finally, provide recommendations`,
      input: `Analyze this quicksort implementation:\n\n${sampleCode}`,
      modelSettings: {},
      tools: [],
      outputType: { type: 'text' },
      handoffs: [],
      tracing: { enabled: false },
    });

    for await (const event of streamResult) {
      switch (event.type) {
        case 'response_started':
          console.log('📡 Response started...');
          phase = 'analyzing';
          break;

        case 'output_text_delta':
          textBuffer += event.delta;
          // Update phase based on content
          if (textBuffer.includes('analyzing') || textBuffer.includes('Analyzing')) {
            phase = 'analyzing';
          } else if (textBuffer.includes('pattern') || textBuffer.includes('issue')) {
            phase = 'identifying';
          } else if (textBuffer.includes('recommend') || textBuffer.includes('suggest')) {
            phase = 'recommending';
          }

          // Show progress indicator
          process.stdout.write('.');
          break;

        case 'output_text_done':
          console.log('\n\n📝 Analysis complete');
          console.log('\nFull response:');
          console.log(event.text);
          break;

        case 'response_done':
          console.log('\n✓ Done!');
          console.log('Usage:', {
            input: event.response.usage.inputTokens,
            output: event.response.usage.outputTokens,
            total: event.response.usage.totalTokens,
          });
          break;

        case 'error':
          console.error('\n✗ Error:', event.error.message);
          break;
      }
    }
  } catch (error) {
    console.log('\n✗ Streaming failed:', error instanceof Error ? error.message : String(error));
  }

  // ============================================================================
  // Example 3: Multi-Stage Streaming with Reasoning
  // ============================================================================

  console.log('\n' + '='.repeat(60));
  console.log('Example 3: Multi-Stage Streaming (with Reasoning)');
  console.log('─'.repeat(60));

  const buggyCode = `
function calculateAverage(numbers) {
  let sum = 0;
  for (let i = 0; i <= numbers.length; i++) {
    sum += numbers[i];
  }
  return sum / numbers.length;
}
`;

  console.log('\nDebugging code with reasoning output...');
  console.log('Buggy code:', buggyCode.trim());
  console.log();

  let reasoningBuffer = '';

  try {
    const streamResult = codexModel.getStreamedResponse({
      systemInstructions: `You are a debugging expert. When fixing bugs:
1. Analyze the error carefully
2. Reason through possible causes
3. Provide a fix with explanation`,
      input: `Find and fix the bug in this code:\n\n${buggyCode}\n\nError: "TypeError: Cannot read property of undefined"`,
      modelSettings: {},
      tools: [],
      outputType: { type: 'text' },
      handoffs: [],
      tracing: { enabled: false },
    });

    for await (const event of streamResult) {
      switch (event.type) {
        case 'response_started':
          console.log('🔍 Starting debug analysis...\n');
          break;

        case 'reasoning_delta':
          reasoningBuffer += event.delta;
          // Show reasoning in real-time (optional, can be hidden)
          process.stdout.write(event.delta);
          break;

        case 'reasoning_done':
          if (reasoningBuffer) {
            console.log('\n\n💭 Reasoning complete:');
            console.log('─'.repeat(60));
            console.log(event.reasoning);
            console.log('─'.repeat(60) + '\n');
          }
          break;

        case 'output_text_delta':
          process.stdout.write(event.delta);
          break;

        case 'output_text_done':
          console.log('\n\n✓ Solution provided');
          break;

        case 'response_done':
          console.log('\nDebug session complete!');
          break;

        case 'error':
          console.error('\n✗ Error:', event.error.message);
          break;
      }
    }
  } catch (error) {
    console.log('\n✗ Streaming failed:', error instanceof Error ? error.message : String(error));
  }

  // ============================================================================
  // Example 4: Streaming Multiple Agents in Parallel
  // ============================================================================

  console.log('\n' + '='.repeat(60));
  console.log('Example 4: Parallel Streaming (Multiple Agents)');
  console.log('─'.repeat(60));

  const text = 'Async/await is syntactic sugar over promises in JavaScript, making asynchronous code look and behave more like synchronous code.';

  console.log('\nProcessing text with two agents in parallel...');
  console.log(`Text: "${text}"\n`);

  try {
    // Start both streams
    const summaryStream = codexModel.getStreamedResponse({
      systemInstructions: 'Provide concise summaries of text.',
      input: `Summarize: ${text}`,
      modelSettings: {},
      tools: [],
      outputType: { type: 'text' },
      handoffs: [],
      tracing: { enabled: false },
    });
    
    const questionStream = codexModel.getStreamedResponse({
      systemInstructions: 'Generate insightful questions about text.',
      input: `Generate 2 questions about: ${text}`,
      modelSettings: {},
      tools: [],
      outputType: { type: 'text' },
      handoffs: [],
      tracing: { enabled: false },
    });

    // Process both streams concurrently
    const results = await Promise.all([
      (async () => {
        console.log('[Summarizer] Starting...');
        let output = '';
        for await (const event of summaryStream) {
          if (event.type === 'output_text_delta') {
            output += event.delta;
          } else if (event.type === 'output_text_done') {
            console.log('[Summarizer] Complete:', output.substring(0, 100) + '...');
          }
        }
      })(),
      (async () => {
        console.log('[QuestionGenerator] Starting...');
        let output = '';
        for await (const event of questionStream) {
          if (event.type === 'output_text_delta') {
            output += event.delta;
          } else if (event.type === 'output_text_done') {
            console.log('[QuestionGenerator] Complete:', output.substring(0, 100) + '...');
          }
        }
      })(),
    ]);

    console.log('\n✓ Both streams completed!');
  } catch (error) {
    console.log('\n✗ Parallel streaming failed:', error instanceof Error ? error.message : String(error));
  }

  // ============================================================================
  // Summary
  // ============================================================================

  console.log('\n' + '='.repeat(60));
  console.log('✓ Streaming Examples Complete!');
  console.log('='.repeat(60));
  console.log('\nKey Takeaways:');
  console.log('  • Streaming provides real-time feedback to users');
  console.log('  • Different event types enable rich progress tracking');
  console.log('  • Reasoning events show agent thought process');
  console.log('  • Multiple streams can run in parallel');
  console.log('  • CodexProvider fully supports streaming responses');

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

