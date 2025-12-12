/**
 * Shared test utilities for native SDK tests
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Resolves the path to the native binding binary for the current platform.
 * Sets the CODEX_NATIVE_BINDING environment variable so the native binding
 * loader will use the correct binary.
 */
export function setupNativeBinding(): void {
  const { platform, arch } = process;
  const rootDir = process.cwd();

  if (!process.env.CODEX_HOME) {
    const codexHome = path.join(rootDir, ".codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    process.env.CODEX_HOME = codexHome;
  }

  let bindingPath: string;
  if (platform === "darwin") {
    const suffix = arch === "arm64" ? "arm64" : "x64";
    bindingPath = `${rootDir}/codex_native.darwin-${suffix}.node`;
  } else if (platform === "win32") {
    const suffix = arch === "arm64" ? "arm64" : "x64";
    bindingPath = `${rootDir}/codex_native.win32-${suffix}-msvc.node`;
  } else if (platform === "linux") {
    const suffix = process.env.MUSL ? "musl" : "gnu";
    bindingPath = `${rootDir}/codex_native.linux-${arch}-${suffix}.node`;
  } else {
    throw new Error(`Unsupported platform for tests: ${platform} ${arch}`);
  }

  process.env.CODEX_NATIVE_BINDING = bindingPath;
}
