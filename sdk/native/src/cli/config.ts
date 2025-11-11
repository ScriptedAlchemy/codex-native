import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import type {
  CodexNativeConfig,
  ConfigLoaderOptions,
  LoadedConfigFile,
  LoadedPlugin,
} from "./types";

const requireFromThisModule = createRequire(import.meta.url);

const CONFIG_CANDIDATES = [
  "codex.config.js",
  "codex.config.cjs",
  "codex.config.mjs",
  "codex.config.ts",
  "codex.js",
  ".codexrc.js",
  ".codexrc.cjs",
  ".codexrc.mjs",
  ".codexrc.json",
] as const;

type ConfigDiscovery =
  | { path: string; type: "file" }
  | { path: string; type: "package-json"; field: string };

export async function loadCliConfig(options: ConfigLoaderOptions): Promise<LoadedConfigFile> {
  const warnings: string[] = [];

  const discovery = await resolveConfigPath(options);
  const configPath = discovery?.path ?? null;
  let config: CodexNativeConfig | null = null;

  if (discovery) {
    const loadResult = await loadConfig(discovery, warnings);
    config = loadResult ?? null;
    if (config && typeof config !== "object") {
      warnings.push(
        `Config at ${discovery.path} must export an object. Received ${typeof config}.`,
      );
      config = null;
    }
  }

  const plugins = await resolvePlugins({
    config,
    configPath,
    cliPluginPaths: options.pluginPaths ?? [],
    cwd: options.cwd,
    warnings,
  });

  return {
    configPath,
    config,
    plugins,
    warnings,
  };
}

