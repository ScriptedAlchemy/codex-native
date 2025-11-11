/**
 * Example: Tracing and Debugging with CodexProvider
 *
 * This example demonstrates how to use tracing in the OpenAI Agents framework
 * with CodexProvider. Tracing enables you to visualize, debug, and monitor
 * your agent workflows.
 *
 * Based on OpenAI Agents SDK documentation:
 * https://openai.github.io/openai-agents-js/guides/tracing
 *
 * Installation:
 * ```bash
 * npm install @codex-native/sdk @openai/agents
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/agents/agents-tracing.ts
 * ```
 *
 * Key features demonstrated:
 * - Enabling tracing for agent workflows
 * - Viewing trace information
 * - Debugging agent behavior
 * - Monitoring performance
 * - Using CodexProvider as the model backend
 */

import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Agent, run, withTrace } from '@openai/agents';
import { CodexProvider } from '../../src/index';

async function main() {
  console.log('🔍 Tracing and Debugging with CodexProvider\n');
  console.log('This example demonstrates how to trace and debug agent workflows.\n');

  // Create a temporary directory to avoid loading workspace AGENTS.md
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-tracing-example-'));
  console.log(`Using temporary directory: ${tmpDir}\n`);

  // Create Codex provider
  const codexProvider = new CodexProvider({
    defaultModel: 'gpt-5-codex',
    workingDirectory: tmpDir,
    skipGitRepoCheck: true,
  });

  const codexModel = await codexProvider.getModel();

  // ============================================================================
  // Example 1: Basic Tracing with withTrace
  // ============================================================================
  console.log('Example 1: Basic Tracing with withTrace');
  console.log('─'.repeat(60));

  const tracedAgent = new Agent({
    name: 'TracedAgent',
    model: codexModel,
    instructions: 'You are a helpful assistant. Think step by step.',
  });

  console.log('\nQuery: "Explain how tracing works in AI agents"\n');

  await withTrace('Basic Tracing Example', async () => {
    const result = await run(tracedAgent, 'Explain how tracing works in AI agents');
    console.log('\n[Response]');
    console.log((result.finalOutput ?? '').substring(0, 200) + '...');
    console.log('\n✓ Trace captured');
  });

  console.log('\n✓ Example 1 completed');

  // ============================================================================
  // Example 2: Nested Tracing
  // ============================================================================
  console.log('\n\nExample 2: Nested Tracing');
  console.log('─'.repeat(60));

  const nestedAgent = new Agent({
    name: 'NestedAgent',
    model: codexModel,
    instructions: 'You are a helpful assistant that breaks down complex tasks.',
  });

  console.log('\nQuery: "Break down the steps to build a web application"\n');

  await withTrace('Nested Tracing Example', async () => {
    await withTrace('Step 1: Planning', async () => {
      const plan = await run(nestedAgent, 'Create a plan for building a web application');
      console.log('\n[Planning Step]');
      console.log((plan.finalOutput ?? '').substring(0, 150) + '...');
    });

    await withTrace('Step 2: Implementation', async () => {
      const implementation = await run(
        nestedAgent,
        'Describe the implementation phase'
      );
      console.log('\n[Implementation Step]');
      console.log((implementation.finalOutput ?? '').substring(0, 150) + '...');
    });

    await withTrace('Step 3: Testing', async () => {
      const testing = await run(nestedAgent, 'Describe the testing phase');
      console.log('\n[Testing Step]');
      console.log((testing.finalOutput ?? '').substring(0, 150) + '...');
    });

    console.log('\n✓ Nested traces captured');
  });

  console.log('\n✓ Example 2 completed');

  // ============================================================================
  // Example 3: Tracing with Performance Monitoring
  // ============================================================================
  console.log('\n\nExample 3: Tracing with Performance Monitoring');
  console.log('─'.repeat(60));

  const performanceAgent = new Agent({
    name: 'PerformanceAgent',
    model: codexModel,
    instructions: 'You are a helpful assistant.',
  });

  console.log('\nQuery: "Explain performance optimization"\n');

  await withTrace('Performance Monitoring', async () => {
    const startTime = Date.now();

    const result = await run(performanceAgent, 'Explain performance optimization');

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log('\n[Performance Metrics]');
    console.log(`  Duration: ${duration}ms`);
    const usage = (result as any).usage;
    console.log(`  Input tokens: ${usage?.inputTokens ?? 'N/A'}`);
    console.log(`  Output tokens: ${usage?.outputTokens ?? 'N/A'}`);
    console.log(`  Total tokens: ${usage?.totalTokens ?? 'N/A'}`);

    if (usage?.totalTokens) {
      const tokensPerSecond = (usage.totalTokens / duration) * 1000;
      console.log(`  Tokens/second: ${tokensPerSecond.toFixed(2)}`);
    }

    console.log('\n[Response]');
    console.log((result.finalOutput ?? '').substring(0, 200) + '...');
  });

  console.log('\n✓ Example 3 completed');

  // ============================================================================
  // Example 4: Tracing Multi-Agent Workflow
  // ============================================================================
  console.log('\n\nExample 4: Tracing Multi-Agent Workflow');
  console.log('─'.repeat(60));

  const agent1 = new Agent({
    name: 'Agent1',
    model: codexModel,
    instructions: 'You are the first agent in a workflow.',
  });

  const agent2 = new Agent({
    name: 'Agent2',
    model: codexModel,
    instructions: 'You are the second agent in a workflow.',
  });

  console.log('\nQuery: "Work together to solve a problem"\n');

  await withTrace('Multi-Agent Workflow', async () => {
    await withTrace('Agent 1: Problem Analysis', async () => {
      const analysis = await run(
        agent1,
        'Analyze the problem: How to improve code quality?'
      );
      console.log('\n[Agent 1 Output]');
      console.log((analysis.finalOutput ?? '').substring(0, 150) + '...');
    });

    await withTrace('Agent 2: Solution Proposal', async () => {
      const solution = await run(
        agent2,
        'Propose solutions for improving code quality'
      );
      console.log('\n[Agent 2 Output]');
      console.log((solution.finalOutput ?? '').substring(0, 150) + '...');
    });

    console.log('\n✓ Multi-agent trace captured');
  });

  console.log('\n✓ Example 4 completed');

  // ============================================================================
  // Example 5: Error Tracing
  // ============================================================================
  console.log('\n\nExample 5: Error Tracing');
  console.log('─'.repeat(60));

  const errorAgent = new Agent({
    name: 'ErrorAgent',
    model: codexModel,
    instructions: 'You are a helpful assistant.',
  });

  console.log('\nQuery: "This should work normally"\n');

  try {
    await withTrace('Error Tracing Example', async () => {
      const result = await run(errorAgent, 'This should work normally');
      console.log('\n[Response]');
      console.log((result.finalOutput ?? '').substring(0, 200) + '...');
      console.log('\n✓ No errors occurred');
    });
  } catch (error) {
    console.log('\n[Error Captured in Trace]');
    console.log('  Error:', error instanceof Error ? error.message : String(error));
    console.log('  Stack:', error instanceof Error ? error.stack : 'N/A');
  }

  console.log('\n✓ Example 5 completed');

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('\n\n' + '='.repeat(60));
  console.log('📋 Summary');
  console.log('='.repeat(60));
  console.log('\nKey takeaways:');
  console.log('  • Tracing helps visualize and debug agent workflows');
  console.log('  • Use withTrace() to wrap agent executions');
  console.log('  • Nested traces show hierarchical workflow structure');
  console.log('  • Traces capture performance metrics and token usage');
  console.log('  • Error traces help debug failures');
  console.log('  • CodexProvider integrates seamlessly with tracing');
  console.log('\nTracing features:');
  console.log('  • Visualize agent execution flow');
  console.log('  • Monitor performance and token usage');
  console.log('  • Debug errors and failures');
  console.log('  • Analyze multi-agent workflows');
  console.log('  • Export traces for analysis');
  console.log('\nFor more information, see:');
  console.log('  https://openai.github.io/openai-agents-js/guides/tracing');

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

