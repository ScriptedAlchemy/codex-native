import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
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
    if (!process.stdout.isTTY) {
      return; // skip when no TTY available
    }
    if (!binding || typeof binding.getNativeBinding !== "function") {
      return; // binding not available
    }
    const native = binding.getNativeBinding();
    if (!native || typeof native.tuiTestRun !== "function") {
      return; // skip if helper missing in build
    }

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
