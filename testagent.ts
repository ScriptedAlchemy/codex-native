/**
 * Test Agent - TUI Launcher Utility
 *
 * A comprehensive CLI wrapper for launching the Codex Native SDK TUI.
 * Useful for testing TUI functionality and demonstrating all available options.
 *
 * This is a development/testing utility located in the project root.
 * For production examples, see sdk/native/examples/tui/
 *
 * Default model: gpt-5-codex-mini (fast, cost-effective)
 *
 * Usage:
 *   npx tsx testagent.ts [options] [prompt...]
 *   npx tsx testagent.ts --help
 *
 * Examples:
 *   npx tsx testagent.ts "Review the codebase"
 *   npx tsx testagent.ts --resume-last
 *   npx tsx testagent.ts --full-auto --sandbox workspace-write
 *   npx tsx testagent.ts --model gpt-5-codex "Complex analysis task"
 */

import process from "node:process";
import path from "node:path";

import {
  Codex,
  type ThreadOptions,
  type ApprovalMode,
  type NativeTuiExitInfo,
  type NativeTuiRequest,
  type SandboxMode,
} from "@codex-native/sdk";

type ParsedArgs = {
  request: NativeTuiRequest;
  prompt?: string;
  showHelp: boolean;
};

const DEFAULT_MODEL = "gpt-5-codex-mini";
const DEFAULT_PROMPT =
  "Review the latest Git changes in this repository and suggest the next actions.";

async function main(): Promise<void> {
  const { request, prompt, showHelp } = parseArgs(process.argv.slice(2));

  if (showHelp) {
    printUsage();
    return;
  }

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.error(
      "Codex TUI requires an interactive terminal.\nRun this script directly from a terminal session.",
    );
    process.exitCode = 1;
    return;
  }

  const resolvedWorkingDirectory = request.workingDirectory ?? process.cwd();
  const model = request.model ?? DEFAULT_MODEL;
  const initialPrompt =
    prompt ??
    (request.resumeSessionId || request.resumePicker || request.resumeLast
      ? undefined
      : DEFAULT_PROMPT);

  const tuiRequest: NativeTuiRequest = {
    ...request,
    prompt: initialPrompt,
    sandboxMode: request.sandboxMode ?? "workspace-write",
    approvalMode: request.approvalMode ?? "on-request",
    workingDirectory: resolvedWorkingDirectory,
    model,
  };

  logLaunchInfo(tuiRequest, initialPrompt);

  const codex = new Codex({
    baseUrl: request.baseUrl,
    apiKey: request.apiKey,
  });

  const threadOptions: ThreadOptions = {
    model,
    sandboxMode: tuiRequest.sandboxMode,
    approvalMode: tuiRequest.approvalMode,
    workingDirectory: resolvedWorkingDirectory,
    fullAuto: request.fullAuto,
    oss: request.oss,
    skipGitRepoCheck: true,
  };

  if (request.addDir && request.addDir.length > 0) {
    threadOptions.workspaceWriteOptions = {
      writableRoots: request.addDir.map((dir) => path.resolve(dir)),
    };
  }

  const thread = codex.startThread(threadOptions);

  let session: ReturnType<typeof thread.launchTui> | null = null;
  try {
    session = thread.launchTui(tuiRequest);
    const exitInfo = await session.wait();
    summarizeExit(exitInfo);
  } catch (error) {
    if (session && !session.closed) {
      session.shutdown();
      await session.wait().catch(() => {});
    }
    console.error("Failed to launch Codex TUI:", error);
    process.exitCode = 1;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const request: NativeTuiRequest = {};
  const promptParts: string[] = [];
  const configOverrides: string[] = [];
  const addDirs: string[] = [];
  let prompt: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "-h":
      case "--help":
        return { request, prompt, showHelp: true };
      case "--full-auto":
        request.fullAuto = true;
        continue;
      case "--resume-picker":
        request.resumePicker = true;
        continue;
      case "--resume-last":
        request.resumeLast = true;
        continue;
      case "--web-search":
        request.webSearch = true;
        continue;
      case "--bypass-approvals":
        request.dangerouslyBypassApprovalsAndSandbox = true;
        continue;
      case "--resume": {
        const resumeId = requireValue(argv, ++index, token);
        request.resumeSessionId = resumeId;
        continue;
      }
      case "--sandbox": {
        const modeValue = requireValue(argv, ++index, token);
        request.sandboxMode = parseSandboxMode(modeValue);
        continue;
      }
      case "--approval": {
        const modeValue = requireValue(argv, ++index, token);
        request.approvalMode = parseApprovalMode(modeValue);
        continue;
      }
      case "--cwd":
      case "--working-dir": {
        const dirValue = requireValue(argv, ++index, token);
        request.workingDirectory = path.resolve(dirValue);
        continue;
      }
      case "--model": {
        const modelValue = requireValue(argv, ++index, token);
        request.model = modelValue;
        continue;
      }
      case "--profile": {
        const profileValue = requireValue(argv, ++index, token);
        request.configProfile = profileValue;
        continue;
      }
      case "--base-url": {
        const baseUrlValue = requireValue(argv, ++index, token);
        request.baseUrl = baseUrlValue;
        continue;
      }
      case "--api-key": {
        const keyValue = requireValue(argv, ++index, token);
        request.apiKey = keyValue;
        continue;
      }
      case "--linux-sandbox": {
        const pathValue = requireValue(argv, ++index, token);
        request.linuxSandboxPath = path.resolve(pathValue);
        continue;
      }
      default:
        if (token.startsWith("--config-override=")) {
          configOverrides.push(extractValue(token, "--config-override="));
          continue;
        }

        if (token === "--config-override") {
          const overrideValue = requireValue(argv, ++index, token);
          configOverrides.push(overrideValue);
          continue;
        }

        if (token.startsWith("--add-dir=")) {
          addDirs.push(extractValue(token, "--add-dir="));
          continue;
        }

        if (token === "--add-dir") {
          const addDirValue = requireValue(argv, ++index, token);
          addDirs.push(addDirValue);
          continue;
        }

        if (token.startsWith("--")) {
          throw new Error(`Unknown flag: ${token}`);
        }

        promptParts.push(token);
    }
  }

  if (configOverrides.length > 0) {
    request.configOverrides = configOverrides;
  }

  if (addDirs.length > 0) {
    request.addDir = addDirs;
  }

  if (promptParts.length > 0) {
    prompt = promptParts.join(" ");
  }

  return { request, prompt, showHelp: false };
}

