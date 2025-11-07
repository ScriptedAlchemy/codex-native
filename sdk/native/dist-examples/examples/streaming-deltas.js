"use strict";
/**
 * Example: Streaming responses with CodexProvider
 *
 * This example demonstrates how to use CodexProvider's streaming capabilities
 * to receive events as the model generates a response. This is useful for
 * building responsive UIs that show progress in real-time.
 *
 * Features demonstrated:
 * - Streaming text responses (complete text when generation finishes)
 * - Streaming reasoning updates (for extended thinking models)
 * - Handling different stream event types
 * - Real-time progress monitoring
 * - Image input support with streaming
 *
 * Note: The current implementation emits complete text/reasoning blocks
 * rather than character-by-character deltas. Events are emitted when
 * each phase completes (reasoning done, text done, etc.).
 *
 * Installation:
 * ```bash
 * npm install @codex-native/sdk @openai/agents
 * ```
 *
 * Usage:
 * ```bash
 * npx tsx examples/streaming-deltas.ts
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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
var agents_1 = require("@openai/agents");
var index_ts_1 = require("../src/index.ts");
function streamingTextExample() {
    return __awaiter(this, void 0, void 0, function () {
        var provider, model, agent, request, fullText, fullReasoning, _a, _b, _c, event_1, e_1_1;
        var _d, e_1, _e, _f;
        return __generator(this, function (_g) {
            switch (_g.label) {
                case 0:
                    console.log('\n' + '='.repeat(70));
                    console.log('Example 1: Streaming Text Response');
                    console.log('='.repeat(70) + '\n');
                    provider = new index_ts_1.CodexProvider({
                        defaultModel: 'gpt-5',
                        workingDirectory: process.cwd(),
                        skipGitRepoCheck: true,
                    });
                    return [4 /*yield*/, provider.getModel()];
                case 1:
                    model = _g.sent();
                    agent = new agents_1.Agent({
                        name: 'StreamingAssistant',
                        model: model,
                        instructions: 'You are a helpful assistant. Provide detailed explanations.',
                    });
                    console.log('Requesting: "Explain how neural networks work in 3 paragraphs"\n');
                    console.log('─'.repeat(70));
                    console.log('Streaming response:');
                    console.log('─'.repeat(70) + '\n');
                    request = {
                        systemInstructions: 'You are a helpful assistant.',
                        input: 'Explain how neural networks work in 3 paragraphs',
                        modelSettings: {},
                        tools: [],
                        outputType: { type: 'text' },
                        handoffs: [],
                        tracing: { enabled: false },
                    };
                    fullText = '';
                    fullReasoning = '';
                    _g.label = 2;
                case 2:
                    _g.trys.push([2, 7, 8, 13]);
                    _a = true, _b = __asyncValues(model.getStreamedResponse(request));
                    _g.label = 3;
                case 3: return [4 /*yield*/, _b.next()];
                case 4:
                    if (!(_c = _g.sent(), _d = _c.done, !_d)) return [3 /*break*/, 6];
                    _f = _c.value;
                    _a = false;
                    event_1 = _f;
                    switch (event_1.type) {
                        case 'response_started':
                            console.log('[Stream started]');
                            console.log('[Generating response...]\n');
                            break;
                        case 'output_text_delta':
                            // Note: Delta events are not currently emitted by the backend
                            // Text is provided as a complete block in output_text_done
                            process.stdout.write(event_1.delta);
                            fullText += event_1.delta;
                            break;
                        case 'output_text_done':
                            // Text is provided here as a complete block
                            fullText = event_1.text;
                            console.log(event_1.text);
                            console.log('\n[Text generation complete]');
                            break;
                        case 'reasoning_delta':
                            // Note: Delta events are not currently emitted by the backend
                            // Reasoning is provided as a complete block in reasoning_done
                            fullReasoning += event_1.delta;
                            break;
                        case 'reasoning_done':
                            if (event_1.reasoning) {
                                fullReasoning = event_1.reasoning;
                                console.log("[Extended thinking complete: ".concat(event_1.reasoning.length, " chars]"));
                            }
                            break;
                        case 'response_done':
                            console.log("\n[Response done]");
                            console.log("  Input tokens: ".concat(event_1.response.usage.inputTokens));
                            console.log("  Output tokens: ".concat(event_1.response.usage.outputTokens));
                            console.log("  Total tokens: ".concat(event_1.response.usage.totalTokens));
                            break;
                        case 'error':
                            console.error("\n[Error]: ".concat(event_1.error.message));
                            break;
                    }
                    _g.label = 5;
                case 5:
                    _a = true;
                    return [3 /*break*/, 3];
                case 6: return [3 /*break*/, 13];
                case 7:
                    e_1_1 = _g.sent();
                    e_1 = { error: e_1_1 };
                    return [3 /*break*/, 13];
                case 8:
                    _g.trys.push([8, , 11, 12]);
                    if (!(!_a && !_d && (_e = _b.return))) return [3 /*break*/, 10];
                    return [4 /*yield*/, _e.call(_b)];
                case 9:
                    _g.sent();
                    _g.label = 10;
                case 10: return [3 /*break*/, 12];
                case 11:
                    if (e_1) throw e_1.error;
                    return [7 /*endfinally*/];
                case 12: return [7 /*endfinally*/];
                case 13:
                    console.log('\n' + '─'.repeat(70));
                    console.log("Final text length: ".concat(fullText.length, " characters"));
                    if (fullReasoning) {
                        console.log("Reasoning length: ".concat(fullReasoning.length, " characters"));
                    }
                    return [2 /*return*/];
            }
        });
    });
}
function streamingWithImageExample() {
    return __awaiter(this, void 0, void 0, function () {
        var provider, model, imageUrl, request, responseText, _a, _b, _c, event_2, e_2_1;
        var _d, e_2, _e, _f;
        return __generator(this, function (_g) {
            switch (_g.label) {
                case 0:
                    console.log('\n\n' + '='.repeat(70));
                    console.log('Example 2: Streaming with Image Input');
                    console.log('='.repeat(70) + '\n');
                    provider = new index_ts_1.CodexProvider({
                        defaultModel: 'gpt-5',
                        workingDirectory: process.cwd(),
                        skipGitRepoCheck: true,
                    });
                    return [4 /*yield*/, provider.getModel()];
                case 1:
                    model = _g.sent();
                    console.log('Sending multi-modal input (text + image)...');
                    console.log('CodexProvider automatically handles image conversion for streaming\n');
                    console.log('─'.repeat(70));
                    console.log('Streaming response:');
                    console.log('─'.repeat(70) + '\n');
                    imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/1200px-Cat03.jpg';
                    request = {
                        systemInstructions: 'You are a helpful assistant that can analyze images.',
                        input: [
                            { type: 'input_text', text: 'Describe what you see in this image concisely' },
                            { type: 'input_image', image: imageUrl }
                        ],
                        modelSettings: {},
                        tools: [],
                        outputType: { type: 'text' },
                        handoffs: [],
                        tracing: { enabled: false },
                    };
                    responseText = '';
                    _g.label = 2;
                case 2:
                    _g.trys.push([2, 7, 8, 13]);
                    _a = true, _b = __asyncValues(model.getStreamedResponse(request));
                    _g.label = 3;
                case 3: return [4 /*yield*/, _b.next()];
                case 4:
                    if (!(_c = _g.sent(), _d = _c.done, !_d)) return [3 /*break*/, 6];
                    _f = _c.value;
                    _a = false;
                    event_2 = _f;
                    switch (event_2.type) {
                        case 'response_started':
                            console.log('[Stream started - processing image...]');
                            console.log('[Generating response...]\n');
                            break;
                        case 'output_text_delta':
                            process.stdout.write(event_2.delta);
                            responseText += event_2.delta;
                            break;
                        case 'output_text_done':
                            responseText = event_2.text;
                            console.log(event_2.text);
                            console.log('\n[Text generation complete]');
                            break;
                        case 'reasoning_done':
                            if (event_2.reasoning) {
                                console.log("[Extended thinking complete: ".concat(event_2.reasoning.length, " chars]"));
                            }
                            break;
                        case 'response_done':
                            console.log("\n[Response done]");
                            console.log("  Tokens used: ".concat(event_2.response.usage.totalTokens));
                            break;
                        case 'error':
                            console.error("\n[Error]: ".concat(event_2.error.message));
                            break;
                    }
                    _g.label = 5;
                case 5:
                    _a = true;
                    return [3 /*break*/, 3];
                case 6: return [3 /*break*/, 13];
                case 7:
                    e_2_1 = _g.sent();
                    e_2 = { error: e_2_1 };
                    return [3 /*break*/, 13];
                case 8:
                    _g.trys.push([8, , 11, 12]);
                    if (!(!_a && !_d && (_e = _b.return))) return [3 /*break*/, 10];
                    return [4 /*yield*/, _e.call(_b)];
                case 9:
                    _g.sent();
                    _g.label = 10;
                case 10: return [3 /*break*/, 12];
                case 11:
                    if (e_2) throw e_2.error;
                    return [7 /*endfinally*/];
                case 12: return [7 /*endfinally*/];
                case 13:
                    console.log('\n' + '─'.repeat(70));
                    console.log("Response length: ".concat(responseText.length, " characters"));
                    return [2 /*return*/];
            }
        });
    });
}
function detailedStreamEventExample() {
    return __awaiter(this, void 0, void 0, function () {
        var provider, model, request, eventCounts, _a, _b, _c, event_3, count, e_3_1, _i, _d, _e, eventType, count;
        var _f, e_3, _g, _h;
        return __generator(this, function (_j) {
            switch (_j.label) {
                case 0:
                    console.log('\n\n' + '='.repeat(70));
                    console.log('Example 3: Understanding All Stream Event Types');
                    console.log('='.repeat(70) + '\n');
                    provider = new index_ts_1.CodexProvider({
                        defaultModel: 'gpt-5',
                        workingDirectory: process.cwd(),
                        skipGitRepoCheck: true,
                    });
                    return [4 /*yield*/, provider.getModel()];
                case 1:
                    model = _j.sent();
                    console.log('This example shows all possible stream event types:\n');
                    console.log('Event Types:');
                    console.log('  • response_started - Stream begins');
                    console.log('  • output_text_delta - Incremental text chunk (not currently emitted)');
                    console.log('  • output_text_done - Text generation complete (includes full text)');
                    console.log('  • reasoning_delta - Incremental reasoning (not currently emitted)');
                    console.log('  • reasoning_done - Reasoning complete (includes full reasoning)');
                    console.log('  • response_done - Full response complete with usage stats');
                    console.log('  • error - An error occurred\n');
                    console.log('Note: Currently only complete blocks are emitted (reasoning_done, output_text_done)');
                    console.log('      rather than incremental deltas.\n');
                    console.log('─'.repeat(70));
                    console.log('Event stream:\n');
                    request = {
                        systemInstructions: 'You are a helpful assistant.',
                        input: 'Count from 1 to 5 and explain each number.',
                        modelSettings: {},
                        tools: [],
                        outputType: { type: 'text' },
                        handoffs: [],
                        tracing: { enabled: false },
                    };
                    eventCounts = new Map();
                    _j.label = 2;
                case 2:
                    _j.trys.push([2, 7, 8, 13]);
                    _a = true, _b = __asyncValues(model.getStreamedResponse(request));
                    _j.label = 3;
                case 3: return [4 /*yield*/, _b.next()];
                case 4:
                    if (!(_c = _j.sent(), _f = _c.done, !_f)) return [3 /*break*/, 6];
                    _h = _c.value;
                    _a = false;
                    event_3 = _h;
                    count = eventCounts.get(event_3.type) || 0;
                    eventCounts.set(event_3.type, count + 1);
                    // Log each event type
                    switch (event_3.type) {
                        case 'response_started':
                            console.log("[".concat(event_3.type, "]"));
                            break;
                        case 'output_text_delta':
                            // Delta events are not currently emitted, but handler is here for future compatibility
                            if (count < 3) {
                                console.log("[".concat(event_3.type, "] delta=\"").concat(event_3.delta, "\""));
                            }
                            else if (count === 3) {
                                console.log("[".concat(event_3.type, "] ... (").concat(count, " more delta events) ..."));
                            }
                            break;
                        case 'output_text_done':
                            console.log("[".concat(event_3.type, "] text length=").concat(event_3.text.length));
                            break;
                        case 'reasoning_delta':
                            // Delta events are not currently emitted, but handler is here for future compatibility
                            if (count < 3) {
                                console.log("[".concat(event_3.type, "] delta=\"").concat(event_3.delta, "\""));
                            }
                            break;
                        case 'reasoning_done':
                            console.log("[".concat(event_3.type, "] reasoning length=").concat(event_3.reasoning.length));
                            break;
                        case 'response_done':
                            console.log("[".concat(event_3.type, "] usage=").concat(JSON.stringify(event_3.response.usage)));
                            break;
                        case 'error':
                            console.log("[".concat(event_3.type, "] message=\"").concat(event_3.error.message, "\""));
                            break;
                    }
                    _j.label = 5;
                case 5:
                    _a = true;
                    return [3 /*break*/, 3];
                case 6: return [3 /*break*/, 13];
                case 7:
                    e_3_1 = _j.sent();
                    e_3 = { error: e_3_1 };
                    return [3 /*break*/, 13];
                case 8:
                    _j.trys.push([8, , 11, 12]);
                    if (!(!_a && !_f && (_g = _b.return))) return [3 /*break*/, 10];
                    return [4 /*yield*/, _g.call(_b)];
                case 9:
                    _j.sent();
                    _j.label = 10;
                case 10: return [3 /*break*/, 12];
                case 11:
                    if (e_3) throw e_3.error;
                    return [7 /*endfinally*/];
                case 12: return [7 /*endfinally*/];
                case 13:
                    console.log('\n' + '─'.repeat(70));
                    console.log('Event Statistics:');
                    for (_i = 0, _d = eventCounts.entries(); _i < _d.length; _i++) {
                        _e = _d[_i], eventType = _e[0], count = _e[1];
                        console.log("  ".concat(eventType, ": ").concat(count, " events"));
                    }
                    return [2 /*return*/];
            }
        });
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('🌊 CodexProvider Streaming Response Examples\n');
                    console.log('These examples demonstrate streaming capabilities for monitoring');
                    console.log('response generation in real-time.\n');
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 5, , 6]);
                    // Run all examples
                    return [4 /*yield*/, streamingTextExample()];
                case 2:
                    // Run all examples
                    _a.sent();
                    return [4 /*yield*/, streamingWithImageExample()];
                case 3:
                    _a.sent();
                    return [4 /*yield*/, detailedStreamEventExample()];
                case 4:
                    _a.sent();
                    console.log('\n\n' + '='.repeat(70));
                    console.log('✓ All streaming examples complete!');
                    console.log('='.repeat(70));
                    console.log('\nKey takeaways:');
                    console.log('  • Stream events provide real-time progress updates');
                    console.log('  • output_text_done provides the complete generated text');
                    console.log('  • reasoning_done provides the complete extended thinking');
                    console.log('  • Image inputs work seamlessly with streaming');
                    console.log('  • Usage statistics are provided in the response_done event');
                    console.log('  • Current implementation emits complete blocks rather than character deltas');
                    return [3 /*break*/, 6];
                case 5:
                    error_1 = _a.sent();
                    console.error('\n✗ Error:', error_1 instanceof Error ? error_1.message : String(error_1));
                    process.exit(1);
                    return [3 /*break*/, 6];
                case 6: return [2 /*return*/];
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