async function resolveConfigPath(options: ConfigLoaderOptions): Promise<ConfigDiscovery | null> {
  if (options.explicitConfigPath) {
    const explicitPath = path.resolve(options.cwd, options.explicitConfigPath);
    if (!fs.existsSync(explicitPath)) {
      throw new Error(`Config file not found at ${explicitPath}`);
    }
    return classifyPath(explicitPath);
  }

  if (options.noConfig) {
    return null;
  }

  let currentDir = path.resolve(options.cwd);
  const visited = new Set<string>();

  while (!visited.has(currentDir)) {
    visited.add(currentDir);

    for (const candidate of CONFIG_CANDIDATES) {
      const candidatePath = path.join(currentDir, candidate);
      if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
        return classifyPath(candidatePath);
      }
    }

    const packageJsonPath = path.join(currentDir, "package.json");
    if (fs.existsSync(packageJsonPath) && fs.statSync(packageJsonPath).isFile()) {
      const manifest = await readJson(packageJsonPath);
      if (manifest && manifest.codexNative != null) {
        return { path: packageJsonPath, type: "package-json", field: "codexNative" };
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return null;
}

async function loadConfig(discovery: ConfigDiscovery, warnings: string[]): Promise<CodexNativeConfig | null> {
  if (discovery.type === "package-json") {
    const manifest = await readJson(discovery.path);
    if (!manifest) {
      warnings.push(`Failed to parse ${discovery.path}; ignoring config.`);
      return null;
    }
    const raw = manifest[discovery.field];
    if (typeof raw === "string") {
      const baseDir = path.dirname(discovery.path);
      const nestedPath = path.resolve(baseDir, raw);
      if (!fs.existsSync(nestedPath)) {
        throw new Error(
          `Config path "${raw}" referenced by ${discovery.field} in ${discovery.path} was not found.`,
        );
      }
      return loadConfig({ path: nestedPath, type: "file" }, warnings);
    }
    if (typeof raw === "object" && raw !== null) {
      return raw as CodexNativeConfig;
    }
    warnings.push(
      `The ${discovery.field} field in ${discovery.path} must be an object or path string.`,
    );
    return null;
  }

  const ext = path.extname(discovery.path).toLowerCase();
  if (ext === ".json") {
    const json = await readJson(discovery.path);
    if (json === null) {
      warnings.push(`Failed to parse JSON config at ${discovery.path}`);
    }
    return json as CodexNativeConfig | null;
  }

  if (ext === ".js" || ext === ".cjs") {
    return extractModuleDefault(await loadCommonJsModule(discovery.path)) as CodexNativeConfig | null;
  }

  if (ext === ".mjs") {
    return extractModuleDefault(await importModule(discovery.path)) as CodexNativeConfig | null;
  }

  if (ext === ".ts") {
    return extractModuleDefault(await loadTypeScriptModule(discovery.path, warnings)) as
      | CodexNativeConfig
      | null;
  }

  throw new Error(`Unsupported config extension "${ext}" at ${discovery.path}`);
}

async function resolvePlugins(params: {
  config: CodexNativeConfig | null;
  configPath: string | null;
  cliPluginPaths: string[];
  cwd: string;
  warnings: string[];
}): Promise<LoadedPlugin[]> {
  const plugins: LoadedPlugin[] = [];
  const { config, configPath, cliPluginPaths, cwd, warnings } = params;

  const configDir = configPath ? path.dirname(configPath) : cwd;

  const rawConfigPlugins = (config as { plugins?: unknown })?.plugins;
  const configPlugins = Array.isArray(rawConfigPlugins) ? (rawConfigPlugins as unknown[]) : [];
  for (const spec of configPlugins) {
    if (typeof spec === "string") {
      const loaded = await loadPlugin(spec, configDir, "config", warnings);
      if (loaded) {
        plugins.push(loaded);
      }
    } else if (spec != null) {
      plugins.push({
        source: "config",
        spec: "<inline>",
        plugin: spec,
      });
    }
  }

  for (const spec of cliPluginPaths) {
    const loaded = await loadPlugin(spec, cwd, "cli", warnings);
    if (loaded) {
      plugins.push(loaded);
    }
  }

  return plugins;
}

async function loadPlugin(
  spec: string,
  baseDir: string,
  source: LoadedPlugin["source"],
  warnings: string[],
): Promise<LoadedPlugin | null> {
  try {
    const resolved = resolveModule(spec, baseDir);
    const moduleExports = await loadModuleForPath(resolved);
    return {
      source,
      spec,
      resolvedPath: resolved,
      plugin: extractModuleDefault(moduleExports),
    };
  } catch (err) {
    warnings.push(`Failed to load plugin "${spec}": ${(err as Error).message}`);
    return null;
  }
}

async function loadModuleForPath(modulePath: string): Promise<unknown> {
  const ext = path.extname(modulePath).toLowerCase();
  if (ext === ".cjs") {
    return loadCommonJsModule(modulePath);
  }
  if (ext === ".mjs") {
    return importModule(modulePath);
  }
  if (ext === ".ts") {
    return loadTypeScriptModule(modulePath);
  }
  if (ext === ".json") {
    return readJson(modulePath);
  }
  if (ext === ".js") {
    try {
      return loadCommonJsModule(modulePath);
    } catch (err) {
      if (err instanceof Error && err.message.includes("ERR_REQUIRE_ESM")) {
        return importModule(modulePath);
      }
      throw err;
    }
  }
  return loadCommonJsModule(modulePath);
}

async function loadCommonJsModule(modulePath: string): Promise<unknown> {
  return requireFromThisModule(modulePath);
}

async function importModule(modulePath: string): Promise<unknown> {
  const href = pathToFileURL(modulePath).href;
  return import(href);
}

async function loadTypeScriptModule(modulePath: string, warnings?: string[]): Promise<unknown> {
  try {
    const { register } = requireFromThisModule("tsx/cjs/api");
    const unregister = register({ transpileOnly: true });
    try {
      return requireFromThisModule(modulePath);
    } finally {
      await maybeCall(unregister);
    }
  } catch (cjsError) {
    try {
      const api = await import("tsx/esm/api");
      const tsxEsm: string = "tsx/esm/api";
      // Use a dynamic specifier so type resolution doesn't require this module to exist at compile-time.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api: any = await import(tsxEsm as any);
      const unregister =
        typeof api.register === "function"
          ? api.register({ transpileOnly: true })
          : api.default({ transpileOnly: true });
      try {
        return importModule(modulePath);
      } finally {
        await maybeCall(unregister);
      }
    } catch (esmError) {
      const message = [
        `Failed to load TypeScript module ${modulePath}.`,
        "Install the \"tsx\" package or convert the config to JavaScript.",
      ].join(" ");
      if (warnings) {
        warnings.push(message);
        return null;
      }
      throw new Error(message);
    }
  }
}

async function readJson(filePath: string): Promise<any> {
  try {
    const raw = await fsPromises.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractModuleDefault<T>(module: T): T | unknown {
  if (module && typeof module === "object" && "default" in (module as Record<string, unknown>)) {
    const value = (module as Record<string, unknown>).default;
    if (value !== undefined) {
      return value;
    }
  }
  return module;
}

function resolveModule(specifier: string, baseDir: string): string {
  if (path.isAbsolute(specifier)) {
    return specifier;
  }
  return requireFromThisModule.resolve(specifier, { paths: [baseDir] });
}

function classifyPath(filePath: string): ConfigDiscovery {
  if (path.basename(filePath) === "package.json") {
    return { path: filePath, type: "package-json", field: "codexNative" };
  }
  return { path: filePath, type: "file" };
}

async function maybeCall(candidate: unknown): Promise<void> {
  if (typeof candidate === "function") {
    await Promise.resolve(candidate());
  }
}