function parseSandboxMode(value: string): SandboxMode {
  const sandboxModes: SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];
  if (!sandboxModes.includes(value as SandboxMode)) {
    throw new Error(
      `Invalid sandbox mode "${value}". Expected one of: ${sandboxModes.join(", ")}`,
    );
  }
  return value as SandboxMode;
}

function parseApprovalMode(value: string): ApprovalMode {
  const approvalModes: ApprovalMode[] = ["never", "on-request", "on-failure", "untrusted"];
  if (!approvalModes.includes(value as ApprovalMode)) {
    throw new Error(
      `Invalid approval mode "${value}". Expected one of: ${approvalModes.join(", ")}`,
    );
  }
  return value as ApprovalMode;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Flag ${flag} expects a value.`);
  }
  return value;
}

function extractValue(token: string, prefix: string): string {
  const value = token.slice(prefix.length);
  if (!value) {
    throw new Error(`Flag ${prefix} expects a value.`);
  }
  return value;
}

function logLaunchInfo(request: NativeTuiRequest, prompt?: string): void {
  const details = [
    prompt ? `prompt="${truncate(prompt, 60)}"` : undefined,
    request.resumeSessionId ? `resumeSessionId=${request.resumeSessionId}` : undefined,
    request.resumeLast ? "resumeLast=true" : undefined,
    request.resumePicker ? "resumePicker=true" : undefined,
    request.fullAuto ? "fullAuto=true" : undefined,
    request.webSearch ? "webSearch=true" : undefined,
  ].filter(Boolean);

  console.log("Launching Codex TUI...");
  if (details.length > 0) {
    console.log(`  with: ${details.join(", ")}`);
  }
  console.log("");
}

function summarizeExit(exitInfo: NativeTuiExitInfo): void {
  console.log("\nTUI session exited.");
  console.log(`Conversation ID: ${exitInfo.conversationId ?? "<none>"}`);
  const usage = exitInfo.tokenUsage;
  console.log(
    `Token usage - input: ${usage.inputTokens}, cached input: ${usage.cachedInputTokens}, output: ${usage.outputTokens}, reasoning: ${usage.reasoningOutputTokens}, total: ${usage.totalTokens}`,
  );

  if (exitInfo.updateAction) {
    const { command, kind } = exitInfo.updateAction;
    console.log(`Suggested follow-up (${kind}): ${command}`);
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function printUsage(): void {
  console.log(`testagent.ts - Launch the Codex TUI from Node.js

Usage:
  pnpm dlx tsx testagent.ts [options] [prompt...]

Options:
  -h, --help                Show this help message.
  --full-auto               Enable fully autonomous mode.
  --resume <id>             Resume the conversation with the given session ID.
  --resume-last             Resume the most recent conversation.
  --resume-picker           Show the resume picker when launching.
  --sandbox <mode>          Set sandbox mode (read-only | workspace-write | danger-full-access).
  --approval <mode>         Set approval mode (never | on-request | on-failure | untrusted).
  --web-search              Allow Codex to perform web searches.
  --bypass-approvals        Disable all safety prompts (use with caution).
  --model <name>            Override the default model (default: gpt-5-codex-mini).
  --cwd <path>              Launch the TUI from a different working directory.
  --profile <name>          Choose a config profile from codex.config.ts.
  --config-override <pair>  Apply a config override (key=value). Repeatable.
  --add-dir <path>          Add an additional writable directory. Repeatable.
  --base-url <url>          Override the Codex API base URL.
  --api-key <key>           Provide a Codex API key explicitly.
  --linux-sandbox <path>    Path to the Linux sandbox binary when launching remotely.

Any positional arguments after the options are treated as the initial prompt.
If no prompt or resume option is provided, a default prompt will be used.
`);
}

void main();



