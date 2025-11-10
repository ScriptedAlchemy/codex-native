/**
 * Example: Structured Output with JSON Schemas
 *
 * This example demonstrates how to use JSON schemas to get structured,
 * validated output from agents. This is essential for building reliable
 * systems that need predictable data formats.
 *
 * Key concepts:
 * - Defining JSON schemas for structured output
 * - Using zod for type-safe schema definition
 * - Validating agent responses against schemas
 * - Extracting structured data for downstream processing
 *
 * Installation:
 * ```bash
 * npm install @codex-native/sdk @openai/agents zod
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/agents/structured-output.ts
 * ```
 */

import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { Agent, run, withTrace } from '@openai/agents';
import { CodexProvider } from '../../src/index';

// ============================================================================
// Define Schemas with Zod
// ============================================================================

// Schema for code analysis results
const CodeAnalysisSchema = z.object({
  complexity: z.enum(['low', 'medium', 'high']),
  maintainability: z.number().min(0).max(10),
  issues: z.array(
    z.object({
      severity: z.enum(['info', 'warning', 'error']),
      category: z.string(),
      description: z.string(),
      line: z.number().optional(),
    })
  ),
  suggestions: z.array(z.string()),
  summary: z.string(),
});

// Schema for test plan
const TestPlanSchema = z.object({
  testCases: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      type: z.enum(['unit', 'integration', 'e2e']),
      priority: z.enum(['high', 'medium', 'low']),
      estimatedTime: z.string(),
    })
  ),
  coverage: z.object({
    expectedPercentage: z.number().min(0).max(100),
    criticalPaths: z.array(z.string()),
  }),
  dependencies: z.array(z.string()),
});

// Schema for API documentation
const APIDocSchema = z.object({
  endpoints: z.array(
    z.object({
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
      path: z.string(),
      description: z.string(),
      parameters: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          required: z.boolean(),
          description: z.string(),
        })
      ),
      responses: z.array(
        z.object({
          status: z.number(),
          description: z.string(),
        })
      ),
    })
  ),
});

// Schema for performance metrics
const PerformanceAnalysisSchema = z.object({
  metrics: z.object({
    timeComplexity: z.string(),
    spaceComplexity: z.string(),
    estimatedExecutionTime: z.string(),
  }),
  bottlenecks: z.array(
    z.object({
      location: z.string(),
      issue: z.string(),
      impact: z.enum(['low', 'medium', 'high']),
    })
  ),
  optimizations: z.array(
    z.object({
      description: z.string(),
      expectedImprovement: z.string(),
      difficulty: z.enum(['easy', 'medium', 'hard']),
    })
  ),
});

