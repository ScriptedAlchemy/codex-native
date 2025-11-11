import { Codex } from "../../src/index";

console.log("🔧 Tool Override Examples\n");
console.log("This demonstrates how to override Codex's built-in tools");
console.log("with custom implementations.\n");

console.log("=".repeat(70));
console.log("Example 1: Override read_file with a mock implementation");
console.log("=".repeat(70));

const codex1 = new Codex();

// Override read_file to return mock data
codex1.registerTool({
  name: "read_file",
  description: "Read a file from the filesystem (mocked)",
  parameters: {
    type: "object",
    properties: {
      target_file: {
        type: "string",
        description: "Path to the file to read",
      },
    },
    required: ["target_file"],
  },
  handler: async ({ target_file }: any) => {
    console.log(`  📄 Mock read_file called for: ${target_file}`);
    return { output: `[MOCK CONTENT] This is fake content for ${target_file}`, success: true };
  },
});

console.log("✓ Registered custom read_file handler");
console.log(
  "  When Codex tries to read files, it will use the mock implementation\n",
);

console.log("=".repeat(70));
console.log("Example 2: Override grep with a logging wrapper");
console.log("=" .repeat(70));

const codex2 = new Codex();

// Override grep to add logging
codex2.registerTool({
  name: "grep",
  description: "Search for patterns with logging",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Pattern to search for" },
      path: { type: "string", description: "Path to search in" },
      output_mode: {
        type: "string",
        enum: ["content", "files_with_matches", "count"],
      },
    },
    required: ["pattern"],
  },
  handler: async ({ pattern, path, output_mode }: any) => {
    console.log(`  🔍 Grep override called:`);
    console.log(`     Pattern: ${pattern}`);
    console.log(`     Path: ${path || "(workspace root)"}`);
    console.log(`     Mode: ${output_mode || "content"}`);

    // Return mock results
    return { output: JSON.stringify({ matches: [`Mock result for pattern: ${pattern}`] }), success: true };
  },
});

console.log("✓ Registered custom grep handler");
console.log("  All grep operations will now be logged\n");

console.log("=" .repeat(70));
console.log("Example 3: Override local_shell to block dangerous commands");
console.log("=" .repeat(70));

const codex3 = new Codex();

const BLOCKED_COMMANDS = ["rm -rf", "dd if=", "mkfs", "> /dev/"];

codex3.registerTool({
  name: "local_shell",
  description: "Execute shell commands with safety checks",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Command to execute" },
    },
    required: ["command"],
  },
  handler: async ({ command }: any) => {
    console.log(`  🛡️  Shell command intercepted: ${command}`);

    // Check if command is blocked
    for (const blocked of BLOCKED_COMMANDS) {
      if (command.includes(blocked)) {
        console.log(`  ❌ BLOCKED: Command contains dangerous pattern "${blocked}"`);
        return { error: `Command blocked for safety: contains "${blocked}"`, success: false };
      }
    }

    console.log(`  ✓ Command allowed (would execute in real implementation)`);
    return { output: JSON.stringify({ stdout: "[Mock output] Command would run here" }), success: true };
  },
});

console.log("✓ Registered safety-checking shell handler");
console.log("  Dangerous commands will be blocked before execution\n");

console.log("=" .repeat(70));
console.log("Example 4: Override multiple tools at once");
console.log("=" .repeat(70));

const codex4 = new Codex();

// Override multiple file operations
const fileTools = [
  {
    name: "read_file",
    handler: async ({ target_file }: any) => {
      return { output: JSON.stringify({ content: `[READ] ${target_file}` }), success: true };
    },
  },
  {
    name: "write",
    handler: async ({ file_path, contents }: any) => {
      return { output: JSON.stringify({ path: file_path, wrote: true }), success: true };
    },
  },
  {
    name: "search_replace",
    handler: async ({ file_path, old_string, new_string }: any) => {
      return { output: JSON.stringify({ file: file_path, replacements: 1 }), success: true };
    },
  },
];

for (const tool of fileTools) {
  codex4.registerTool({
    name: tool.name,
    description: `Custom ${tool.name}`,
    parameters: { type: "object", properties: {} },
    handler: tool.handler,
  });
  console.log(`  ✓ Registered custom ${tool.name}`);
}

console.log("\nAll file operations now use custom implementations\n");

console.log("=" .repeat(70));
console.log("Example 5: Restore defaults by clearing tools");
console.log("=" .repeat(70));

const codex5 = new Codex();

// Register an override
codex5.registerTool({
  name: "grep",
  description: "Custom grep",
  parameters: { type: "object", properties: {} },
  handler: async () => ({ output: "custom", success: true }),
});

console.log("✓ Registered custom grep");

// Clear to restore defaults
codex5.clearTools();
console.log("✓ Cleared all custom tools");
console.log("  Built-in tools are now restored\n");

console.log("=" .repeat(70));
console.log("Key Takeaways");
console.log("=" .repeat(70));
console.log(`
Tool Override Use Cases:
  • Testing: Mock file operations, commands, and network calls
  • Safety: Add validation or block dangerous operations
  • Logging: Wrap built-in tools with instrumentation
  • Customization: Replace default behavior with domain-specific logic
  • Integration: Bridge Codex tools with existing systems

Supported Override Targets:
  • File operations: read_file, write, search_replace, delete_file
  • Search: grep, glob_file_search, codebase_search
  • Execution: local_shell, exec_command
  • Git: git operations
  • MCP: Any MCP server tool
  • And all other built-in Codex tools

Notes:
  • Overrides apply to the specific Codex instance
  • clearTools() removes overrides and restores defaults
  • Tool handlers run in native code (Rust), not JavaScript
  • The handler signature must match the tool's parameter schema
`);

console.log("=" .repeat(70));
console.log("✓ All tool override examples complete!");
console.log("=" .repeat(70));

