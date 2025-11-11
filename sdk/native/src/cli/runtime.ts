import { getNativeBinding } from "../nativeBinding";
import type {
  ApprovalHandler,
  ApprovalRegistration,
  CodexNativeConfig,
  CombinedConfig,
  HookConfig,
  HookRegistration,
  LoadedConfigFile,
  LoadedPlugin,
  PluginContext,
  ToolConfig,
  ToolInterceptorConfig,
} from "./types";

export async function buildCombinedConfig(params: {
  cwd: string;
  config: LoadedConfigFile;
}): Promise<CombinedConfig> {
  const { cwd, config } = params;
  const warnings = [...config.warnings];
  const combined: CombinedConfig = {
    runDefaults: {},
    tuiDefaults: {},
    tools: [],
    interceptors: [],
    approval: undefined,
    beforeStartHooks: [],
    onEventHooks: [],
    warnings,
    allowReservedInterceptors: false,
  };

  const pluginContext: PluginContext = { cwd, configPath: config.configPath };

  if (config.config) {
    accumulateConfig({
      combined,
      config: config.config,
      source: config.configPath ?? "config",
      warnings,
    });
  }

  for (const loaded of config.plugins) {
    const pluginConfig = await evaluatePlugin(loaded, pluginContext, warnings);
    if (pluginConfig) {
      accumulateConfig({
        combined,
        config: pluginConfig,
        source: loaded.spec,
        warnings,
      });
    }
  }

  combined.warnings = warnings;
  return combined;
}

export function applyNativeRegistrations(combined: CombinedConfig): void {
  const binding = getNativeBinding();
  if (!binding) {
    throw new Error("Native binding is not available.");
  }

  binding.clearRegisteredTools();

  // De‑dupe tools by name: first registration wins
  const seenTools = new Set<string>();
  for (const tool of combined.tools) {
    const { handler, ...info } = tool;
    const name = String((info as any).name);
    if (seenTools.has(name)) {
      combined.warnings.push(`Duplicate tool "${name}" ignored (first definition wins).`);
      continue;
    }
    seenTools.add(name);
    binding.registerTool(info as any, handler as any);
  }

  // Register approval callback first so its interceptors have priority
  if (combined.approval && typeof binding.registerApprovalCallback === "function") {
    binding.registerApprovalCallback(combined.approval.handler);
  }

  const RESERVED = new Set<string>(["local_shell", "exec_command", "apply_patch", "web_search"]);
  const seenInterceptors = new Set<string>();

  for (const interceptor of combined.interceptors) {
    const name = interceptor.toolName;
    if (RESERVED.has(name) && !combined.allowReservedInterceptors) {
      combined.warnings.push(
        `Interceptor for "${name}" ignored: reserved for approval gating. Use approvals() hook instead.`,
      );
      continue;
    }
    if (seenInterceptors.has(name)) {
      combined.warnings.push(
        `Multiple interceptors for "${name}" detected; only the first will be used.`,
      );
      continue;
    }
    seenInterceptors.add(name);
    binding.registerToolInterceptor(interceptor.toolName, interceptor.handler);
  }
}

async function evaluatePlugin(
  loaded: LoadedPlugin,
  context: PluginContext,
  warnings: string[],
): Promise<CodexNativeConfig | null> {
  const { plugin, spec } = loaded;

  try {
    if (typeof plugin === "function") {
      const result = await plugin(context);
      return coerceConfig(result, spec, warnings);
    }

    if (plugin && typeof plugin === "object") {
      const candidate = plugin as CodexNativeConfig & {
        setup?: (ctx: PluginContext) => unknown;
        config?: CodexNativeConfig | ((ctx: PluginContext) => unknown);
      };

      if (typeof candidate.setup === "function") {
        await candidate.setup(context);
      }

      if (typeof candidate.config === "function") {
        return coerceConfig(await candidate.config(context), spec, warnings);
      }

      if (candidate.config) {
        return coerceConfig(candidate.config, spec, warnings);
      }

      return coerceConfig(candidate, spec, warnings);
    }

    return coerceConfig(plugin, spec, warnings);
  } catch (error) {
    warnings.push(`Plugin "${spec}" threw an error: ${(error as Error).message}`);
    return null;
  }
}

function coerceConfig(
  value: unknown,
  source: string,
  warnings: string[],
): CodexNativeConfig | null {
  if (!value) {
    return null;
  }

  if (typeof value === "object") {
    return value as CodexNativeConfig;
  }

  warnings.push(`Plugin "${source}" did not return a config object.`);
  return null;
}

function accumulateConfig(params: {
  combined: CombinedConfig;
  config: CodexNativeConfig;
  source: string;
  warnings: string[];
}) {
  const { combined, config, source, warnings } = params;

  if (config.defaults?.run) {
    combined.runDefaults = { ...combined.runDefaults, ...config.defaults.run };
  }
  if (config.defaults?.tui) {
    combined.tuiDefaults = { ...combined.tuiDefaults, ...config.defaults.tui };
  }

  if (Array.isArray(config.tools)) {
    for (const tool of config.tools) {
      if (!tool || typeof tool !== "object" || typeof tool.handler !== "function") {
        warnings.push(`Invalid tool definition supplied by "${source}".`);
        continue;
      }
      combined.tools.push(tool);
    }
  }

  if (Array.isArray(config.interceptors)) {
    for (const interceptor of config.interceptors) {
      if (
        !interceptor ||
        typeof interceptor !== "object" ||
        typeof interceptor.toolName !== "string" ||
        typeof interceptor.handler !== "function"
      ) {
        warnings.push(`Invalid interceptor definition supplied by "${source}".`);
        continue;
      }
      combined.interceptors.push(interceptor);
    }
  }

  if (config.approvals) {
    if (typeof config.approvals !== "function") {
      warnings.push(`Approval callback from "${source}" must be a function.`);
    } else {
      if (combined.approval) {
        warnings.push(
          `Approval callback from "${source}" overrides handler from "${combined.approval.source}".`,
        );
      }
      combined.approval = { source, handler: config.approvals as ApprovalHandler };
    }
  }

  if (config.hooks) {
    addHooks(combined, config.hooks, source, warnings);
  }

  if (config.allowReservedInterceptors === true) {
    combined.allowReservedInterceptors = true;
  }
}

function addHooks(
  combined: CombinedConfig,
  hooks: HookConfig,
  source: string,
  warnings: string[],
): void {
  if (hooks.beforeStart) {
    const beforeStartCallbacks = Array.isArray(hooks.beforeStart)
      ? hooks.beforeStart
      : [hooks.beforeStart];
    for (const callback of beforeStartCallbacks) {
      if (typeof callback !== "function") {
        warnings.push(`beforeStart hook from "${source}" must be a function.`);
        continue;
      }
      combined.beforeStartHooks.push({ source, callback });
    }
  }

  if (hooks.onEvent) {
    const eventCallbacks = Array.isArray(hooks.onEvent) ? hooks.onEvent : [hooks.onEvent];
    for (const callback of eventCallbacks) {
      if (typeof callback !== "function") {
        warnings.push(`onEvent hook from "${source}" must be a function.`);
        continue;
      }
      combined.onEventHooks.push({ source, callback });
    }
  }
}

