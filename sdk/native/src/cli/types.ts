import type {
  ApprovalRequest,
  NativeRunRequest,
  NativeToolInfo,
  NativeToolInvocation,
  NativeToolResult,
  NativeToolInterceptorNativeContext,
} from "../nativeBinding";
import type { NativeTuiRequest } from "../tui";

export type CommandName = "run" | "tui";

export interface GlobalOptions {
  config?: string;
  noConfig?: boolean;
  plugin?: string[];
}

export type ToolHandler = (
  invocation: NativeToolInvocation,
) => NativeToolResult | Promise<NativeToolResult>;

export interface ToolConfig extends NativeToolInfo {
  handler: ToolHandler;
}

export type ToolInterceptorHandler = (
  context: NativeToolInterceptorNativeContext,
) => NativeToolResult | Promise<NativeToolResult>;

export interface ToolInterceptorConfig {
  toolName: string;
  handler: ToolInterceptorHandler;
}

export type ApprovalHandler = (request: ApprovalRequest) => boolean | Promise<boolean>;

export interface HookContext {
  command: CommandName;
  cwd: string;
  options: unknown;
}

export type BeforeStartHook = (context: HookContext) => void | Promise<void>;
export type EventHook = (event: unknown, context: HookContext) => void | Promise<void>;

export interface HookConfig {
  beforeStart?: BeforeStartHook | BeforeStartHook[];
  onEvent?: EventHook | EventHook[];
}

export type PluginConfigFactory = (
  context: PluginContext,
) => CodexNativeConfig | Promise<CodexNativeConfig>;
export type PluginSetupFn = (context: PluginContext) => void | Promise<void>;

export interface CodexNativePlugin {
  config?: CodexNativeConfig | PluginConfigFactory;
  setup?: PluginSetupFn;
}

export interface PluginContext {
  cwd: string;
  configPath: string | null;
}

export interface CodexNativeConfig {
  defaults?: {
    run?: Partial<NativeRunRequest>;
    tui?: Partial<NativeTuiRequest>;
  };
  tools?: ToolConfig[];
  interceptors?: ToolInterceptorConfig[];
  approvals?: ApprovalHandler;
  hooks?: HookConfig;
  plugins?: Array<string | CodexNativePlugin>;
  /**
   * Allow registering interceptors for reserved tool names (local_shell, exec_command, apply_patch).
   * These will be composed after approval interceptors. Use with caution.
   */
  allowReservedInterceptors?: boolean;
}

export interface LoadedPlugin {
  source: "config" | "cli";
  spec: string;
  plugin: unknown;
  resolvedPath?: string;
}

export interface ApprovalRegistration {
  source: string;
  handler: ApprovalHandler;
}

export interface HookRegistration<T> {
  source: string;
  callback: T;
}

export interface CombinedConfig {
  runDefaults: Partial<NativeRunRequest>;
  tuiDefaults: Partial<NativeTuiRequest>;
  tools: ToolConfig[];
  interceptors: ToolInterceptorConfig[];
  approval?: ApprovalRegistration;
  beforeStartHooks: Array<HookRegistration<BeforeStartHook>>;
  onEventHooks: Array<HookRegistration<EventHook>>;
  warnings: string[];
  allowReservedInterceptors: boolean;
}

export interface RunCommandOptions extends GlobalOptions {
  prompt?: string;
  model?: string;
  oss?: boolean;
  sandbox?: string;
  approval?: string;
  schema?: string;
  threadId?: string;
  baseUrl?: string;
  apiKey?: string;
  linuxSandboxPath?: string;
  fullAuto?: boolean;
  skipGitRepoCheck?: boolean;
  workingDirectory?: string;
  image?: string[];
  reviewMode?: boolean;
  reviewHint?: string;
}

export interface TuiCommandOptions extends GlobalOptions {
  prompt?: string;
  model?: string;
  oss?: boolean;
  sandbox?: string;
  approval?: string;
  resume?: string;
  resumeLast?: boolean;
  resumePicker?: boolean;
  fullAuto?: boolean;
  dangerouslyBypassApprovalsAndSandbox?: boolean;
  workingDirectory?: string;
  configProfile?: string;
  configOverrides?: string[];
  addDir?: string[];
  webSearch?: boolean;
  image?: string[];
  linuxSandboxPath?: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface ConfigLoaderOptions {
  cwd: string;
  explicitConfigPath?: string;
  noConfig?: boolean;
  pluginPaths?: string[];
}

export interface LoadedConfigFile {
  configPath: string | null;
  config: CodexNativeConfig | null;
  plugins: LoadedPlugin[];
  warnings: string[];
}

export interface CliContext {
  cwd: string;
  config: LoadedConfigFile;
  combinedConfig: CombinedConfig;
}

