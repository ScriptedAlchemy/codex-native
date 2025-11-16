#!/usr/bin/env tsx
/**
 * Dual-Agent Collaboration Example
 *
 * This example demonstrates a collaborative workflow between two agents:
 * - Codex Agent (Planner/Reviewer): Plans tasks and reviews work
 * - Claude Agent (Executor): Executes the plan and performs actual work
 *
 * The workflow:
 * 1. Codex creates a detailed plan with action items
 * 2. Claude executes the plan step-by-step
 * 3. Codex reviews Claude's work
 * 4. If needed, they discuss and iterate
 *
 * Color-coded output:
 * - Blue: Codex (Planner/Reviewer)
 * - Green: Claude (Executor)
 * - Yellow: System messages
 *
 * Usage:
 *   tsx examples/dual-agent-collab.ts --prompt "Analyze the codebase and suggest improvements"
 *   tsx examples/dual-agent-collab.ts --prompt "Implement user authentication"
 */

import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Agent, Runner } from '@openai/agents';
import { CodexProvider } from '../src/index';

const execAsync = promisify(exec);

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  blue: '\x1b[34m',    // Codex
  green: '\x1b[32m',   // Claude
  yellow: '\x1b[33m',  // System
  cyan: '\x1b[36m',    // Headers
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

interface ClaudeResponse {
  type: string;
  subtype: string;
  total_cost_usd?: number;
  is_error: boolean;
  duration_ms?: number;
  result: string;
  session_id?: string;
}

/**
 * Logger with color-coded output
 */
class DualAgentLogger {
  private indent = 0;

  codex(message: string) {
    console.log(`${colors.blue}[Codex]${colors.reset} ${this.getIndent()}${message}`);
  }

  claude(message: string) {
    console.log(`${colors.green}[Claude]${colors.reset} ${this.getIndent()}${message}`);
  }

  system(message: string) {
    console.log(`${colors.yellow}[System]${colors.reset} ${this.getIndent()}${message}`);
  }

  header(message: string) {
    console.log(`\n${colors.cyan}${colors.bold}${'='.repeat(80)}`);
    console.log(`${message}`);
    console.log(`${'='.repeat(80)}${colors.reset}\n`);
  }

  section(title: string) {
    console.log(`\n${colors.cyan}━━━ ${title} ━━━${colors.reset}\n`);
  }

  pushIndent() {
    this.indent += 2;
  }

  popIndent() {
    this.indent = Math.max(0, this.indent - 2);
  }

  private getIndent(): string {
    return ' '.repeat(this.indent);
  }
}

/**
 * Execute tasks using Claude Code CLI
 */
async function executeWithClaude(
  task: string,
  sessionId?: string,
  logger?: DualAgentLogger
): Promise<ClaudeResponse> {
  const workDir = process.cwd();

  try {
    let command: string;

    if (sessionId) {
      logger?.claude(`Resuming session ${sessionId.substring(0, 8)}...`);
      command = `claude --resume ${sessionId} "${task}" --output-format json`;
    } else {
      logger?.claude('Starting new execution session...');
      command = `claude -p "${task}" --output-format json`;
    }

    const { stdout } = await execAsync(command, {
      cwd: workDir,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 300000, // 5 minute timeout
    });

    const response = JSON.parse(stdout) as ClaudeResponse;

    if (response.session_id && logger) {
      logger.system(`Session ID: ${response.session_id.substring(0, 8)}...`);
    }

    return response;
  } catch (error: any) {
    throw new Error(`Claude CLI execution failed: ${error.message}`);
  }
}

/**
 * Main dual-agent workflow
 */
