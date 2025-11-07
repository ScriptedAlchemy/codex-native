"use strict";
/**
 * Example: Automatic Tool Registration with CodexProvider
 *
 * This example demonstrates how tools are automatically registered when
 * passed to an Agent using CodexProvider. No manual tool registration
 * or configuration is required - the provider handles everything seamlessly.
 *
 * Key concepts:
 * - Tools defined with zod schemas are automatically validated
 * - Multiple tools can be provided to a single agent
 * - Tools are available immediately when the agent runs
 * - Tool execution results are automatically passed back to the model
 *
 * Installation:
 * ```bash
 * npm install @codex-native/sdk @openai/agents zod
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/automatic-tool-registration.ts
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
var zod_1 = require("zod");
var agents_1 = require("@openai/agents");
var index_ts_1 = require("../src/index.ts");
var promises_1 = require("fs/promises");
var path_1 = require("path");
var os_1 = require("os");
// Define a calculator tool
var calculatorTool = (0, agents_1.tool)({
    name: 'calculator',
    description: 'Perform basic arithmetic operations',
    parameters: zod_1.z.object({
        operation: zod_1.z.enum(['add', 'subtract', 'multiply', 'divide']).describe('The operation to perform'),
        a: zod_1.z.number().describe('First number'),
        b: zod_1.z.number().describe('Second number'),
    }),
    execute: function (input) { return __awaiter(void 0, void 0, void 0, function () {
        var result;
        return __generator(this, function (_a) {
            console.log("[Tool called: calculator(".concat(input.operation, ", ").concat(input.a, ", ").concat(input.b, ")]"));
            switch (input.operation) {
                case 'add':
                    result = input.a + input.b;
                    break;
                case 'subtract':
                    result = input.a - input.b;
                    break;
                case 'multiply':
                    result = input.a * input.b;
                    break;
                case 'divide':
                    if (input.b === 0) {
                        return [2 /*return*/, 'Error: Division by zero'];
                    }
                    result = input.a / input.b;
                    break;
            }
            return [2 /*return*/, "".concat(input.a, " ").concat(input.operation, " ").concat(input.b, " = ").concat(result)];
        });
    }); },
});
// Define a unit conversion tool
var unitConverterTool = (0, agents_1.tool)({
    name: 'convert_units',
    description: 'Convert between different units of measurement',
    parameters: zod_1.z.object({
        value: zod_1.z.number().describe('The value to convert'),
        fromUnit: zod_1.z.enum(['meters', 'feet', 'kilograms', 'pounds', 'celsius', 'fahrenheit'])
            .describe('The unit to convert from'),
        toUnit: zod_1.z.enum(['meters', 'feet', 'kilograms', 'pounds', 'celsius', 'fahrenheit'])
            .describe('The unit to convert to'),
    }),
    execute: function (input) { return __awaiter(void 0, void 0, void 0, function () {
        var result;
        return __generator(this, function (_a) {
            console.log("[Tool called: convert_units(".concat(input.value, " ").concat(input.fromUnit, " \u2192 ").concat(input.toUnit, ")]"));
            // Length conversions
            if (input.fromUnit === 'meters' && input.toUnit === 'feet') {
                result = input.value * 3.28084;
            }
            else if (input.fromUnit === 'feet' && input.toUnit === 'meters') {
                result = input.value / 3.28084;
            }
            // Weight conversions
            else if (input.fromUnit === 'kilograms' && input.toUnit === 'pounds') {
                result = input.value * 2.20462;
            }
            else if (input.fromUnit === 'pounds' && input.toUnit === 'kilograms') {
                result = input.value / 2.20462;
            }
            // Temperature conversions
            else if (input.fromUnit === 'celsius' && input.toUnit === 'fahrenheit') {
                result = (input.value * 9 / 5) + 32;
            }
            else if (input.fromUnit === 'fahrenheit' && input.toUnit === 'celsius') {
                result = (input.value - 32) * 5 / 9;
            }
            // Same unit
            else if (input.fromUnit === input.toUnit) {
                result = input.value;
            }
            else {
                return [2 /*return*/, "Error: Cannot convert from ".concat(input.fromUnit, " to ").concat(input.toUnit)];
            }
            return [2 /*return*/, "".concat(input.value, " ").concat(input.fromUnit, " = ").concat(result.toFixed(2), " ").concat(input.toUnit)];
        });
    }); },
});
// Define a text analysis tool
var textAnalysisTool = (0, agents_1.tool)({
    name: 'analyze_text',
    description: 'Analyze text and return statistics',
    parameters: zod_1.z.object({
        text: zod_1.z.string().describe('The text to analyze'),
    }),
    execute: function (input) { return __awaiter(void 0, void 0, void 0, function () {
        var words, sentences, characters, charactersNoSpaces;
        return __generator(this, function (_a) {
            console.log("[Tool called: analyze_text(text length: ".concat(input.text.length, ")]"));
            words = input.text.split(/\s+/).filter(function (w) { return w.length > 0; });
            sentences = input.text.split(/[.!?]+/).filter(function (s) { return s.trim().length > 0; });
            characters = input.text.length;
            charactersNoSpaces = input.text.replace(/\s/g, '').length;
            return [2 /*return*/, JSON.stringify({
                    characters: characters,
                    charactersNoSpaces: charactersNoSpaces,
                    words: words.length,
                    sentences: sentences.length,
                    averageWordLength: (charactersNoSpaces / words.length).toFixed(2),
                }, null, 2)];
        });
    }); },
});
function basicToolExample() {
    return __awaiter(this, void 0, void 0, function () {
        var tmpDir, provider, model, calculatorAgent, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('\n' + '='.repeat(70));
                    console.log('Example 1: Basic Automatic Tool Registration');
                    console.log('='.repeat(70) + '\n');
                    return [4 /*yield*/, promises_1.default.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'codex-tool-example-'))];
                case 1:
                    tmpDir = _a.sent();
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, , 5, 7]);
                    provider = new index_ts_1.CodexProvider({
                        defaultModel: 'gpt-5',
                        workingDirectory: tmpDir,
                        skipGitRepoCheck: true,
                    });
                    return [4 /*yield*/, provider.getModel()];
                case 3:
                    model = _a.sent();
                    calculatorAgent = new agents_1.Agent({
                        name: 'CalculatorAgent',
                        model: model,
                        instructions: 'You are a helpful calculator assistant. Use the calculator tool to perform operations. Answer directly with just the calculation result.',
                        tools: [calculatorTool],
                    });
                    console.log('✓ Created CalculatorAgent');
                    console.log('✓ Tool "calculator" automatically registered\n');
                    console.log('─'.repeat(70));
                    console.log('Query: "What is 123 multiplied by 456?"\n');
                    return [4 /*yield*/, (0, agents_1.run)(calculatorAgent, 'What is 123 multiplied by 456?')];
                case 4:
                    result = _a.sent();
                    console.log('\n[Final response]');
                    console.log(result.finalOutput);
                    return [3 /*break*/, 7];
                case 5: 
                // Cleanup temp directory
                return [4 /*yield*/, promises_1.default.rm(tmpDir, { recursive: true, force: true }).catch(function () { })];
                case 6:
                    // Cleanup temp directory
                    _a.sent();
                    return [7 /*endfinally*/];
                case 7: return [2 /*return*/];
            }
        });
    });
}
function multipleToolsExample() {
    return __awaiter(this, void 0, void 0, function () {
        var tmpDir, provider, model, multiToolAgent, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('\n\n' + '='.repeat(70));
                    console.log('Example 2: Multiple Tools Automatically Registered');
                    console.log('='.repeat(70) + '\n');
                    return [4 /*yield*/, promises_1.default.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'codex-tool-example-'))];
                case 1:
                    tmpDir = _a.sent();
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, , 5, 7]);
                    provider = new index_ts_1.CodexProvider({
                        defaultModel: 'gpt-5',
                        workingDirectory: tmpDir,
                        skipGitRepoCheck: true,
                    });
                    return [4 /*yield*/, provider.getModel()];
                case 3:
                    model = _a.sent();
                    multiToolAgent = new agents_1.Agent({
                        name: 'MultiToolAgent',
                        model: model,
                        instructions: 'You are a helpful assistant with access to calculator, unit converter, and text analysis tools. Use the tools to answer questions directly.',
                        tools: [calculatorTool, unitConverterTool, textAnalysisTool],
                    });
                    console.log('✓ Created MultiToolAgent');
                    console.log('✓ Tools automatically registered:');
                    console.log('  - calculator');
                    console.log('  - convert_units');
                    console.log('  - analyze_text\n');
                    console.log('─'.repeat(70));
                    console.log('Query: "Convert 100 pounds to kilograms, then multiply by 2"\n');
                    return [4 /*yield*/, (0, agents_1.run)(multiToolAgent, 'Convert 100 pounds to kilograms, then multiply by 2')];
                case 4:
                    result = _a.sent();
                    console.log('\n[Final response]');
                    console.log(result.finalOutput);
                    return [3 /*break*/, 7];
                case 5: 
                // Cleanup temp directory
                return [4 /*yield*/, promises_1.default.rm(tmpDir, { recursive: true, force: true }).catch(function () { })];
                case 6:
                    // Cleanup temp directory
                    _a.sent();
                    return [7 /*endfinally*/];
                case 7: return [2 /*return*/];
            }
        });
    });
}
function toolChainExample() {
    return __awaiter(this, void 0, void 0, function () {
        var tmpDir, provider, model, agent, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('\n\n' + '='.repeat(70));
                    console.log('Example 3: Chaining Multiple Tool Calls');
                    console.log('='.repeat(70) + '\n');
                    return [4 /*yield*/, promises_1.default.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'codex-tool-example-'))];
                case 1:
                    tmpDir = _a.sent();
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, , 5, 7]);
                    provider = new index_ts_1.CodexProvider({
                        defaultModel: 'gpt-5',
                        workingDirectory: tmpDir,
                        skipGitRepoCheck: true,
                    });
                    return [4 /*yield*/, provider.getModel()];
                case 3:
                    model = _a.sent();
                    agent = new agents_1.Agent({
                        name: 'ToolChainAgent',
                        model: model,
                        instructions: 'You are a helpful assistant. Use multiple tools in sequence when needed to answer complex questions. Answer directly with the results.',
                        tools: [calculatorTool, unitConverterTool, textAnalysisTool],
                    });
                    console.log('✓ Created ToolChainAgent with 3 tools\n');
                    console.log('─'.repeat(70));
                    console.log('Complex query requiring multiple tool calls:\n');
                    console.log('Query: "I weigh 150 pounds. Convert that to kilograms, then calculate');
                    console.log('        what 20% of my weight would be. Also analyze this sentence:');
                    console.log('        \'The quick brown fox jumps over the lazy dog.\'"\n');
                    return [4 /*yield*/, (0, agents_1.run)(agent, 'I weigh 150 pounds. Convert that to kilograms, then calculate what 20% of my weight would be. Also analyze this sentence: "The quick brown fox jumps over the lazy dog."')];
                case 4:
                    result = _a.sent();
                    console.log('\n[Final response]');
                    console.log(result.finalOutput);
                    return [3 /*break*/, 7];
                case 5: 
                // Cleanup temp directory
                return [4 /*yield*/, promises_1.default.rm(tmpDir, { recursive: true, force: true }).catch(function () { })];
                case 6:
                    // Cleanup temp directory
                    _a.sent();
                    return [7 /*endfinally*/];
                case 7: return [2 /*return*/];
            }
        });
    });
}
function toolValidationExample() {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            console.log('\n\n' + '='.repeat(70));
            console.log('Example 4: Automatic Tool Parameter Validation');
            console.log('='.repeat(70) + '\n');
            console.log('Tools defined with Zod schemas have automatic validation:');
            console.log('  • Type checking (string, number, enum, etc.)');
            console.log('  • Required vs optional parameters');
            console.log('  • Value constraints and descriptions');
            console.log('  • Automatic error messages for invalid inputs\n');
            console.log('Example tool schema:');
            console.log("\n  const calculatorTool = tool({\n    name: 'calculator',\n    parameters: z.object({\n      operation: z.enum(['add', 'subtract', 'multiply', 'divide']),\n      a: z.number().describe('First number'),\n      b: z.number().describe('Second number'),\n    }),\n    execute: async (input) => { /* implementation */ }\n  });\n  ");
            console.log('\n✓ When this tool is registered with CodexProvider:');
            console.log('  • The model receives the schema definition');
            console.log('  • Invalid calls are caught and handled gracefully');
            console.log('  • The agent can understand parameter requirements');
            console.log('  • No manual validation code needed!');
            return [2 /*return*/];
        });
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('🔧 Automatic Tool Registration Examples\n');
                    console.log('This demonstrates how CodexProvider automatically registers');
                    console.log('tools when they are passed to an Agent - no manual configuration!\n');
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 6, , 7]);
                    // Run all examples
                    return [4 /*yield*/, basicToolExample()];
                case 2:
                    // Run all examples
                    _a.sent();
                    return [4 /*yield*/, multipleToolsExample()];
                case 3:
                    _a.sent();
                    return [4 /*yield*/, toolChainExample()];
                case 4:
                    _a.sent();
                    return [4 /*yield*/, toolValidationExample()];
                case 5:
                    _a.sent();
                    console.log('\n\n' + '='.repeat(70));
                    console.log('✓ All automatic tool registration examples complete!');
                    console.log('='.repeat(70));
                    console.log('\nKey takeaways:');
                    console.log('  • Tools are automatically registered when passed to Agent()');
                    console.log('  • No manual tool.register() or provider.addTool() calls needed');
                    console.log('  • Multiple tools can be registered at once');
                    console.log('  • Tools defined with Zod have automatic validation');
                    console.log('  • Tool execution results flow back to the model automatically');
                    console.log('  • The agent can chain multiple tool calls to complete tasks');
                    return [3 /*break*/, 7];
                case 6:
                    error_1 = _a.sent();
                    console.error('\n✗ Error:', error_1 instanceof Error ? error_1.message : String(error_1));
                    process.exit(1);
                    return [3 /*break*/, 7];
                case 7: return [2 /*return*/];
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
        console.error('Fatal error:', error);
        process.exit(1);
    });
}
