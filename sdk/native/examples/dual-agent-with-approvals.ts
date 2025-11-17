#!/usr/bin/env tsx
/**
 * Dual-Agent Collaboration with Intelligent Approvals
 *
 * This example demonstrates:
 * - GPT Codex (Manager) creates plans and approves/denies requests
 * - OpenCode (Executor) drives the opencode CLI via the official SDK
 * - Real-time approval flow streaming OpenCode events while approvals run through Codex
 *
 * Architecture:
 * - Planner: GPT Codex creates execution plans
 * - Approver: GPT Codex reviews and approves/denies actions
 * - Executor: OpenCode performs work with approval requests
 *
 * Approval Flow:
 * 1. OpenCode Executor requests permission for actions (shell, file_write, network_access)
 * 2. GPT Codex Approver reviews the request using AI
 * 3. Decision: APPROVE or DENY with reasoning
 * 4. OpenCode Executor receives decision via the SDK and proceeds accordingly
 *
 * Color Guide:
 * - Blue: GPT Codex (Manager/Approver)
 * - Green: OpenCode (Executor)
 * - Magenta: Approval Requests
 * - Yellow: System messages
 *
 * Usage:
 *   tsx examples/dual-agent-with-approvals.ts --prompt "Create a test file"
 */

import { Agent, Runner } from "@openai/agents";
import type { Event as OpencodeEvent } from "@opencode-ai/sdk";
import { CodexProvider, OpenCodeAgent, type PermissionRequest } from "../src/index.js";
import path from "node:path";

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  blue: "\x1b[34m",      // Codex
  green: "\x1b[32m",     // OpenCode
  magenta: "\x1b[35m",   // Approvals
  yellow: "\x1b[33m",    // System
  cyan: "\x1b[36m",      // Headers
  red: "\x1b[31m",       // Denials
  bold: "\x1b[1m",
};

/**
 * Logger with color-coded output
 */
class ApprovalLogger {
  private indent = 0;

  codex(message: string) {
    console.log(`${colors.blue}[GPT Codex]${colors.reset} ${this.getIndent()}${message}`);
  }

  claude(message: string) {
    console.log(`${colors.green}[OpenCode]${colors.reset} ${this.getIndent()}${message}`);
  }

  approval(message: string) {
    console.log(`${colors.magenta}[Approval]${colors.reset} ${this.getIndent()}${message}`);
  }

  system(message: string) {
    console.log(`${colors.yellow}[System]${colors.reset} ${this.getIndent()}${message}`);
  }

  approved(message: string) {
    console.log(`${colors.green}✅ ${message}${colors.reset}`);
  }

  denied(message: string) {
    console.log(`${colors.red}❌ ${message}${colors.reset}`);
  }

  header(message: string) {
    console.log(`\n${colors.cyan}${colors.bold}${"=".repeat(80)}`);
    console.log(`${message}`);
    console.log(`${"=".repeat(80)}${colors.reset}\n`);
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
    return " ".repeat(this.indent);
  }
}

/**
 * AI-powered approval decision maker
 */
class ApprovalAgent {
  private runner: Runner;
  private agent: Agent;
  private logger: ApprovalLogger;
  private plan: string = "";

