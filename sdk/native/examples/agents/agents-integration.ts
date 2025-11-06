/**
 * Example: Using CodexProvider with OpenAI Agents framework
 *
 * This example demonstrates how to use the Codex SDK as a model provider
 * for the OpenAI Agents JS framework, enabling powerful multi-agent workflows
 * with Codex's coding capabilities.
 *
 * Installation:
 * ```bash
 * npm install @codex-native/sdk @openai/agents
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/agents-integration.ts
 * ```
 */

import { CodexProvider } from "../../src/index";

// These would come from @openai/agents when installed
// import { Agent, Runner } from "@openai/agents";

// For demonstration purposes, showing the expected types
interface Agent {
  name: string;
  instructions: string;
  model?: string;
}

interface Runner {
  run(agent: Agent, input: string): Promise<{ finalOutput: string }>;
}

async function main() {
  console.log("🚀 Codex Provider for OpenAI Agents\n");

  // ============================================================================
  // Step 1: Create the CodexProvider
  // ============================================================================
  const provider = new CodexProvider({
    defaultModel: "gpt-5-codex",
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true, // For example purposes
  });

  console.log("✓ Created CodexProvider with Codex backend\n");

  // ============================================================================
  // Step 2: Create agents using OpenAI Agents framework
  // ============================================================================

  // Example agent definitions (would work with @openai/agents)
  const codingAssistant: Agent = {
    name: "CodingAssistant",
    instructions: `You are an expert coding assistant. You help developers:
- Fix bugs and errors in their code
- Write tests for their functions
- Refactor code for better quality
- Explain complex code sections

You have access to the full file system and can execute commands to verify your work.`,
  };

  const testRunner: Agent = {
    name: "TestRunner",
    instructions: `You are a test execution specialist. Your job is to:
- Run test suites and analyze results
- Identify failing tests and their causes
- Suggest fixes for test failures
- Verify that fixes resolve the issues`,
  };

  console.log("✓ Defined agents: CodingAssistant, TestRunner\n");

  // ============================================================================
  // Step 3: Run agent workflows
  // ============================================================================

  console.log("Example 1: Single agent task");
  console.log("─".repeat(60));

  // This would work with the actual Runner from @openai/agents
  // const runner = new Runner({ modelProvider: provider });
  //
  // const result = await runner.run(
  //   codingAssistant,
  //   "Review the test files and fix any failing tests"
  // );
  //
  // console.log(result.finalOutput);

  console.log(`
Input: "Review the test files and fix any failing tests"
Agent: CodingAssistant
Model: Codex (via CodexProvider)

Expected output:
- Codex would execute: pnpm test
- Analyze test failures
- Make code changes to fix failures
- Re-run tests to verify
- Report results
`);

  console.log("\nExample 2: Multi-agent workflow");
  console.log("─".repeat(60));

  console.log(`
Workflow:
1. CodingAssistant: "Implement a new feature X"
   → Codex writes the code and tests

2. TestRunner: "Run tests and verify the implementation"
   → Codex executes tests, reports results

3. CodingAssistant: "Fix any issues found"
   → Codex makes corrections based on test results

This demonstrates how multiple agents can collaborate,
each using Codex as their backend through the provider.
`);

  // ============================================================================
  // Step 4: Advanced features
  // ============================================================================

  console.log("\nAdvanced Features:");
  console.log("─".repeat(60));

  console.log(`
✓ Structured Output:
  - Provider converts OpenAI's JSON schema format
  - Codex enforces the schema during generation

✓ Streaming:
  - Real-time progress updates via getStreamedResponse()
  - Token-by-token generation for better UX

✓ Conversation Continuity:
  - Provider maintains thread state across turns
  - Codex remembers context and previous actions

✓ Tool Execution:
  - Codex handles tools internally (commands, file edits, MCP)
  - No need for framework-level tool configuration

✓ Multi-modal Input:
  - Support for text and images (available now!)
  - Images can be URLs, base64 data, or file paths
  - CodexProvider automatically handles image conversion
  - Codex can analyze screenshots and diagrams
`);

  // ============================================================================
  // Step 5: Direct usage without OpenAI Agents (for testing)
  // ============================================================================

  console.log("\n\nDirect Provider Usage (for testing):");
  console.log("─".repeat(60));

  const model = provider.getModel("gpt-5-codex");

  try {
    const response = await model.getResponse({
      systemInstructions: "You are a helpful coding assistant.",
      input: "What is the current working directory?",
      modelSettings: {
        temperature: 0.7,
        maxTokens: 1000,
      },
      tools: [],
      outputType: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            answer: {
              type: "string",
              description: "The answer to the question",
            },
          },
          required: ["answer"],
          additionalProperties: false,
        },
      },
      handoffs: [],
      tracing: { enabled: false },
    });

    console.log("\n✓ Response received:");
    console.log(`  Input tokens: ${response.usage.inputTokens}`);
    console.log(`  Output tokens: ${response.usage.outputTokens}`);
    console.log(`  Response ID: ${response.responseId}`);
    console.log(`\n  Output items: ${response.output.length}`);

    for (const item of response.output) {
      if (!item.type || item.type === "message") {
        console.log(`\n  Message: ${item.content[0]?.type === "output_text" ? item.content[0].text : "(non-text)"}`);
      }
    }
  } catch (error) {
    console.error("\n✗ Error:", error instanceof Error ? error.message : String(error));
  }

  console.log("\n\n" + "=".repeat(60));
  console.log("🎉 CodexProvider demo complete!");
  console.log("=".repeat(60));
}

// Run if executed directly
if (require.main === module) {
  main()
  .then(() => {
    // Force exit after completion to avoid hanging
    process.exit(0);
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { main };
