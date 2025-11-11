#!/usr/bin/env node

import process from "node:process";
import { parseArgs } from "node:util";

import packageJson from "../../package.json";
import { loadCliConfig } from "./config";
import { executeRunCommand } from "./run";
import { executeTuiCommand } from "./tui";
import type {
  CliContext,
  ConfigLoaderOptions,
  GlobalOptions,
  RunCommandOptions,
  TuiCommandOptions,
  CommandName,
} from "./types";
import { applyNativeRegistrations, buildCombinedConfig } from "./runtime";

const VERSION = packageJson.version;
const SANDBOX_CHOICES = ["read-only", "workspace-write", "danger-full-access"] as const;
const APPROVAL_CHOICES = ["never", "on-request", "on-failure", "untrusted"] as const;

const GLOBAL_OPTION_DEFS = {
  config: { type: "string" } as const,
  "no-config": { type: "boolean" } as const,
  plugin: { type: "string", multiple: true } as const,
};

const RUN_OPTION_DEFS = {
  model: { type: "string" } as const,
  oss: { type: "boolean" } as const,
  sandbox: { type: "string" } as const,
  approval: { type: "string" } as const,
  schema: { type: "string" } as const,
  "thread-id": { type: "string" } as const,
  "base-url": { type: "string" } as const,
  "api-key": { type: "string" } as const,
  "linux-sandbox-path": { type: "string" } as const,
  "full-auto": { type: "boolean" } as const,
  "skip-git-repo-check": { type: "boolean" } as const,
  cd: { type: "string" } as const,
  image: { type: "string", multiple: true } as const,
  "review-mode": { type: "boolean" } as const,
  "review-hint": { type: "string" } as const,
};

const TUI_OPTION_DEFS = {
  model: { type: "string" } as const,
  oss: { type: "boolean" } as const,
  sandbox: { type: "string" } as const,
  approval: { type: "string" } as const,
  resume: { type: "string" } as const,
  "resume-last": { type: "boolean" } as const,
  "resume-picker": { type: "boolean" } as const,
  "full-auto": { type: "boolean" } as const,
  "dangerously-bypass-approvals-and-sandbox": { type: "boolean" } as const,
  cd: { type: "string" } as const,
  "config-profile": { type: "string" } as const,
  "config-overrides": { type: "string", multiple: true } as const,
  "add-dir": { type: "string", multiple: true } as const,
  image: { type: "string", multiple: true } as const,
  "web-search": { type: "boolean" } as const,
  "linux-sandbox-path": { type: "string" } as const,
  "base-url": { type: "string" } as const,
  "api-key": { type: "string" } as const,
};

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  if (hasFlag(rawArgs, "--version") || hasFlag(rawArgs, "-v")) {
    printVersion();
    return;
  }

  const generalHelpRequested = hasFlag(rawArgs, "--help") || hasFlag(rawArgs, "-h");

  const { command, args } = selectCommand(rawArgs);

  if (generalHelpRequested && command === "run" && args.length === rawArgs.length) {
    printGeneralHelp();
    return;
  }

  if (hasCommandHelpFlag(args)) {
    printCommandHelp(command);
    return;
  }

  const options =
    command === "tui" ? parseTuiCommand(args) : parseRunCommand(args);

  validateOptionChoices(command, options);

  const context = await createContext(options);

  if (command === "tui") {
    await executeTuiCommand(options as TuiCommandOptions, context);
  } else {
    await executeRunCommand(options as RunCommandOptions, context);
  }
}

function selectCommand(argv: string[]): { command: CommandName; args: string[] } {
  if (argv.length === 0) {
    return { command: "run", args: [] };
  }
  const [first, ...rest] = argv;
  if (first === "tui") {
    return { command: "tui", args: rest };
  }
  if (first === "run") {
    return { command: "run", args: rest };
  }
  return { command: "run", args: argv };
}

function parseRunCommand(args: string[]): RunCommandOptions {
  const { values, positionals } = parseArgs({
    args,
    options: { ...GLOBAL_OPTION_DEFS, ...RUN_OPTION_DEFS },
    allowPositionals: true,
    strict: true,
  });
  const options = camelCaseKeys(values);
  const runOptions: RunCommandOptions = {
    ...(options as RunCommandOptions),
  };
  if (!runOptions.prompt && positionals.length > 0) {
    runOptions.prompt = positionals[0];
  }
  return runOptions;
}

function parseTuiCommand(args: string[]): TuiCommandOptions {
  const { values, positionals } = parseArgs({
    args,
    options: { ...GLOBAL_OPTION_DEFS, ...TUI_OPTION_DEFS },
    allowPositionals: true,
    strict: true,
  });
  const options = camelCaseKeys(values);
  const tuiOptions: TuiCommandOptions = {
    ...(options as TuiCommandOptions),
  };
  if (!tuiOptions.prompt && positionals.length > 0) {
    tuiOptions.prompt = positionals[0];
  }
  return tuiOptions;
}

async function createContext(options: GlobalOptions): Promise<CliContext> {
  const cwd = process.cwd();
  const configOptions: ConfigLoaderOptions = {
    cwd,
    explicitConfigPath: options.config,
    noConfig: options.noConfig,
    pluginPaths: normalizeStringArray(options.plugin),
  };
  const config = await loadCliConfig(configOptions);
  const combinedConfig = await buildCombinedConfig({ cwd, config });
  applyNativeRegistrations(combinedConfig);
  return { cwd, config, combinedConfig };
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
}