  constructor(codexProvider: CodexProvider, logger: ApprovalLogger) {
    this.logger = logger;
    this.runner = new Runner({ modelProvider: codexProvider });

    this.agent = new Agent({
      name: "ApprovalDecider",
      model: codexProvider.getModel("gpt-5-codex"),
      instructions: `You are an intelligent approval agent that reviews permission requests.

Your role:
- Evaluate if the requested action aligns with the current plan
- Assess safety and security implications
- Make smart decisions: APPROVE or DENY

When reviewing approval requests:
1. Check if action matches the current plan
2. Evaluate safety (avoid destructive operations without clear need)
3. Consider context and reasoning
4. Provide clear reasoning for your decision

Safe actions to APPROVE:
- Read operations (ls, cat, grep, git status, git diff)
- Test execution (npm test, pnpm test, cargo test)
- Package installation (npm install, pnpm install)
- Build commands (npm run build, cargo build)
- File writes to standard directories (src/, tests/, docs/, /tmp)
- Creating test files
- Echo commands

Actions requiring careful review:
- File deletion
- System commands outside safe scope
- Network requests
- Modifying core files

Response format:
{
  "decision": "APPROVE" | "DENY",
  "reason": "Clear explanation"
}`,
      outputType: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            decision: {
              type: "string",
              enum: ["APPROVE", "DENY"],
              description: "The approval decision",
            },
            reason: {
              type: "string",
              description: "Reasoning for the decision",
            },
          },
          required: ["decision", "reason"],
          additionalProperties: false,
        },
        name: "ApprovalDecision",
        strict: true,
      },
    });
  }

  setPlan(plan: string) {
    this.plan = plan;
  }

  async review(request: PermissionRequest): Promise<boolean> {
    console.error(`[DEBUG] review() called - type: ${request.type}, title: ${request.title}`);
    this.logger.approval(`\n📋 New Approval Request`);
    this.logger.pushIndent();
    this.logger.approval(`Type: ${request.type}`);
    this.logger.approval(`Title: ${request.title}`);
    this.logger.approval(`Details: ${JSON.stringify(request.metadata, null, 2)}`);
    this.logger.popIndent();
    this.logger.codex(`Reviewing approval request...`);

    const prompt = `Review this approval request:

TYPE: ${request.type}
DETAILS: ${JSON.stringify(request.details, null, 2)}

CURRENT PLAN:
${this.plan || "No plan available"}

Should this action be approved? Consider safety, alignment with plan, and necessity.`;

    try {
      const result = await this.runner.run(this.agent, prompt);
      const decision = result.finalOutput as any;

      if (decision.decision === "APPROVE") {
        this.logger.approved(`APPROVED: ${decision.reason}`);
        return true;
      } else {
        this.logger.denied(`DENIED: ${decision.reason}`);
        return false;
      }
    } catch (error: any) {
      this.logger.denied(`ERROR: ${error.message}`);
      // Fail closed - deny on error
      return false;
    }
  }
}

function logOpenCodeEvent(event: OpencodeEvent, logger: ApprovalLogger): void {
  const props = (event as any)?.properties ?? {};
  switch (event.type) {
    case "message.part.updated": {
      const part = props.info as { type: string; text?: string };
      if (!part || typeof part.type !== "string" || typeof part.text !== "string") {
        return;
      }
      if (part.type === "reasoning") {
        logger.claude(`Reasoning: ${part.text.trim()}`);
      } else if (part.type === "text") {
        logger.claude(`Response: ${part.text.trim()}`);
      }
      break;
    }
    case "command.executed": {
      const command = props as { name?: string; arguments?: string };
      const summary = [command.name, command.arguments].filter(Boolean).join(" ");
      logger.claude(`Command executed: ${summary || "(unknown)"}`);
      break;
    }
    case "permission.updated": {
      logger.approval(`Permission requested: ${props.title || props.type}`);
      break;
    }
    case "session.error": {
      const detail = props.error?.message ?? "Unknown session error";
      logger.denied(`Session error: ${detail}`);
      break;
    }
    case "todo.updated": {
      const todos = props.todos ?? [];
      todos.forEach((todo: any) => logger.claude(`TODO: ${todo.title ?? JSON.stringify(todo)}`));
      break;
    }
    default:
      break;
  }
}

/**
 * Main workflow with approvals
 */
