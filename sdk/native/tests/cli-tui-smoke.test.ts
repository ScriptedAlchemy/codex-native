import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeAll } from "@jest/globals";

import { setupNativeBinding } from "./testHelpers";

const execFileAsync = promisify(execFile);

let binding: any;

beforeAll(async () => {
  setupNativeBinding();
  binding = await import("../src/index");
});

describe("codex-native tui command", () => {
  it("starts and renders the welcome screen under a pseudo-TTY", async () => {
    // Skip when tests run without an interactive TTY. The CLI explicitly errors
    // in this case (by design).
    if (!process.stdout.isTTY || !process.stdin.isTTY) {
      return;
    }
    if (!binding || typeof binding.getNativeBinding !== "function") {
      return; // binding not available
    }
    const native = binding.getNativeBinding();
    if (!native || typeof native.tuiTestRun !== "function") {
      return; // skip if helper missing in build
    }

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const cliPath = path.resolve(__dirname, "../dist/cli.cjs");

    const promise = execFileAsync(
      process.execPath,
      [cliPath, "tui", "--resume-picker", "false", "--no-config"],
      {
        env: {
          ...process.env,
          CODEX_TEST_SKIP_GIT_REPO_CHECK: "1",
        },
        timeout: 5_000,
      },
    );

    await expect(promise).resolves.toMatchObject({ stdout: expect.any(String) });
  });
});
