/**
 * Integration test for Claude Code CLI - JSON output format
 *
 * This test verifies that the Claude CLI properly returns JSON when using
 * --output-format json, and that the response structure is correct.
 *
 * NOTE: This test actually calls the Claude CLI (not mocked) so it requires:
 * - Claude Code CLI to be installed
 * - API keys to be configured
 * - Network connectivity
 *
 * To run: pnpm test -- claude-cli-integration.test.ts
 */

import { describe, expect, it } from "@jest/globals";
import { exec, execSync } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";

const execAsync = promisify(exec);

function hasClaudeCli(): boolean {
  try {
    execSync("claude --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const shouldRunClaudeCli = process.env.RUN_CLAUDE_CLI_TESTS === "1" && hasClaudeCli();

interface ClaudeJSONResponse {
  type: string;
  subtype: string;
  total_cost_usd?: number;
  is_error: boolean;
  duration_ms?: number;
  result: string;
  session_id?: string;
}

(shouldRunClaudeCli ? describe : describe.skip)("Claude CLI Integration - JSON Output", () => {
  const testWorkDir = path.join(process.cwd(), ".test-claude-cli");

  beforeAll(async () => {
    // Create test working directory
    await fs.mkdir(testWorkDir, { recursive: true });
  });

  afterAll(async () => {
    // Cleanup test directory
    try {
      await fs.rm(testWorkDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  it("should return valid JSON with --output-format json", async () => {
    const command = `claude -p "Echo the text 'Hello Test'" --output-format json --permission-mode acceptEdits --allowedTools ""`;

    const { stdout } = await execAsync(command, {
      cwd: testWorkDir,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60000,
    });

    // Parse JSON response
    const response: ClaudeJSONResponse = JSON.parse(stdout);

    // Verify response structure
    expect(response).toHaveProperty("type");
    expect(response).toHaveProperty("is_error");
    expect(response).toHaveProperty("result");

    // Verify it's not an error
    expect(response.is_error).toBe(false);

    // Verify we got a response
    expect(response.result).toBeTruthy();
    expect(typeof response.result).toBe("string");
  }, 120000); // 2 minute timeout

  it("should include session_id in JSON response", async () => {
    const command = `claude -p "Say 'test'" --output-format json --permission-mode acceptEdits --allowedTools ""`;

    const { stdout } = await execAsync(command, {
      cwd: testWorkDir,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60000,
    });

    const response: ClaudeJSONResponse = JSON.parse(stdout);

    // Session ID should be present for conversation tracking
    expect(response).toHaveProperty("session_id");
    expect(response.session_id).toBeTruthy();
    expect(typeof response.session_id).toBe("string");
  }, 120000);

  it("should support resuming with session ID", async () => {
    // First request
    const command1 = `claude -p "Remember the number 42" --output-format json --permission-mode acceptEdits --allowedTools ""`;

    const { stdout: stdout1 } = await execAsync(command1, {
      cwd: testWorkDir,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60000,
    });

    const response1: ClaudeJSONResponse = JSON.parse(stdout1);
    expect(response1.session_id).toBeTruthy();

    // Resume with session ID
    const sessionId = response1.session_id!;
    const command2 = `claude --resume ${sessionId} "What number did I ask you to remember?" --output-format json --permission-mode acceptEdits --allowedTools ""`;

    const { stdout: stdout2 } = await execAsync(command2, {
      cwd: testWorkDir,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60000,
    });

    const response2: ClaudeJSONResponse = JSON.parse(stdout2);

    // Verify the response mentions 42
    expect(response2.is_error).toBe(false);
    expect(response2.result.toLowerCase()).toContain("42");
  }, 240000); // 4 minute timeout for two requests
});
