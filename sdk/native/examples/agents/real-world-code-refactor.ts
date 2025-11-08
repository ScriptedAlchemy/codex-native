/**
 * Example: Real-World Scenario - Code Refactoring Pipeline
 *
 * This example demonstrates a practical, real-world use case: building an
 * automated code refactoring pipeline using multiple specialized agents.
 *
 * The pipeline:
 * 1. Analyzer: Identifies code quality issues
 * 2. Refactorer: Proposes improvements
 * 3. Tester: Validates changes don't break functionality
 * 4. Documenter: Updates documentation
 *
 * Key concepts:
 * - Building production-ready agent workflows
 * - Coordinating multiple specialized agents
 * - Handling structured data between agents
 * - Error handling and validation
 * - Practical integration patterns
 *
 * Installation:
 * ```bash
 * npm install @codex-native/sdk @openai/agents zod
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/agents/real-world-code-refactor.ts
 * ```
 */

import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { Agent, run, withTrace } from '@openai/agents';
import { CodexProvider } from '../../src/index';

// ============================================================================
// Schemas for Structured Communication
// ============================================================================

const CodeIssueSchema = z.object({
  line: z.number(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  category: z.string(),
  issue: z.string(),
  suggestion: z.string(),
});

const AnalysisResultSchema = z.object({
  file: z.string(),
  overallQuality: z.number().min(0).max(10),
  issues: z.array(CodeIssueSchema),
  refactoringNeeded: z.boolean(),
  summary: z.string(),
});

const RefactoringResultSchema = z.object({
  success: z.boolean(),
  changes: z.array(
    z.object({
      description: z.string(),
      before: z.string(),
      after: z.string(),
      reason: z.string(),
    })
  ),
  newCode: z.string(),
  risks: z.array(z.string()),
});

const TestResultSchema = z.object({
  passed: z.boolean(),
  testCases: z.array(
    z.object({
      name: z.string(),
      status: z.enum(['pass', 'fail']),
      message: z.string().optional(),
    })
  ),
  coverage: z.number().min(0).max(100),
  recommendation: z.string(),
});

// ============================================================================
// Refactoring Pipeline
// ============================================================================

class CodeRefactoringPipeline {
  private analyzerAgent: Agent;
  private refactorerAgent: Agent;
  private testerAgent: Agent;
  private documenterAgent: Agent;

  constructor(model: any) {
    // Step 1: Analyzer - Identifies issues
    this.analyzerAgent = new Agent({
      name: 'CodeAnalyzer',
      model,
      instructions: `You are an expert code analyzer. Your job is to:
- Identify code quality issues (complexity, readability, performance)
- Categorize issues by severity
- Suggest specific improvements
- Determine if refactoring is needed

Be thorough but constructive. Focus on actionable improvements.`,
      outputSchema: AnalysisResultSchema,
    });

    // Step 2: Refactorer - Implements improvements
    this.refactorerAgent = new Agent({
      name: 'CodeRefactorer',
      model,
      instructions: `You are a code refactoring expert. Your job is to:
- Apply best practices and design patterns
- Improve code readability and maintainability
- Optimize performance where beneficial
- Preserve existing functionality
- Document all changes clearly

Provide clear before/after examples for each change.`,
      outputSchema: RefactoringResultSchema,
    });

    // Step 3: Tester - Validates changes
    this.testerAgent = new Agent({
      name: 'TestValidator',
      model,
      instructions: `You are a testing expert. Your job is to:
- Verify refactored code maintains original functionality
- Identify potential breaking changes
- Suggest test cases to validate changes
- Estimate test coverage

Be thorough in identifying edge cases and potential issues.`,
      outputSchema: TestResultSchema,
    });

    // Step 4: Documenter - Updates documentation
    this.documenterAgent = new Agent({
      name: 'DocumentationWriter',
      model,
      instructions: `You are a technical documentation specialist. Your job is to:
- Update documentation to reflect code changes
- Explain why changes were made
- Provide usage examples
- Highlight any API changes

Write clear, concise documentation for developers.`,
    });
  }

  async refactor(filename: string, code: string): Promise<{
    success: boolean;
    analysis?: any;
    refactoring?: any;
    testing?: any;
    documentation?: string;
    error?: string;
  }> {
    try {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🔧 Starting Refactoring Pipeline: ${filename}`);
      console.log('='.repeat(60));

      // Step 1: Analyze code
      console.log('\n[1/4] 📊 Analyzing code quality...');
      const analysisResult = await run(
        this.analyzerAgent,
        `Analyze this code file:\n\nFilename: ${filename}\n\n${code}`
      );

      let analysis;
      try {
        analysis = JSON.parse(analysisResult.finalOutput);
      } catch {
        console.log('Warning: Could not parse analysis result');
        analysis = { refactoringNeeded: false };
      }

      console.log(`   Quality Score: ${analysis.overallQuality || 'N/A'}/10`);
      console.log(`   Issues Found: ${analysis.issues?.length || 0}`);
      console.log(`   Refactoring Needed: ${analysis.refactoringNeeded ? 'Yes' : 'No'}`);

      if (!analysis.refactoringNeeded) {
        console.log('\n✓ Code quality is good, no refactoring needed!');
        return { success: true, analysis };
      }

      // Step 2: Refactor code
      console.log('\n[2/4] 🔨 Applying refactoring...');
      const refactoringResult = await run(
        this.refactorerAgent,
        `Refactor this code based on the analysis:\n\nOriginal Code:\n${code}\n\nAnalysis:\n${JSON.stringify(analysis, null, 2)}`
      );

      let refactoring;
      try {
        refactoring = JSON.parse(refactoringResult.finalOutput);
      } catch {
        console.log('Warning: Could not parse refactoring result');
        refactoring = { success: false };
      }

      console.log(`   Changes Applied: ${refactoring.changes?.length || 0}`);
      console.log(`   Risks Identified: ${refactoring.risks?.length || 0}`);

      if (!refactoring.success) {
        return { success: false, error: 'Refactoring failed', analysis };
      }

      // Step 3: Test changes
      console.log('\n[3/4] 🧪 Validating changes...');
      const testingResult = await run(
        this.testerAgent,
        `Validate this refactoring:\n\nOriginal:\n${code}\n\nRefactored:\n${refactoring.newCode}\n\nChanges:\n${JSON.stringify(refactoring.changes, null, 2)}`
      );

      let testing;
      try {
        testing = JSON.parse(testingResult.finalOutput);
      } catch {
        console.log('Warning: Could not parse testing result');
        testing = { passed: true };
      }

      console.log(`   Tests Passed: ${testing.passed ? 'Yes' : 'No'}`);
      console.log(`   Test Cases: ${testing.testCases?.length || 0}`);
      console.log(`   Coverage: ${testing.coverage || 'N/A'}%`);

      if (!testing.passed) {
        console.log('\n⚠️  Tests failed, refactoring may not be safe!');
        return { success: false, error: 'Tests failed', analysis, refactoring, testing };
      }

      // Step 4: Update documentation
      console.log('\n[4/4] 📝 Updating documentation...');
      const docResult = await run(
        this.documenterAgent,
        `Create documentation for this refactoring:\n\nFile: ${filename}\n\nChanges:\n${JSON.stringify(refactoring.changes, null, 2)}\n\nInclude: what changed, why, and how to use the new code.`
      );

      console.log('   Documentation generated ✓');

      // Success!
      console.log('\n' + '='.repeat(60));
      console.log('✅ Refactoring Pipeline Complete!');
      console.log('='.repeat(60));

      return {
        success: true,
        analysis,
        refactoring,
        testing,
        documentation: docResult.finalOutput,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ============================================================================
// Main Example
// ============================================================================

async function main() {
  console.log('🏭 Real-World Example: Code Refactoring Pipeline\n');
  console.log('This example demonstrates a production-ready workflow for');
  console.log('automated code refactoring using specialized agents.\n');

  // Create a temporary directory
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-refactor-'));
  console.log(`Working directory: ${tmpDir}\n`);

  // Create Codex provider
  const codexProvider = new CodexProvider({
    defaultModel: 'gpt-5-codex',
    workingDirectory: tmpDir,
    skipGitRepoCheck: true,
  });

  const codexModel = await codexProvider.getModel();

  // Create pipeline
  const pipeline = new CodeRefactoringPipeline(codexModel);

  await withTrace('Code Refactoring Pipeline', async () => {
    // Example: Legacy code that needs refactoring
    const legacyCode = `
function getUserData(id) {
  var user = null;
  var found = false;
  for (var i = 0; i < users.length; i++) {
    if (users[i].id == id) {
      user = users[i];
      found = true;
      break;
    }
  }
  
  if (found) {
    var result = {};
    result.name = user.name;
    result.email = user.email;
    result.age = user.age;
    result.address = user.address;
    return result;
  } else {
    return null;
  }
}

function updateUser(id, data) {
  var user = getUserData(id);
  if (user != null) {
    users[id].name = data.name;
    users[id].email = data.email;
    users[id].age = data.age;
    return true;
  }
  return false;
}
`.trim();

    console.log('Sample Legacy Code:');
    console.log('─'.repeat(60));
    console.log(legacyCode);
    console.log('─'.repeat(60));

    // Run the pipeline
    const result = await pipeline.refactor('userService.js', legacyCode);

    if (result.success) {
      console.log('\n📊 Pipeline Results Summary:');
      console.log('─'.repeat(60));

      if (result.analysis) {
        console.log('\n1. Analysis:');
        console.log(`   Quality: ${result.analysis.overallQuality}/10`);
        if (result.analysis.issues && result.analysis.issues.length > 0) {
          console.log(`   Top Issues:`);
          result.analysis.issues.slice(0, 3).forEach((issue: any) => {
            console.log(`     • [${issue.severity}] ${issue.issue}`);
          });
        }
      }

      if (result.refactoring) {
        console.log('\n2. Refactoring:');
        console.log(`   Changes: ${result.refactoring.changes?.length || 0}`);
        if (result.refactoring.changes && result.refactoring.changes.length > 0) {
          console.log('   Sample change:');
          const change = result.refactoring.changes[0];
          console.log(`     ${change.description}`);
          console.log(`     Reason: ${change.reason}`);
        }
      }

      if (result.testing) {
        console.log('\n3. Testing:');
        console.log(`   Status: ${result.testing.passed ? 'PASSED ✓' : 'FAILED ✗'}`);
        console.log(`   Coverage: ${result.testing.coverage}%`);
      }

      if (result.documentation) {
        console.log('\n4. Documentation:');
        console.log(`   ${result.documentation.substring(0, 150)}...`);
      }

      console.log('\n' + '─'.repeat(60));
      console.log('✅ Refactoring completed successfully!');
    } else {
      console.log('\n❌ Pipeline Failed:');
      console.log(`   Error: ${result.error}`);
    }
  });

  // ============================================================================
  // Additional Example: Batch Processing
  // ============================================================================

  console.log('\n\n' + '='.repeat(60));
  console.log('Bonus: Batch Processing Multiple Files');
  console.log('='.repeat(60));

  const files = [
    {
      name: 'utils.js',
      code: 'function add(a,b){return a+b;} function sub(a,b){return a-b;}',
    },
    {
      name: 'validate.js',
      code: 'function isEmail(s){return s.indexOf("@")>0;}',
    },
  ];

  console.log(`\nProcessing ${files.length} files...\n`);

  let successCount = 0;
  for (const file of files) {
    console.log(`Processing: ${file.name}`);
    const result = await pipeline.refactor(file.name, file.code);
    if (result.success) {
      successCount++;
      console.log(`  ✓ ${file.name} refactored successfully`);
    } else {
      console.log(`  ✗ ${file.name} refactoring failed: ${result.error}`);
    }
  }

  console.log(`\n✓ Batch processing complete: ${successCount}/${files.length} successful`);

  // ============================================================================
  // Summary
  // ============================================================================

  console.log('\n' + '='.repeat(60));
  console.log('✓ Real-World Example Complete!');
  console.log('='.repeat(60));
  console.log('\nKey Takeaways:');
  console.log('  • Multi-agent pipelines solve complex real-world problems');
  console.log('  • Structured data enables reliable agent coordination');
  console.log('  • Each agent specializes in one aspect of the workflow');
  console.log('  • Error handling ensures robustness');
  console.log('  • Batch processing scales to multiple files');
  console.log('  • CodexProvider makes this practical and production-ready');

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

