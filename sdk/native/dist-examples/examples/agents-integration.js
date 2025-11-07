"use strict";
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
var index_ts_1 = require("../src/index.ts");
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var provider, codingAssistant, testRunner, model, response, _i, _a, item, error_1;
        var _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    console.log("🚀 Codex Provider for OpenAI Agents\n");
                    provider = new index_ts_1.CodexProvider({
                        defaultModel: "gpt-5",
                        workingDirectory: process.cwd(),
                        skipGitRepoCheck: true, // For example purposes
                    });
                    console.log("✓ Created CodexProvider with Codex backend\n");
                    codingAssistant = {
                        name: "CodingAssistant",
                        instructions: "You are an expert coding assistant. You help developers:\n- Fix bugs and errors in their code\n- Write tests for their functions\n- Refactor code for better quality\n- Explain complex code sections\n\nYou have access to the full file system and can execute commands to verify your work.",
                    };
                    testRunner = {
                        name: "TestRunner",
                        instructions: "You are a test execution specialist. Your job is to:\n- Run test suites and analyze results\n- Identify failing tests and their causes\n- Suggest fixes for test failures\n- Verify that fixes resolve the issues",
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
                    console.log("\nInput: \"Review the test files and fix any failing tests\"\nAgent: CodingAssistant\nModel: Codex (via CodexProvider)\n\nExpected output:\n- Codex would execute: pnpm test\n- Analyze test failures\n- Make code changes to fix failures\n- Re-run tests to verify\n- Report results\n");
                    console.log("\nExample 2: Multi-agent workflow");
                    console.log("─".repeat(60));
                    console.log("\nWorkflow:\n1. CodingAssistant: \"Implement a new feature X\"\n   \u2192 Codex writes the code and tests\n\n2. TestRunner: \"Run tests and verify the implementation\"\n   \u2192 Codex executes tests, reports results\n\n3. CodingAssistant: \"Fix any issues found\"\n   \u2192 Codex makes corrections based on test results\n\nThis demonstrates how multiple agents can collaborate,\neach using Codex as their backend through the provider.\n");
                    // ============================================================================
                    // Step 4: Advanced features
                    // ============================================================================
                    console.log("\nAdvanced Features:");
                    console.log("─".repeat(60));
                    console.log("\n\u2713 Structured Output:\n  - Provider converts OpenAI's JSON schema format\n  - Codex enforces the schema during generation\n\n\u2713 Streaming:\n  - Real-time progress updates via getStreamedResponse()\n  - Token-by-token generation for better UX\n\n\u2713 Conversation Continuity:\n  - Provider maintains thread state across turns\n  - Codex remembers context and previous actions\n\n\u2713 Tool Execution:\n  - Codex handles tools internally (commands, file edits, MCP)\n  - No need for framework-level tool configuration\n\n\u2713 Multi-modal Input:\n  - Support for text and images (available now!)\n  - Images can be URLs, base64 data, or file paths\n  - CodexProvider automatically handles image conversion\n  - Codex can analyze screenshots and diagrams\n");
                    // ============================================================================
                    // Step 5: Direct usage without OpenAI Agents (for testing)
                    // ============================================================================
                    console.log("\n\nDirect Provider Usage (for testing):");
                    console.log("─".repeat(60));
                    model = provider.getModel("gpt-5");
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, model.getResponse({
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
                        })];
                case 2:
                    response = _c.sent();
                    console.log("\n✓ Response received:");
                    console.log("  Input tokens: ".concat(response.usage.inputTokens));
                    console.log("  Output tokens: ".concat(response.usage.outputTokens));
                    console.log("  Response ID: ".concat(response.responseId));
                    console.log("\n  Output items: ".concat(response.output.length));
                    for (_i = 0, _a = response.output; _i < _a.length; _i++) {
                        item = _a[_i];
                        if (!item.type || item.type === "message") {
                            console.log("\n  Message: ".concat(((_b = item.content[0]) === null || _b === void 0 ? void 0 : _b.type) === "output_text" ? item.content[0].text : "(non-text)"));
                        }
                    }
                    return [3 /*break*/, 4];
                case 3:
                    error_1 = _c.sent();
                    console.error("\n✗ Error:", error_1 instanceof Error ? error_1.message : String(error_1));
                    return [3 /*break*/, 4];
                case 4:
                    console.log("\n\n" + "=".repeat(60));
                    console.log("🎉 CodexProvider demo complete!");
                    console.log("=".repeat(60));
                    return [2 /*return*/];
            }
        });
    });
}
// Run if executed directly
if (require.main === module) {
    main()
        .then(function () {
        // Force exit after completion to avoid hanging
        process.exit(0);
    })
        .catch(function (error) {
        console.error("Fatal error:", error);
        process.exit(1);
    });
}
