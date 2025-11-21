import * as fs from "node:fs";
import * as path from "node:path";

import type { LspServerConfig, WorkspaceLocator } from "./types";

const MARKERS_NODE = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock"];
const MARKERS_PY = ["pyproject.toml", "requirements.txt", "Pipfile", "setup.py", "setup.cfg", "poetry.lock"];
const MARKERS_RUST = ["Cargo.toml"];

export const DEFAULT_SERVERS: LspServerConfig[] = [
  {
    id: "typescript",
    displayName: "TypeScript Language Server",
    command: ["typescript-language-server", "--stdio"],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    workspace: { type: "markers", include: MARKERS_NODE },
  },
  {
    id: "pyright",
    displayName: "Pyright",
    command: ["pyright-langserver", "--stdio"],
    extensions: [".py", ".pyi"],
    workspace: { type: "markers", include: MARKERS_PY },
  },
  {
    id: "rust-analyzer",
    displayName: "rust-analyzer",
    command: ["rust-analyzer"],
    extensions: [".rs"],
    workspace: { type: "markers", include: MARKERS_RUST },
  },
];

export function findServerForFile(filePath: string): LspServerConfig | undefined {
  const lower = filePath.toLowerCase();
  return DEFAULT_SERVERS.find((server) => server.extensions.some((ext) => lower.endsWith(ext)));
}

export function resolveWorkspaceRoot(
  filePath: string,
  locator: WorkspaceLocator | undefined,
  fallbackDir: string,
): string {
  if (!locator) {
    return fallbackDir;
  }
  if (locator.type === "fixed") {
    return locator.path;
  }
  const include = locator.include ?? [];
  const exclude = locator.exclude ?? [];
  let current = fs.statSync(filePath, { throwIfNoEntry: false })?.isDirectory()
    ? filePath
    : path.dirname(filePath);
  const root = path.parse(current).root;
  while (true) {
    if (exclude.some((pattern) => fs.existsSync(path.join(current, pattern)))) {
      break;
    }
    if (include.some((pattern) => fs.existsSync(path.join(current, pattern)))) {
      return current;
    }
    if (current === root) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return fallbackDir;
}

