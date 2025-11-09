/**
 * Example: Multi-Agent Handoffs with CodexProvider
 *
 * This example demonstrates agent handoffs - where one agent can delegate
 * specific tasks to specialized agents. This is useful for complex workflows
 * that require different expertise at different stages.
 *
 * Key concepts:
 * - Creating specialized agents with specific instructions
 * - Using agent handoffs to delegate tasks
 * - Maintaining context across agent transitions
 * - Orchestrating multi-step workflows
 *
 * Installation:
 * ```bash
 * npm install @codex-native/sdk @openai/agents zod
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/agents/multi-agent-handoffs.ts
 * ```
 */

import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { Agent, run, withTrace } from '@openai/agents';
import { CodexProvider } from '../../src/index';

function cleanupTmpDir(dir: string) {
  try {
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'rd', '/s', '/q', dir], { detached: true, stdio: 'ignore' });
      child.unref();
      return;
    }

    const child = spawn('rm', ['-rf', dir], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    void fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  console.log('🔄 Multi-Agent Handoffs Example\n');
  console.log('This example demonstrates how specialized agents can work together');
  console.log('by handing off tasks to each other based on their expertise.\n');

  // Create a temporary directory
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-handoffs-'));
  console.log(`Working directory: ${tmpDir}\n`);

  // Create Codex provider
  const codexProvider = new CodexProvider({
    defaultModel: 'gpt-5-codex',
    workingDirectory: tmpDir,
    skipGitRepoCheck: true,
  });

  const codexModel = await codexProvider.getModel();

  // ============================================================================
  // Define Specialized Agents
  // ============================================================================

  // Triage Agent: Analyzes requests and routes to appropriate specialists
  const triageAgent = new Agent({
    name: 'TriageAgent',
    model: codexModel,
    instructions: `You are a triage agent that analyzes user requests and determines 
the best specialist to handle them. You should:
- Analyze the request to understand what type of work is needed
- Explain your reasoning for the handoff
- Provide context to help the specialist understand the task

Available specialists:
- CodeReviewer: Reviews code for quality, bugs, and best practices
- TestWriter: Writes unit tests and integration tests
- DocumentationWriter: Creates clear, comprehensive documentation
- PerformanceOptimizer: Analyzes and improves code performance`,
  });

  // Code Review Agent: Specializes in code quality and best practices
  const codeReviewAgent = new Agent({
    name: 'CodeReviewer',
    model: codexModel,
    instructions: `You are an expert code reviewer. You analyze code for:
- Code quality and maintainability
- Potential bugs and edge cases
- Best practices and design patterns
- Security vulnerabilities
- Performance issues

Provide specific, actionable feedback with examples.`,
  });

  // Test Writer Agent: Specializes in writing tests
  const testWriterAgent = new Agent({
    name: 'TestWriter',
    model: codexModel,
    instructions: `You are an expert test writer. You create:
- Comprehensive unit tests
- Integration tests
- Edge case coverage
- Mock implementations when needed

Follow testing best practices and ensure high code coverage.`,
  });

  // Documentation Writer Agent: Specializes in documentation
  const docWriterAgent = new Agent({
    name: 'DocumentationWriter',
    model: codexModel,
    instructions: `You are a technical documentation specialist. You create:
- Clear API documentation
- Usage examples
- Architecture explanations
- Setup and configuration guides

Write for both beginner and advanced users.`,
  });

  // ============================================================================
  // Example 1: Simple Handoff Chain
  // ============================================================================

  console.log('Example 1: Code Review → Test Writing Chain');
  console.log('─'.repeat(60));

  await withTrace('Code Review Chain', async () => {
    // First, have a simple JavaScript function for demo purposes
    const sampleCode = `
function calculateDiscount(price, discountPercent) {
  return price - (price * discountPercent / 100);
}
`;

    console.log('Sample code to review:');
    console.log(sampleCode);
    console.log();

    // Step 1: Code review
    console.log('[Step 1] Code Reviewer analyzing code...');
    const reviewResult = await run(
      codeReviewAgent,
      `Review this JavaScript function and suggest improvements:\n\n${sampleCode}`
    );
    console.log('\nReview Result:', reviewResult.finalOutput.substring(0, 200) + '...\n');

    // Step 2: Write tests based on review
    console.log('[Step 2] Test Writer creating tests based on review...');
    const testResult = await run(
      testWriterAgent,
      `Based on this code review, write comprehensive unit tests:

Original code:
${sampleCode}

Review feedback:
${reviewResult.finalOutput}

Create tests that cover the cases mentioned in the review.`
    );
    console.log('\nTest Result:', testResult.finalOutput.substring(0, 200) + '...\n');
  });

  // ============================================================================
  // Example 2: Dynamic Agent Selection with Triage
  // ============================================================================

  console.log('\n' + '='.repeat(60));
  console.log('Example 2: Dynamic Agent Selection via Triage');
  console.log('─'.repeat(60));

  await withTrace('Dynamic Agent Selection', async () => {
    const userRequests = [
      'I need help understanding how async/await works in JavaScript',
      'Can you write tests for my authentication module?',
      'My application is running slowly, help me optimize it',
    ];

    for (const request of userRequests) {
      console.log(`\nUser Request: "${request}"`);
      console.log('Triage Agent analyzing...');

      const triageResult = await run(
        triageAgent,
        `Analyze this request and recommend which specialist should handle it: "${request}"`
      );

      console.log('Triage Decision:', triageResult.finalOutput.substring(0, 150) + '...\n');

      // In a real implementation, you would parse the triage result
      // and dynamically route to the appropriate specialist agent
      // For this demo, we'll just show the triage decision
    }
  });

  // ============================================================================
  // Example 3: Collaborative Multi-Agent Workflow
  // ============================================================================

  console.log('\n' + '='.repeat(60));
  console.log('Example 3: Collaborative Workflow (Review → Test → Document)');
  console.log('─'.repeat(60));

  await withTrace('Collaborative Workflow', async () => {
    const featureCode = `
class UserAuthenticator {
  constructor(database) {
    this.db = database;
  }

  async authenticate(username, password) {
    const user = await this.db.findUser(username);
    if (!user) return null;
    
    const isValid = await this.comparePassword(password, user.passwordHash);
    return isValid ? user : null;
  }

  async comparePassword(password, hash) {
    // Simplified for demo
    return password === hash;
  }
}
`;

    console.log('Feature code:');
    console.log(featureCode);
    console.log();

    // Step 1: Review
    console.log('[1/3] CodeReviewer analyzing...');
    const review = await run(
      codeReviewAgent,
      `Review this authentication class for security and quality:\n\n${featureCode}`
    );
    console.log('✓ Review complete\n');

    // Step 2: Write tests
    console.log('[2/3] TestWriter creating test suite...');
    const tests = await run(
      testWriterAgent,
      `Create a comprehensive test suite for this class:\n\n${featureCode}\n\nConsider review feedback:\n${review.finalOutput}`
    );
    console.log('✓ Tests complete\n');

    // Step 3: Document
    console.log('[3/3] DocumentationWriter creating docs...');
    const docs = await run(
      docWriterAgent,
      `Create API documentation for this class:\n\n${featureCode}\n\nInclude examples and security notes from:\n${review.finalOutput}`
    );
    console.log('✓ Documentation complete\n');

    console.log('Workflow Summary:');
    console.log('  • Code reviewed for security and best practices');
    console.log('  • Test suite created with edge case coverage');
    console.log('  • API documentation generated with examples');
    console.log('  • All work coordinated across 3 specialized agents');
  });

  // ============================================================================
  // Summary
  // ============================================================================

  console.log('\n' + '='.repeat(60));
  console.log('✓ Multi-Agent Handoff Examples Complete!');
  console.log('='.repeat(60));
  console.log('\nKey Takeaways:');
  console.log('  • Specialized agents can handle specific types of work');
  console.log('  • Triage agents can route requests to the right specialist');
  console.log('  • Multi-step workflows can chain multiple agents');
  console.log('  • Context is preserved across handoffs');
  console.log('  • CodexProvider enables all agents to use Codex capabilities');

  cleanupTmpDir(tmpDir);
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