function camelCaseKeys(record: Record<string, unknown>): Record<string, unknown> {
  return Object.entries(record).reduce<Record<string, unknown>>((acc, [key, value]) => {
    acc[toCamelCase(key)] = value;
    return acc;
  }, {});
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function hasCommandHelpFlag(args: string[]): boolean {
  return hasFlag(args, "--help") || hasFlag(args, "-h");
}

function printVersion(): void {
  console.log(VERSION);
}

function printGeneralHelp(): void {
  console.log(`codex-native v${VERSION}

Usage:
  codex-native [run] [options] [prompt]
  codex-native tui [options] [prompt]

Commands:
  run (default)   Run Codex in exec mode
  tui             Launch the interactive TUI

Global options:
  --config <path>        Path to codex.config.js (or similar)
  --no-config            Skip automatic config discovery
  --plugin <path>        Additional plugin module (repeatable)

Run options:
  --model <slug>         Model slug to use
  --oss                  Use the built-in OSS provider
  --sandbox <mode>       ${SANDBOX_CHOICES.join(" | ")}
  --approval <policy>    ${APPROVAL_CHOICES.join(" | ")}
  --schema <file>        Path to final-output JSON schema
  --thread-id <id>       Resume an existing thread
  --base-url <url>       Override the Codex API base URL
  --api-key <key>        API key for Codex requests
  --linux-sandbox-path   Path to codex-linux-sandbox binary
  --full-auto            Enable workspace-write auto approvals
  --skip-git-repo-check  Skip git repository validation
  --cd <path>            Working directory for the run
  --image <path>         Attach an image (repeatable)
  --review-mode          Enable review mode
  --review-hint <text>   Hint text for review mode

TUI options:
  --model <slug>         Model slug to use
  --oss                  Use the built-in OSS provider
  --sandbox <mode>       ${SANDBOX_CHOICES.join(" | ")}
  --approval <policy>    ${APPROVAL_CHOICES.join(" | ")}
  --resume <id>          Resume a saved session by id
  --resume-last          Resume the most recent saved session
  --resume-picker        Show the resume picker on startup
  --full-auto            Enable workspace-write auto approvals
  --dangerously-bypass-approvals-and-sandbox
                        Disable approvals and sandboxing (unsafe)
  --cd <path>            Working directory for the session
  --config-profile <name> Config profile to activate
  --config-overrides <kv> Config overrides (key=value, repeatable)
  --add-dir <path>       Additional writable directory (repeatable)
  --image <path>         Attach an image (repeatable)
  --web-search           Enable web search tool
  --linux-sandbox-path   Path to codex-linux-sandbox binary
  --base-url <url>       Override the Codex API base URL
  --api-key <key>        API key for Codex requests
`);
}

function printCommandHelp(command: CommandName): void {
  if (command === "tui") {
    console.log(`codex-native tui [options] [prompt]

Options:
  --model <slug>         Model slug to use
  --oss                  Use the built-in OSS provider
  --sandbox <mode>       ${SANDBOX_CHOICES.join(" | ")}
  --approval <policy>    ${APPROVAL_CHOICES.join(" | ")}
  --resume <id>          Resume a saved session by id
  --resume-last          Resume the most recent saved session
  --resume-picker        Show the resume picker on startup
  --full-auto            Enable workspace-write auto approvals
  --dangerously-bypass-approvals-and-sandbox
                        Disable approvals and sandboxing (unsafe)
  --cd <path>            Working directory for the session
  --config-profile <name> Config profile to activate
  --config-overrides <kv> Config overrides (key=value, repeatable)
  --add-dir <path>       Additional writable directory (repeatable)
  --image <path>         Attach an image (repeatable)
  --web-search           Enable web search tool
  --linux-sandbox-path   Path to codex-linux-sandbox binary
  --base-url <url>       Override the Codex API base URL
  --api-key <key>        API key for Codex requests
`);
  } else {
    console.log(`codex-native run [options] [prompt]

Options:
  --model <slug>         Model slug to use
  --oss                  Use the built-in OSS provider
  --sandbox <mode>       ${SANDBOX_CHOICES.join(" | ")}
  --approval <policy>    ${APPROVAL_CHOICES.join(" | ")}
  --schema <file>        Path to final-output JSON schema
  --thread-id <id>       Resume an existing thread
  --base-url <url>       Override the Codex API base URL
  --api-key <key>        API key for Codex requests
  --linux-sandbox-path   Path to codex-linux-sandbox binary
  --full-auto            Enable workspace-write auto approvals
  --skip-git-repo-check  Skip git repository validation
  --cd <path>            Working directory for the run
  --image <path>         Attach an image (repeatable)
  --review-mode          Enable review mode
  --review-hint <text>   Hint text for review mode
`);
  }
}

function validateOptionChoices(
  command: CommandName,
  options: RunCommandOptions | TuiCommandOptions,
): void {
  const sandbox = options.sandbox;
  if (sandbox && !SANDBOX_CHOICES.includes(sandbox as (typeof SANDBOX_CHOICES)[number])) {
    throw new Error(
      `Invalid sandbox mode "${sandbox}". Valid modes: ${SANDBOX_CHOICES.join(", ")}.`,
    );
  }
  const approval = options.approval;
  if (approval && !APPROVAL_CHOICES.includes(approval as (typeof APPROVAL_CHOICES)[number])) {
    throw new Error(
      `Invalid approval policy "${approval}". Valid policies: ${APPROVAL_CHOICES.join(", ")}.`,
    );
  }
}

function logError(error: unknown): void {
  if (error instanceof Error) {
    console.error(error.message);
    if (process.env.CODEX_NATIVE_DEBUG) {
      console.error(error.stack);
    }
  } else {
    console.error(String(error));
  }
}

main().catch((error) => {
  logError(error);
  process.exitCode = 1;
});

