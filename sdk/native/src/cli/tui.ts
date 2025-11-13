import process from "node:process";

import { Codex } from "../codex";
import { attachLspDiagnostics } from "../lsp";
import type { LspManagerOptions } from "../lsp";
import type { ThreadOptions } from "../threadOptions";
import type { NativeTuiRequest } from "../nativeBinding";
import { emitWarnings, runBeforeStartHooks } from "./hooks";
import { parseApprovalModeFlag, parseSandboxModeFlag } from "./optionParsers";
import type { CliContext, CommandName, TuiCommandOptions } from "./types";

export async function executeTuiCommand(
  argv: TuiCommandOptions,
  context: CliContext,
): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    throw new Error("The interactive TUI requires an interactive terminal (TTY).");
  }

  const { combinedConfig } = context;
  emitWarnings(combinedConfig.warnings);
  const warningCount = combinedConfig.warnings.length;

  const { request, threadOptions } = buildTuiConfig({
    argv,
    defaults: combinedConfig.tuiDefaults,
    cwd: context.cwd,
  });

  const hookContext = {
    command: "tui" as CommandName,
    cwd: context.cwd,
    options: argv,
  };

  await runBeforeStartHooks(combinedConfig.beforeStartHooks, hookContext, combinedConfig.warnings);

  const codex = new Codex({ baseUrl: request.baseUrl, apiKey: request.apiKey });
  const thread = codex.startThread(threadOptions);

  const lspOptions: LspManagerOptions = {
    workingDirectory: threadOptions.workingDirectory ?? context.cwd,
    waitForDiagnostics: true,
  };
  const detachLsp = attachLspDiagnostics(thread, lspOptions);

  const exitInfo = await thread.tui(request);
  detachLsp();
  if (exitInfo.conversationId) {
    process.stdout.write(`\nConversation ID: ${exitInfo.conversationId}\n`);
  }
  if (exitInfo.updateAction) {
    process.stdout.write(
      `Update available (${exitInfo.updateAction.kind}): ${exitInfo.updateAction.command}\n`,
    );
  }

  emitWarnings(combinedConfig.warnings, warningCount);
}

function buildTuiConfig(params: {
  argv: TuiCommandOptions;
  defaults: Partial<NativeTuiRequest>;
  cwd: string;
}): { request: NativeTuiRequest; thread: ThreadOptions } {
  const { argv, defaults, cwd } = params;
  const request: NativeTuiRequest = {
    ...(defaults as NativeTuiRequest),
  };

  if (argv.prompt !== undefined) request.prompt = argv.prompt;
  if (argv.model !== undefined) request.model = argv.model;
  if (argv.oss !== undefined) request.oss = argv.oss;
  const sandboxMode = parseSandboxModeFlag(argv.sandbox, "--sandbox");
  if (sandboxMode !== undefined) {
    request.sandboxMode = sandboxMode;
  }

  const approvalMode = parseApprovalModeFlag(argv.approval, "--approval");
  if (approvalMode !== undefined) {
    request.approvalMode = approvalMode;
  }
  if (argv.resume !== undefined) request.resumeSessionId = argv.resume;
  if (argv.resumeLast !== undefined) request.resumeLast = argv.resumeLast;
  if (argv.resumePicker !== undefined) request.resumePicker = argv.resumePicker;
  if (argv.fullAuto !== undefined) request.fullAuto = argv.fullAuto;
  if (argv.dangerouslyBypassApprovalsAndSandbox !== undefined) {
    request.dangerouslyBypassApprovalsAndSandbox = argv.dangerouslyBypassApprovalsAndSandbox;
  }
  if (argv.workingDirectory !== undefined) request.workingDirectory = argv.workingDirectory;
  if (argv.configProfile !== undefined) request.configProfile = argv.configProfile;
  if (argv.webSearch !== undefined) request.webSearch = argv.webSearch;
  if (argv.linuxSandboxPath !== undefined) request.linuxSandboxPath = argv.linuxSandboxPath;
  if (argv.baseUrl !== undefined) request.baseUrl = argv.baseUrl;
  if (argv.apiKey !== undefined) request.apiKey = argv.apiKey;

  if (argv.configOverrides) {
    const defaultsOverrides = Array.isArray(request.configOverrides)
      ? [...request.configOverrides]
      : [];
    request.configOverrides = [...defaultsOverrides, ...argv.configOverrides];
  }

  if (argv.addDir) {
    const defaultsAddDir = Array.isArray(request.addDir) ? [...request.addDir] : [];
    request.addDir = [...defaultsAddDir, ...argv.addDir];
  }

  if (argv.image) {
    const defaultsImages = Array.isArray(request.images) ? [...request.images] : [];
    request.images = [...defaultsImages, ...argv.image];
  }

  const thread: ThreadOptions = {
    model: request.model,
    oss: request.oss,
    sandboxMode: request.sandboxMode,
    approvalMode: request.approvalMode,
    workingDirectory: request.workingDirectory ?? cwd,
    skipGitRepoCheck: false,
  };

  return { request, thread };
}
