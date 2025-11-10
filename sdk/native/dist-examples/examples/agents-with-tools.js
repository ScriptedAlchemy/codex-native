"use strict";
/**
 * Example: Using CodexProvider with OpenAI Agents framework
 *
 * This example demonstrates how to:
 * - Use CodexProvider as a ModelProvider for the OpenAI Agents framework
 * - Create simple agents that interact via Codex
 * - Handle basic conversational queries
 *
 * Note: Custom tool execution (like weather tools defined in this file) is not
 * yet fully supported. The CodexProvider can execute Codex's built-in tools
 * (bash, file operations, web search, etc.) but bidirectional tool execution
 * with the OpenAI Agents framework requires additional integration work.
 * See CodexProvider.ts executeToolViaFramework() for details.
 *
 * Installation:
 * ```bash
 * npm install @codex-native/sdk @openai/agents zod
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/agents-with-tools.ts
 * ```
 *
 * This example demonstrates using Codex's native NAPI bindings as the model
 * provider. Codex handles authentication and connection to OpenAI's GPT-5
 * Responses API internally via the native binding, so no API key configuration
 * is needed in your code.
 *
 * Key features demonstrated:
 * - CodexProvider integration with OpenAI Agents framework
 * - Basic conversational agents
 * - Automatic cleanup of temporary directories
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
exports.convertTemperatureTool = exports.getWeatherTool = void 0;
exports.main = main;
var node_os_1 = require("node:os");
var node_path_1 = require("node:path");
var node_fs_1 = require("node:fs");
var zod_1 = require("zod");
var agents_1 = require("@openai/agents");
var index_ts_1 = require("../src/index.ts");
// Define a weather tool using zod for type-safe parameters
var getWeatherTool = (0, agents_1.tool)({
    name: 'get_weather',
    description: 'Get the weather for a given city',
    parameters: zod_1.z.object({
        city: zod_1.z.string().describe('The city to get weather for'),
    }),
    execute: function (input) { return __awaiter(void 0, void 0, void 0, function () {
        var weatherConditions, condition, temp;
        return __generator(this, function (_a) {
            console.log("[debug] Getting weather for ".concat(input.city, "\n"));
            weatherConditions = ['sunny', 'cloudy', 'rainy', 'snowy'];
            condition = weatherConditions[Math.floor(Math.random() * weatherConditions.length)];
            temp = Math.floor(Math.random() * 30) + 10;
            return [2 /*return*/, "The weather in ".concat(input.city, " is ").concat(condition, " with a temperature of ").concat(temp, "\u00B0C")];
        });
    }); },
});
exports.getWeatherTool = getWeatherTool;
// Define a temperature conversion tool
var convertTemperatureTool = (0, agents_1.tool)({
    name: 'convert_temperature',
    description: 'Convert temperature between Celsius and Fahrenheit',
    parameters: zod_1.z.object({
        value: zod_1.z.number().describe('The temperature value to convert'),
        from: zod_1.z.enum(['celsius', 'fahrenheit']).describe('The unit to convert from'),
        to: zod_1.z.enum(['celsius', 'fahrenheit']).describe('The unit to convert to'),
    }),
    execute: function (input) { return __awaiter(void 0, void 0, void 0, function () {
        var result;
        return __generator(this, function (_a) {
            console.log("[debug] Converting ".concat(input.value, "\u00B0").concat(input.from[0].toUpperCase(), " to ").concat(input.to, "\n"));
            if (input.from === input.to) {
                return [2 /*return*/, "".concat(input.value, "\u00B0").concat(input.from === 'celsius' ? 'C' : 'F')];
            }
            if (input.from === 'celsius' && input.to === 'fahrenheit') {
                result = (input.value * 9 / 5) + 32;
            }
            else {
                result = (input.value - 32) * 5 / 9;
            }
            return [2 /*return*/, "".concat(input.value, "\u00B0").concat(input.from === 'celsius' ? 'C' : 'F', " is ").concat(result.toFixed(1), "\u00B0").concat(input.to === 'celsius' ? 'C' : 'F')];
        });
    }); },
});
exports.convertTemperatureTool = convertTemperatureTool;
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var tmpDir, codexProvider, codexModel, simpleAgent, e_1;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('🤖 OpenAI Agents with Codex Provider\n');
                    console.log('NOTE: This example demonstrates the CodexProvider integration,');
                    console.log('but custom tools (get_weather, convert_temperature) are not yet');
                    console.log('fully supported due to limitations in the current implementation.\n');
                    console.log('The CodexProvider can execute its built-in tools (bash, file operations,');
                    console.log('web search, etc.) but bidirectional tool execution with the OpenAI Agents');
                    console.log('framework requires additional integration work.\n');
                    return [4 /*yield*/, node_fs_1.promises.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), 'codex-agents-example-'))];
                case 1:
                    tmpDir = _a.sent();
                    console.log("Using temporary directory: ".concat(tmpDir, "\n"));
                    codexProvider = new index_ts_1.CodexProvider({
                        defaultModel: 'gpt-5',
                        workingDirectory: tmpDir,
                        skipGitRepoCheck: true,
                    });
                    return [4 /*yield*/, codexProvider.getModel()];
                case 2:
                    codexModel = _a.sent();
                    // Example 1: Simple text query
                    console.log('Example 1: Basic conversational query');
                    console.log('─'.repeat(60));
                    simpleAgent = new agents_1.Agent({
                        name: 'Assistant',
                        model: codexModel,
                        instructions: 'You are a helpful assistant.',
                    });
                    return [4 /*yield*/, (0, agents_1.withTrace)('Conversation Example', function () { return __awaiter(_this, void 0, void 0, function () {
                            var question, result;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        question = "Hello! Please respond with a brief greeting and confirm you can help.";
                                        console.log("Query: \"".concat(question, "\"\n"));
                                        return [4 /*yield*/, (0, agents_1.run)(simpleAgent, question)];
                                    case 1:
                                        result = _a.sent();
                                        console.log('\n[Final response]');
                                        console.log(result.finalOutput);
                                        // Verify we got a response
                                        if (!result.finalOutput || result.finalOutput.length === 0) {
                                            throw new Error('No response received from agent');
                                        }
                                        return [2 /*return*/];
                                }
                            });
                        }); })];
                case 3:
                    _a.sent();
                    console.log('\n' + '='.repeat(60));
                    console.log('✓ Example complete!');
                    console.log('\nKey takeaways:');
                    console.log('  • CodexProvider successfully integrates with OpenAI Agents framework');
                    console.log('  • Basic queries work without custom tools');
                    console.log('  • Custom tool execution requires bidirectional framework integration');
                    console.log('  • See CodexProvider.ts executeToolViaFramework() for details');
                    _a.label = 4;
                case 4:
                    _a.trys.push([4, 6, , 7]);
                    return [4 /*yield*/, node_fs_1.promises.rm(tmpDir, { recursive: true, force: true })];
                case 5:
                    _a.sent();
                    return [3 /*break*/, 7];
                case 6:
                    e_1 = _a.sent();
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