async function main() {
  console.log('📊 Structured Output with JSON Schemas\n');
  console.log('This example shows how to get validated, structured data from agents');
  console.log('using JSON schemas for reliable, type-safe outputs.\n');

  // Create a temporary directory
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-structured-'));
  console.log(`Working directory: ${tmpDir}\n`);

  // Create Codex provider
  const codexProvider = new CodexProvider({
    defaultModel: 'gpt-5-codex',
    workingDirectory: tmpDir,
    skipGitRepoCheck: true,
  });

  const codexModel = await codexProvider.getModel();

  // ============================================================================
  // Example 1: Code Analysis with Structured Output
  // ============================================================================

  console.log('Example 1: Code Analysis with Structured Output');
  console.log('─'.repeat(60));

  const analysisAgent = new Agent({
    name: 'CodeAnalyzer',
    model: codexModel,
    instructions: `You are a code analysis expert. Analyze code for complexity,
maintainability, and issues. Provide structured output with specific metrics
and actionable suggestions.`,
    outputSchema: CodeAnalysisSchema,
  });

  await withTrace('Code Analysis', async () => {
    const sampleCode = `
function processUserData(users) {
  let result = [];
  for (let i = 0; i < users.length; i++) {
    if (users[i].active) {
      let userData = {
        name: users[i].name,
        email: users[i].email,
        lastActive: new Date(users[i].lastActiveDate)
      };
      result.push(userData);
    }
  }
  return result;
}
`;

    console.log('Analyzing code...');
    console.log(sampleCode);

    const result = await run(
      analysisAgent,
      `Analyze this JavaScript function:\n\n${sampleCode}`,
      { outputType: CodeAnalysisSchema }
      `Analyze this JavaScript function:\n\n${sampleCode}`
    );

    // The output is now structured according to our schema
    try {
      const analysis = JSON.parse(result.finalOutput);
      console.log('\n✓ Structured Analysis Result:');
      console.log(`  Complexity: ${analysis.complexity}`);
      console.log(`  Maintainability: ${analysis.maintainability}/10`);
      console.log(`  Issues Found: ${analysis.issues?.length || 0}`);
      console.log(`  Suggestions: ${analysis.suggestions?.length || 0}`);

      if (analysis.issues && analysis.issues.length > 0) {
        console.log('\n  Top Issues:');
        analysis.issues.slice(0, 3).forEach((issue: any, idx: number) => {
          console.log(`    ${idx + 1}. [${issue.severity}] ${issue.description}`);
        });
      }
    } catch (e) {
      console.log('Response:', result.finalOutput);
    }
  });

  // ============================================================================
  // Example 2: Test Plan Generation
  // ============================================================================

  console.log('\n' + '='.repeat(60));
  console.log('Example 2: Test Plan with Structured Output');
  console.log('─'.repeat(60));

  const testPlannerAgent = new Agent({
    name: 'TestPlanner',
    model: codexModel,
    instructions: `You are a test planning expert. Create comprehensive test plans
with detailed test cases, coverage goals, and dependencies.`,
    outputSchema: TestPlanSchema,
  });

  await withTrace('Test Planning', async () => {
    const feature = 'User authentication system with email verification';

    console.log(`\nGenerating test plan for: ${feature}`);

    const result = await run(
      testPlannerAgent,
      `Create a comprehensive test plan for: ${feature}`,
      { outputType: TestPlanSchema }
      `Create a comprehensive test plan for: ${feature}`
    );

    try {
      const testPlan = JSON.parse(result.finalOutput);
      console.log('\n✓ Structured Test Plan:');
      console.log(`  Test Cases: ${testPlan.testCases?.length || 0}`);
      console.log(`  Expected Coverage: ${testPlan.coverage?.expectedPercentage}%`);
      console.log(`  Dependencies: ${testPlan.dependencies?.length || 0}`);

      if (testPlan.testCases && testPlan.testCases.length > 0) {
        console.log('\n  Sample Test Cases:');
        testPlan.testCases.slice(0, 3).forEach((tc: any, idx: number) => {
          console.log(`    ${idx + 1}. [${tc.priority}] ${tc.name}`);
          console.log(`       Type: ${tc.type} | Est: ${tc.estimatedTime}`);
        });
      }
    } catch (e) {
      console.log('Response:', result.finalOutput);
    }
  });

  // ============================================================================
  // Example 3: API Documentation Generation
  // ============================================================================

  console.log('\n' + '='.repeat(60));
  console.log('Example 3: API Documentation with Structured Output');
  console.log('─'.repeat(60));

  const apiDocAgent = new Agent({
    name: 'APIDocumenter',
    model: codexModel,
    instructions: `You are an API documentation expert. Generate comprehensive
API documentation with endpoints, parameters, and response formats.`,
    outputSchema: APIDocSchema,
  });

  await withTrace('API Documentation', async () => {
    const apiCode = `
// User management API
router.get('/users', listUsers);
router.post('/users', createUser);
router.get('/users/:id', getUser);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);
`;

    console.log('\nGenerating API docs for:');
    console.log(apiCode);

    const result = await run(
      apiDocAgent,
      `Generate API documentation for these endpoints:\n\n${apiCode}`,
      { outputType: APIDocSchema }
      `Generate API documentation for these endpoints:\n\n${apiCode}`
    );

    try {
      const apiDocs = JSON.parse(result.finalOutput);
      console.log('\n✓ Structured API Documentation:');
      console.log(`  Endpoints: ${apiDocs.endpoints?.length || 0}`);

      if (apiDocs.endpoints && apiDocs.endpoints.length > 0) {
        console.log('\n  Endpoint Details:');
        apiDocs.endpoints.forEach((ep: any, idx: number) => {
          console.log(`    ${idx + 1}. ${ep.method} ${ep.path}`);
          console.log(`       ${ep.description}`);
          console.log(`       Parameters: ${ep.parameters?.length || 0}`);
        });
      }
    } catch (e) {
      console.log('Response:', result.finalOutput);
    }
  });

  // ============================================================================
  // Example 4: Performance Analysis
  // ============================================================================

  console.log('\n' + '='.repeat(60));
  console.log('Example 4: Performance Analysis with Structured Output');
  console.log('─'.repeat(60));

  const perfAgent = new Agent({
    name: 'PerformanceAnalyzer',
    model: codexModel,
    instructions: `You are a performance optimization expert. Analyze code for
complexity, bottlenecks, and optimization opportunities.`,
    outputSchema: PerformanceAnalysisSchema,
  });

  await withTrace('Performance Analysis', async () => {
    const algorithmCode = `
function findDuplicates(array) {
  const duplicates = [];
  for (let i = 0; i < array.length; i++) {
    for (let j = i + 1; j < array.length; j++) {
      if (array[i] === array[j] && !duplicates.includes(array[i])) {
        duplicates.push(array[i]);
      }
    }
  }
  return duplicates;
}
`;

    console.log('\nAnalyzing performance of:');
    console.log(algorithmCode);

    const result = await run(
      perfAgent,
      `Analyze the performance of this algorithm:\n\n${algorithmCode}`,
      { outputType: PerformanceAnalysisSchema }
      `Analyze the performance of this algorithm:\n\n${algorithmCode}`
    );

    try {
      const perfAnalysis = JSON.parse(result.finalOutput);
      console.log('\n✓ Structured Performance Analysis:');
      console.log(`  Time Complexity: ${perfAnalysis.metrics?.timeComplexity}`);
      console.log(`  Space Complexity: ${perfAnalysis.metrics?.spaceComplexity}`);
      console.log(`  Bottlenecks: ${perfAnalysis.bottlenecks?.length || 0}`);
      console.log(`  Optimizations: ${perfAnalysis.optimizations?.length || 0}`);

      if (perfAnalysis.optimizations && perfAnalysis.optimizations.length > 0) {
        console.log('\n  Recommended Optimizations:');
        perfAnalysis.optimizations.forEach((opt: any, idx: number) => {
          console.log(`    ${idx + 1}. [${opt.difficulty}] ${opt.description}`);
          console.log(`       Expected: ${opt.expectedImprovement}`);
        });
      }
    } catch (e) {
      console.log('Response:', result.finalOutput);
    }
  });

  // ============================================================================
  // Summary
  // ============================================================================

  console.log('\n' + '='.repeat(60));
  console.log('✓ Structured Output Examples Complete!');
  console.log('='.repeat(60));
  console.log('\nKey Takeaways:');
  console.log('  • JSON schemas ensure predictable output formats');
  console.log('  • Zod provides type-safe schema definitions');
  console.log('  • Structured output enables reliable automation');
  console.log('  • Different domains benefit from domain-specific schemas');
  console.log('  • CodexProvider seamlessly supports structured output');

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