async function runApprovalWorkflow(prompt: string) {
  const logger = new ApprovalLogger();

  logger.header("DUAL-AGENT COLLABORATION WITH INTELLIGENT APPROVALS");
  logger.system(`User request: ${prompt}`);

  // Initialize GPT Codex provider for planning and approvals
  const codexProvider = new CodexProvider({
    defaultModel: "gpt-5-codex",
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
  });

  const approvalAgent = new ApprovalAgent(codexProvider, logger);
  const runner = new Runner({ modelProvider: codexProvider });

  // Create planner using GPT Codex (manager)
  const plannerAgent = new Agent({
    name: "CodexPlanner",
    model: codexProvider.getModel("gpt-5-codex"),
    instructions: `You are an expert planning agent. Create detailed, actionable plans.
Format your plan as numbered steps with clear actions.`,
  });

  try {
    // Create plan
    logger.section("Phase 1: Planning");
    logger.codex("Creating execution plan...");

    const planResult = await runner.run(
      plannerAgent,
      `Create a plan for: ${prompt}`
    );

    const plan = planResult.finalOutput as string;
    approvalAgent.setPlan(plan);

    logger.pushIndent();
    logger.codex("Plan:");
    logger.pushIndent();
    plan.split("\n").slice(0, 8).forEach((line) => {
      if (line.trim()) logger.codex(line);
    });
    logger.popIndent();
    logger.popIndent();

    // Execute with approvals
    logger.section("Phase 2: Execution with Approvals");

    // Create approval handler
    const approvalHandler = async (request: PermissionRequest): Promise<boolean> => {
      const approved = await approvalAgent.review(request);
      return approved;
    };

    // Create OpenCode agent with approval callback
    logger.claude("Starting execution with approval flow...");

    // Find monorepo root (2 levels up from sdk/native)
    const monorepoRoot = path.resolve(process.cwd(), "../..");
    logger.system(`Working directory: ${monorepoRoot}`);

    const opencodeAgent = new OpenCodeAgent({
      model: "anthropic/claude-sonnet-4-5-20250929",
      onApprovalRequest: approvalHandler,
      config: {
        workingDirectory: monorepoRoot,
      },
    });

    const executionPrompt = `Execute this plan:

${plan}

Work through each step carefully.`;

    // Use streaming to show real-time progress
    logger.pushIndent();
    const result = await opencodeAgent.delegateStreaming(executionPrompt, (event) => logOpenCodeEvent(event, logger));
    logger.popIndent();

    if (!result.success) {
      logger.pushIndent();
      logger.claude(`Error: ${result.error}`);
      logger.popIndent();
    } else {
      logger.claude("Final response:");
      logger.pushIndent();
      logger.claude(result.output || "(no response)" );
      logger.popIndent();
    }

    logger.header("WORKFLOW COMPLETE");
    logger.system("Dual-agent collaboration with approvals finished");
  } catch (error: any) {
    logger.header("ERROR");
    logger.system(`Workflow failed: ${error.message}`);
    process.exit(1);
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

const args = process.argv.slice(2);
const promptIndex = args.indexOf("--prompt");

if (promptIndex === -1 || !args[promptIndex + 1]) {
  console.error(`
${colors.cyan}${colors.bold}Dual-Agent Collaboration with Intelligent Approvals${colors.reset}

${colors.yellow}Usage:${colors.reset}
  tsx examples/dual-agent-with-approvals.ts --prompt "Your task"

${colors.yellow}Examples:${colors.reset}
  tsx examples/dual-agent-with-approvals.ts --prompt "Create a test file with sample data"
  tsx examples/dual-agent-with-approvals.ts --prompt "Run tests and report results"
  tsx examples/dual-agent-with-approvals.ts --prompt "Echo hello world"

${colors.yellow}Architecture:${colors.reset}
  ${colors.blue}• GPT Codex${colors.reset} creates plans and intelligently approves/denies actions
  ${colors.green}• OpenCode${colors.reset} executes work and requests approvals
  ${colors.magenta}• Real-time${colors.reset} approval flow with AI decision-making

${colors.yellow}Approval Flow:${colors.reset}
  1. ${colors.green}OpenCode${colors.reset} requests permission for actions
  2. ${colors.magenta}Approval${colors.reset} request sent to GPT Codex
  3. ${colors.blue}GPT Codex${colors.reset} reviews using AI (approve/deny)
  4. ${colors.green}OpenCode${colors.reset} receives decision and proceeds
`);
  process.exit(1);
}

const prompt = args[promptIndex + 1];

runApprovalWorkflow(prompt)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`${colors.yellow}[FATAL]${colors.reset}`, error);
    process.exit(1);
  });
