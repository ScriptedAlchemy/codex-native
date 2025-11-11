import { describe, it, expect, afterEach } from "@jest/globals";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { loadCliConfig } from "../src/cli/config";

const TEMP_PREFIX = "codex-cli-config-test-";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("loadCliConfig", () => {
  it("loads explicit config file path", async () => {
    const dir = await createTempDir();
    const configPath = path.join(dir, "codex.config.js");
    await fs.writeFile(
      configPath,
      [
        "module.exports = {",
        "  defaults: { run: { model: 'gpt-5-codex' } },",
        "  hooks: { beforeStart: [() => {}] },",
        "};",
      ].join("\n"),
    );

    const result = await loadCliConfig({ cwd: dir, explicitConfigPath: configPath });

    expect(result.configPath).toBe(configPath);
    expect(result.config?.defaults?.run?.model).toBe("gpt-5-codex");
    expect(result.warnings).toHaveLength(0);
  });

  it("discovers config from ancestor directory when not present in cwd", async () => {
    const parent = await createTempDir();
    const child = path.join(parent, "child");
    await fs.mkdir(child);
    const configPath = path.join(parent, "codex.config.js");
    await fs.writeFile(
      configPath,
      "module.exports = { defaults: { run: { model: 'gpt-5' } } };",
    );

    const result = await loadCliConfig({ cwd: child });

    expect(result.configPath).toBe(configPath);
    expect(result.config?.defaults?.run?.model).toBe("gpt-5");
  });

  it("loads config embedded in package.json", async () => {
    const dir = await createTempDir();
    const packageJsonPath = path.join(dir, "package.json");
    await fs.writeFile(
      packageJsonPath,
      JSON.stringify(
        {
          name: "codex-native-config-test",
          version: "1.0.0",
          codexNative: {
            defaults: { run: { model: "gpt-5-codex" } },
          },
        },
        null,
        2,
      ),
    );

    const result = await loadCliConfig({ cwd: dir });

    expect(result.configPath).toBe(packageJsonPath);
    expect(result.config?.defaults?.run?.model).toBe("gpt-5-codex");
  });

  it("loads plugins from config and CLI overrides", async () => {
    const dir = await createTempDir();
    const pluginDir = path.join(dir, "plugins");
    await fs.mkdir(pluginDir);
    const configPluginPath = path.join(pluginDir, "config-plugin.js");
    await fs.writeFile(
      configPluginPath,
      "module.exports = { config: { defaults: { tui: { model: 'gpt-5' } } } };",
    );
    const cliPluginPath = path.join(pluginDir, "cli-plugin.js");
    await fs.writeFile(
      cliPluginPath,
      "module.exports = () => ({ defaults: { run: { oss: true } } });",
    );
    const configPath = path.join(dir, "codex.config.js");
    await fs.writeFile(
      configPath,
      [
        "module.exports = {",
        "  plugins: [",
        "    './plugins/config-plugin.js',",
        "    { inline: true }",
        "  ]",
        "};",
      ].join("\n"),
    );

    const result = await loadCliConfig({
      cwd: dir,
      pluginPaths: [cliPluginPath],
    });

    expect(result.plugins).toHaveLength(3);
    const pluginSpecs = result.plugins.map((p) => p.spec);
    expect(pluginSpecs).toEqual([
      "./plugins/config-plugin.js",
      "<inline>",
      cliPluginPath,
    ]);
    expect((result.plugins[1].plugin as { inline: boolean }).inline).toBe(true);
    expect(typeof result.plugins[2].plugin).toBe("function");
  });

  it("respects --no-config while still loading CLI plugins", async () => {
    const dir = await createTempDir();
    const pluginPath = path.join(dir, "plugin.js");
    await fs.writeFile(
      pluginPath,
      "module.exports = { setup: () => {}, config: { defaults: { run: { oss: true } } } };",
    );

    const result = await loadCliConfig({
      cwd: dir,
      noConfig: true,
      pluginPaths: [pluginPath],
    });

    expect(result.configPath).toBeNull();
    expect(result.config).toBeNull();
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].resolvedPath).toBe(pluginPath);
  });

  it("loads allowReservedInterceptors config option", async () => {
    const dir = await createTempDir();
    const configPath = path.join(dir, "codex.config.js");
    await fs.writeFile(
      configPath,
      [
        "module.exports = {",
        "  allowReservedInterceptors: true,",
        "  interceptors: [{",
        "    toolName: 'exec_command',",
        "    handler: () => ({ output: 'intercepted', success: true })",
        "  }],",
        "};",
      ].join("\n"),
    );

    const result = await loadCliConfig({ cwd: dir });

    expect(result.configPath).toBe(configPath);
    expect(result.config?.allowReservedInterceptors).toBe(true);
    expect(result.config?.interceptors).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
  });
});

