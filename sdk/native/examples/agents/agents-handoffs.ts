/**
 * Example: Agent Handoffs with CodexProvider
 *
 * This example demonstrates how to use agent handoffs in the OpenAI Agents framework
 * with CodexProvider. Handoffs allow agents to delegate tasks to other specialized agents.
 *
 * Based on OpenAI Agents SDK documentation:
 * https://openai.github.io/openai-agents-js/guides/handoffs
 *
 * Installation:
 * ```bash
 * npm install @codex-native/sdk @openai/agents
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/agents/agents-handoffs.ts
 * ```
 *
 * Key features demonstrated:
 * - Creating specialized agents for different tasks
 * - Handing off tasks between agents
 * - Maintaining conversation context across handoffs
 * - Using CodexProvider as the model backend
 */

import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Agent, run, handoff } from '@openai/agents';
import { CodexProvider } from '../../src/index';
import { runExampleStep } from '../utils';

async function main() {
  console.log('🤝 Agent Handoffs with CodexProvider\n');
  console.log('This example demonstrates how agents can delegate tasks to other agents.\n');

  // Create a temporary directory to avoid loading workspace AGENTS.md
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-handoffs-example-'));
  console.log(`Using temporary directory: ${tmpDir}\n`);

  // Create Codex provider
  const codexProvider = new CodexProvider({
    defaultModel: 'gpt-5-codex',
    workingDirectory: tmpDir,
    skipGitRepoCheck: true,
  });

  const codexModel = await codexProvider.getModel();

  // ============================================================================
  // Example 1: Simple Handoff - Code Reviewer to Test Writer
  // ============================================================================
  console.log('Example 1: Code Reviewer → Test Writer Handoff');
  console.log('─'.repeat(60));

  const codeReviewer = new Agent({
    name: 'CodeReviewer',
    model: codexModel,
    instructions: `You are a senior code reviewer. Your job is to:
- Review code for bugs, security issues, and best practices
- Identify areas that need tests
- When you find code that needs tests, hand off to the TestWriter agent
- Be concise and focused in your reviews`,
  });

  const testWriter = new Agent({
    name: 'TestWriter',
    model: codexModel,
    instructions: `You are a test writing specialist. Your job is to:
- Write comprehensive unit tests
- Ensure high test coverage
- Write clear, maintainable test code
- Explain your testing approach`,
  });

  // Configure handoff: CodeReviewer can hand off to TestWriter
  codeReviewer.handoffs = [handoff(testWriter, {
    when: 'code needs tests',
  })];

  console.log('\nQuery: "Review this function and ensure it has tests: function add(a, b) { return a + b; }"\n');

  const reviewResult = await runExampleStep('Code review handoff', () =>
    run(
      codeReviewer,
      'Review this function and ensure it has tests: function add(a, b) { return a + b; }'
    )
  );

  if (reviewResult) {
    console.log('\n[Review Result]');
    console.log(reviewResult.finalOutput);
    console.log('\n✓ Example 1 completed');
  } else {
    console.log('Skipping Example 1 output due to a connection issue.');
  }

  // ============================================================================
  // Example 2: Multi-Agent Chain - Architect → Developer → QA
  // ============================================================================
  console.log('\n\nExample 2: Multi-Agent Chain (Architect → Developer → QA)');
  console.log('─'.repeat(60));

  const architect = new Agent({
    name: 'Architect',
    model: codexModel,
    instructions: `You are a software architect. Your job is to:
- Design system architecture
- Create high-level plans
- When implementation is needed, hand off to Developer
- Focus on design patterns and structure`,
  });

  const developer = new Agent({
    name: 'Developer',
    model: codexModel,
    instructions: `You are a software developer. Your job is to:
- Implement code based on architectural designs
- Write clean, maintainable code
- When code is ready for testing, hand off to QA
- Follow best practices`,
  });

  const qa = new Agent({
    name: 'QA',
    model: codexModel,
    instructions: `You are a QA specialist. Your job is to:
- Review code for quality and correctness
- Suggest improvements
- Verify code meets requirements
- Provide final approval or feedback`,
  });

  // Set up handoff chain
  architect.handoffs = [handoff(developer, {
    when: 'implementation is needed',
  })];

  developer.handoffs = [handoff(qa, {
    when: 'code is ready for QA review',
  })];

  console.log('\nQuery: "Design a user authentication system"\n');

  const architectureResult = await runExampleStep('Architecture handoff', () =>
    run(architect, 'Design a user authentication system')
  );

  if (architectureResult) {
    console.log('\n[Architecture Result]');
    console.log(architectureResult.finalOutput);
    console.log('\n✓ Example 2 completed');
  } else {
    console.log('Skipping Example 2 output due to a connection issue.');
  }

  // ============================================================================
  // Example 3: Conditional Handoff - Router Agent
  // ============================================================================
  console.log('\n\nExample 3: Router Agent with Conditional Handoffs');
  console.log('─'.repeat(60));

  const router = new Agent({
    name: 'Router',
    model: codexModel,
    instructions: `You are a task router. Your job is to:
- Analyze incoming requests
- Route to the appropriate specialist agent
- Route bug reports to BugFixer
- Route feature requests to FeatureDeveloper
- Route questions to SupportAgent`,
  });

  const bugFixer = new Agent({
    name: 'BugFixer',
    model: codexModel,
    instructions: `You are a bug fixing specialist. Your job is to:
- Identify root causes of bugs
- Propose fixes
- Test solutions
- Document the fix`,
  });

  const featureDeveloper = new Agent({
    name: 'FeatureDeveloper',
    model: codexModel,
    instructions: `You are a feature development specialist. Your job is to:
- Design new features
- Implement features
- Write documentation
- Ensure backward compatibility`,
  });

  const supportAgent = new Agent({
    name: 'SupportAgent',
    model: codexModel,
    instructions: `You are a support specialist. Your job is to:
- Answer user questions
- Provide helpful guidance
- Escalate complex issues
- Be friendly and professional`,
  });

  // Configure multiple handoffs
  router.handoffs = [
    handoff(bugFixer, { when: 'bug report or error' }),
    handoff(featureDeveloper, { when: 'feature request' }),
    handoff(supportAgent, { when: 'question or help needed' }),
  ];

  console.log('\nQuery: "I found a bug where the login button doesn\'t work"\n');

  const routerResult = await runExampleStep('Router handoff', () =>
    run(router, "I found a bug where the login button doesn't work")
  );

  if (routerResult) {
    console.log('\n[Router Result]');
    console.log(routerResult.finalOutput);
    console.log('\n✓ Example 3 completed');
  } else {
    console.log('Skipping Example 3 output due to a connection issue.');
  }

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('\n\n' + '='.repeat(60));
  console.log('📋 Summary');
  console.log('='.repeat(60));
  console.log('\nKey takeaways:');
  console.log('  • Handoffs allow agents to delegate to specialized agents');
  console.log('  • Conversation context is maintained across handoffs');
  console.log('  • CodexProvider works seamlessly with handoff patterns');
  console.log('  • Multiple handoffs can be configured per agent');
  console.log('  • Handoffs enable complex multi-agent workflows');
  console.log('\nFor more information, see:');
  console.log('  https://openai.github.io/openai-agents-js/guides/handoffs');

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

