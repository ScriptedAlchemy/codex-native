/**
 * Example: Using Codex review method to review code changes
 *
 * This demonstrates how to use the review() method on the Codex class
 * to perform code reviews with different targets.
 *
 * Review targets:
 * - current_changes: Review staged/unstaged files
 * - custom: Custom review prompt
 *
 * Usage:
 * ```bash
 * npx tsx examples/review-example.ts
 * ```
 */

import { Codex } from "../../src/index";
import fs from "fs/promises";
import path from "path";
import os from "os";

async function main() {
  // Create a temporary directory with some sample code to review
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-review-test-"));

  try {
    // Create a sample file with intentional issues
    const sampleCode = `
// Sample code with some issues
function calculateTotal(items) {
  var total = 0;  // Using var instead of const/let
  for (var i = 0; i < items.length; i++) {  // Could use forEach/map
    total = total + items[i].price;
  }
  return total;  // Missing input validation
}

// Function with potential bug
function divideNumbers(a, b) {
  return a / b;  // No zero-division check
}

// Unused function
function unusedFunction() {
  console.log("This is never called");
}
`;

    await fs.writeFile(path.join(tmpDir, "sample.js"), sampleCode);

    console.log("Created sample code for review in:", tmpDir);
    console.log("\nStarting code review with custom prompt...\n");

    // Create Codex instance
    const codex = new Codex();

    // Perform a custom review
    const result = await codex.review({
      target: {
        type: "custom",
        prompt: `Review the JavaScript code in sample.js. Look for:
1. Outdated JavaScript patterns (var, for loops)
2. Missing error handling
3. Potential bugs
4. Unused code

Provide a concise summary of findings with 2-3 key issues.`,
        hint: "JavaScript code review",
      },
      threadOptions: {
        model: "gpt-5-codex",
        workingDirectory: tmpDir,
        skipGitRepoCheck: true,
        fullAuto: true,
      },
    });

    console.log("\n" + "=".repeat(70));
    console.log("Review Results:");
    console.log("=".repeat(70) + "\n");

    if (result.finalResponse) {
      console.log(result.finalResponse);
    } else {
      console.log("[No final review summary produced]");
    }

    if (result.usage) {
      console.log(
        `\nToken usage: ${result.usage.input_tokens} input, ${result.usage.output_tokens} output`,
      );
    }

    console.log("\n✓ Review completed successfully");
  } finally {
    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    console.log("✓ Cleaned up temporary directory");
  }
}

main()
  .then(() => {
    console.log("\nExample completed successfully.");
    setTimeout(() => process.exit(0), 100);
  })
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
