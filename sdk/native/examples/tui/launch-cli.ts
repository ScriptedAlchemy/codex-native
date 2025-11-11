import { spawn } from "node:child_process";
import path from "node:path";

async function main(): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.warn(
      "The codex-native TUI requires an interactive terminal (TTY). Run this example in a terminal session or invoke `codex-native run` for non-interactive usage.",
    );
    return;
  }

  const cliEntry = path.resolve(__dirname, "../../dist/cli.cjs");
  const prompt = process.argv.slice(2).join(" ") || "Open the resume picker and continue my last session.";

  console.log("Spawning codex-native tui ...\n");

  const child = spawn(process.execPath, [cliEntry, "tui", prompt], {
    stdio: "inherit",
    env: {
      ...process.env,
      CODEX_TEST_SKIP_GIT_REPO_CHECK: "1",
    },
  });

  await new Promise<void>((resolve, reject) => {
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`codex-native tui exited with status ${code}`));
      }
    });
    child.on("error", reject);
  });

  console.log("\ncodex-native tui session complete.");
}

main().catch((error) => {
  console.error("Failed to launch codex-native tui via CLI:", error);
  process.exitCode = 1;
});