async function runDualAgentWorkflow(prompt: string) {
  const logger = new DualAgentLogger();

  logger.header('DUAL-AGENT COLLABORATION WORKFLOW');
  logger.system(`User request: ${prompt}`);

  // Initialize Codex provider
  const codexProvider = new CodexProvider({
    defaultModel: 'claude-sonnet-4-5-20250929',
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
  });

  const codexModel = await codexProvider.getModel();
  const runner = new Runner({ modelProvider: codexProvider });

  // Define Codex agents
  const plannerAgent = new Agent({
    name: 'CodexPlanner',
    model: codexModel,
    instructions: `You are an expert planning agent. Your role is to:
- Break down complex tasks into clear, actionable steps
- Create detailed plans that another agent can execute
- Consider dependencies and ordering of tasks
- Identify potential challenges and how to address them

When creating a plan:
1. Analyze the request thoroughly
2. List specific action items
3. Provide context and rationale
4. Be specific about what should be done

Format your plan as a numbered list of action items.`,
  });

  const reviewerAgent = new Agent({
    name: 'CodexReviewer',
    model: codexModel,
    instructions: `You are an expert code reviewer. Your role is to:
- Review work completed by the executor agent
- Verify that all requirements were met
- Identify any issues or improvements needed
- Determine if follow-up work is required

When reviewing:
1. Check completeness against the original plan
2. Assess quality of the implementation
3. Identify any gaps or issues
4. Decide: "APPROVED" if work is complete, or "NEEDS_FOLLOWUP" with specific feedback

Start your response with either "APPROVED" or "NEEDS_FOLLOWUP".`,
  });

  try {
    // ========================================================================
    // PHASE 1: Planning
    // ========================================================================
    logger.section('Phase 1: Planning');
    logger.codex('Creating execution plan...');

    const planResult = await runner.run(
      plannerAgent,
      `Create a detailed plan to accomplish this task:\n\n${prompt}\n\nProvide a clear, numbered list of action items.`
    );

    const plan = planResult.finalOutput as string;

    logger.pushIndent();
    logger.codex('Plan created:');
    logger.pushIndent();
    plan.split('\n').slice(0, 10).forEach(line => {
      if (line.trim()) logger.codex(line);
    });
    if (plan.split('\n').length > 10) {
      logger.codex(`${colors.dim}... (${plan.split('\n').length - 10} more lines)${colors.reset}`);
    }
    logger.popIndent();
    logger.popIndent();

    // ========================================================================
    // PHASE 2: Execution
    // ========================================================================
    logger.section('Phase 2: Execution');
    logger.claude('Executing the plan...');

    const executionPrompt = `I need you to execute this plan:\n\n${plan}\n\nPlease work through each step carefully and let me know when you're done.`;

    const executionResult = await executeWithClaude(executionPrompt, undefined, logger);

    if (executionResult.is_error) {
      throw new Error(`Claude execution failed: ${executionResult.result}`);
    }

    logger.pushIndent();
    logger.claude('Execution complete:');
    logger.pushIndent();
    const resultLines = executionResult.result.split('\n');
    resultLines.slice(0, 15).forEach(line => {
      if (line.trim()) logger.claude(line);
    });
    if (resultLines.length > 15) {
      logger.claude(`${colors.dim}... (${resultLines.length - 15} more lines)${colors.reset}`);
    }
    logger.popIndent();
    logger.popIndent();

    // ========================================================================
    // PHASE 3: Review
    // ========================================================================
    logger.section('Phase 3: Review');
    logger.codex('Reviewing execution results...');

    const reviewPrompt = `Review the following work completed by the executor:\n\nORIGINAL REQUEST:\n${prompt}\n\nPLAN:\n${plan}\n\nEXECUTION RESULT:\n${executionResult.result}\n\nDetermine if the work is complete and meets requirements.`;

    const reviewResult = await runner.run(reviewerAgent, reviewPrompt);
    const review = reviewResult.finalOutput as string;

    logger.pushIndent();
    logger.codex('Review complete:');
    logger.pushIndent();
    review.split('\n').slice(0, 10).forEach(line => {
      if (line.trim()) logger.codex(line);
    });
    if (review.split('\n').length > 10) {
      logger.codex(`${colors.dim}... (${review.split('\n').length - 10} more lines)${colors.reset}`);
    }
    logger.popIndent();
    logger.popIndent();

    // ========================================================================
    // PHASE 4: Follow-up (if needed)
    // ========================================================================
    if (review.toUpperCase().includes('NEEDS_FOLLOWUP') || review.toUpperCase().includes('NEEDS FOLLOWUP')) {
      logger.section('Phase 4: Follow-up Discussion');
      logger.system('Review indicates follow-up work needed');

      if (!executionResult.session_id) {
        logger.system('Cannot continue - no session ID available');
        return;
      }

      // Extract feedback from review
      const feedbackMatch = review.match(/(?:NEEDS_FOLLOWUP|NEEDS FOLLOWUP)[:\s]*([\s\S]*)/i);
      const feedback = feedbackMatch ? feedbackMatch[1].trim() : 'Please address the issues mentioned in the review';

      logger.codex('Providing feedback to executor...');
      logger.pushIndent();
      logger.codex(feedback.split('\n')[0]);
      logger.popIndent();

      logger.claude('Addressing feedback...');

      const followupResult = await executeWithClaude(
        `The reviewer provided this feedback:\n\n${feedback}\n\nPlease address these points.`,
        executionResult.session_id,
        logger
      );

      logger.pushIndent();
      logger.claude('Follow-up work complete:');
      logger.pushIndent();
      followupResult.result.split('\n').slice(0, 10).forEach(line => {
        if (line.trim()) logger.claude(line);
      });
      if (followupResult.result.split('\n').length > 10) {
        logger.claude(`${colors.dim}... (${followupResult.result.split('\n').length - 10} more lines)${colors.reset}`);
      }
      logger.popIndent();
      logger.popIndent();

      // Final review
      logger.codex('Performing final review...');
      const finalReviewPrompt = `Review the follow-up work:\n\nORIGINAL FEEDBACK:\n${feedback}\n\nFOLLOW-UP RESULT:\n${followupResult.result}\n\nIs the work now complete?`;

      const finalReview = await runner.run(reviewerAgent, finalReviewPrompt);
      const finalReviewText = finalReview.finalOutput as string;

      logger.pushIndent();
      logger.codex(finalReviewText.split('\n')[0]);
      logger.popIndent();
    } else {
      logger.section('Phase 4: Completion');
      logger.system('Work approved - no follow-up needed');
    }

    // ========================================================================
    // Summary
    // ========================================================================
    logger.header('WORKFLOW COMPLETE');
    logger.system('Dual-agent collaboration finished successfully');

    if (executionResult.total_cost_usd) {
      logger.system(`Total cost: $${executionResult.total_cost_usd.toFixed(4)}`);
    }

  } catch (error: any) {
    logger.header('ERROR');
    logger.system(`Workflow failed: ${error.message}`);
    process.exit(1);
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

// Parse CLI arguments
const args = process.argv.slice(2);
const promptIndex = args.indexOf('--prompt');

if (promptIndex === -1 || !args[promptIndex + 1]) {
  console.error(`
${colors.cyan}${colors.bold}Dual-Agent Collaboration Example${colors.reset}

${colors.yellow}Usage:${colors.reset}
  tsx examples/dual-agent-collab.ts --prompt "Your task description"

${colors.yellow}Examples:${colors.reset}
  tsx examples/dual-agent-collab.ts --prompt "Analyze the test coverage and suggest improvements"
  tsx examples/dual-agent-collab.ts --prompt "Review the authentication system for security issues"
  tsx examples/dual-agent-collab.ts --prompt "Implement error handling for API endpoints"

${colors.yellow}How it works:${colors.reset}
  ${colors.blue}1. Codex${colors.reset} creates a detailed execution plan
  ${colors.green}2. Claude${colors.reset} executes the plan step-by-step
  ${colors.blue}3. Codex${colors.reset} reviews the completed work
  ${colors.yellow}4. System${colors.reset} manages follow-up discussion if needed

${colors.yellow}Color Guide:${colors.reset}
  ${colors.blue}Blue${colors.reset}   - Codex (Planner/Reviewer)
  ${colors.green}Green${colors.reset}  - Claude (Executor)
  ${colors.yellow}Yellow${colors.reset} - System messages
`);
  process.exit(1);
}

const prompt = args[promptIndex + 1];

runDualAgentWorkflow(prompt)
  .then(() => process.exit(0))
  .catch(error => {
    console.error(`${colors.yellow}[FATAL]${colors.reset}`, error);
    process.exit(1);
  });
