import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type CodexTestEnv = {
  env: Record<string, string>;
  cleanup: () => void;
};

export function createCodexTestEnv(): CodexTestEnv {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  for (const key of Object.keys(env)) {
    if (key.startsWith("CODEX_") || key.startsWith("OPENAI_")) {
      delete env[key];
    }
  }

  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-ts-sdk-home-"));
  env.CODEX_HOME = codexHome;

  return {
    env,
    cleanup: () => {
      fs.rmSync(codexHome, { recursive: true, force: true });
    },
  };
}
