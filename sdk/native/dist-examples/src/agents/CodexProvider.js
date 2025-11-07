"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function () { return this; }, i;
    function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
    function verb(n, f) { if (g[n]) { i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodexProvider = void 0;
var fs = require("fs");
var path = require("path");
var os = require("os");
/**
 * Provider implementation that uses Codex as the backend for OpenAI Agents
 *
 * @example
 * ```typescript
 * import { CodexProvider } from '@openai/codex-native/agents';
 * import { Agent, Runner } from '@openai/agents';
 *
 *   defaultModel: 'gpt-5'
 * });
 *
 * const agent = new Agent({
 *   name: 'CodeAssistant',
 *   instructions: 'You are a helpful coding assistant'
 * });
 *
 * const runner = new Runner({ modelProvider: provider });
 * const result = await runner.run(agent, 'Fix the failing tests');
 * ```
 */
var CodexProvider = /** @class */ (function () {
    function CodexProvider(options) {
        if (options === void 0) { options = {}; }
        var _a;
        this.codex = null;
        this.options = __assign({ workingDirectory: options.workingDirectory || process.cwd(), skipGitRepoCheck: (_a = options.skipGitRepoCheck) !== null && _a !== void 0 ? _a : false }, options);
    }
    /**
     * Lazy initialization of Codex instance
     */
    CodexProvider.prototype.getCodex = function () {
        if (!this.codex) {
            try {
                // Dynamic import to avoid circular dependencies
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                var CodexClass = require("../codex").Codex;
                if (!CodexClass) {
                    throw new Error("Codex class not found in module");
                }
                this.codex = new CodexClass({
                    apiKey: this.options.apiKey,
                    baseUrl: this.options.baseUrl,
                });
            }
            catch (error) {
                throw new Error("Failed to initialize Codex: ".concat(error instanceof Error ? error.message : String(error)));
            }
        }
        return this.codex;
    };
    CodexProvider.prototype.getModel = function (modelName) {
        var model = modelName || this.options.defaultModel;
        return new CodexModel(this.getCodex(), model, this.options);
    };
    return CodexProvider;
}());
exports.CodexProvider = CodexProvider;
/**
 * Model implementation that wraps a Codex Thread
 */
var CodexModel = /** @class */ (function () {
    function CodexModel(codex, modelName, options) {
        this.thread = null;
        this.registeredTools = new Set();
        this.pendingToolCalls = new Map();
        this.tempImageFiles = new Set();
        this.codex = codex;
        this.modelName = modelName;
        this.options = options;
    }
    /**
     * Cleanup temporary image files created during request processing
     */
    CodexModel.prototype.cleanupTempFiles = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _i, _a, filepath, error_1;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _i = 0, _a = this.tempImageFiles;
                        _b.label = 1;
                    case 1:
                        if (!(_i < _a.length)) return [3 /*break*/, 6];
                        filepath = _a[_i];
                        _b.label = 2;
                    case 2:
                        _b.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, fs.promises.unlink(filepath)];
                    case 3:
                        _b.sent();
                        return [3 /*break*/, 5];
                    case 4:
                        error_1 = _b.sent();
                        return [3 /*break*/, 5];
                    case 5:
                        _i++;
                        return [3 /*break*/, 1];
                    case 6:
                        this.tempImageFiles.clear();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Get or create the thread for this model instance
     */
    CodexModel.prototype.getThread = function (conversationId) {
        // If we have a conversation ID and either no thread or a different thread
        if (conversationId) {
            if (!this.thread || this.thread.id !== conversationId) {
                // Resume the specified thread
                this.thread = this.codex.resumeThread(conversationId, this.getThreadOptions());
            }
        }
        else if (!this.thread) {
            // Create new thread only if we don't have one
            this.thread = this.codex.startThread(this.getThreadOptions());
        }
        return this.thread;
    };
    CodexModel.prototype.getThreadOptions = function () {
        return {
            model: this.modelName,
            workingDirectory: this.options.workingDirectory,
            skipGitRepoCheck: this.options.skipGitRepoCheck,
            fullAuto: true,
        };
    };
    CodexModel.prototype.getResponse = function (request) {
        return __awaiter(this, void 0, void 0, function () {
            var thread, input, turn;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, , 3, 5]);
                        thread = this.getThread(request.conversationId || request.previousResponseId);
                        // Register any tools provided in the request
                        if (request.tools && request.tools.length > 0) {
                            this.registerRequestTools(request.tools);
                        }
                        return [4 /*yield*/, this.convertRequestToInput(request)];
                    case 1:
                        input = _b.sent();
                        return [4 /*yield*/, thread.run(input, {
                                outputSchema: (_a = request.outputType) === null || _a === void 0 ? void 0 : _a.schema,
                            })];
                    case 2:
                        turn = _b.sent();
                        // Convert Codex response to ModelResponse format
                        return [2 /*return*/, {
                                usage: this.convertUsage(turn.usage),
                                output: this.convertItemsToOutput(turn.items, turn.finalResponse),
                                responseId: thread.id || undefined,
                            }];
                    case 3: 
                    // Clean up temporary image files
                    return [4 /*yield*/, this.cleanupTempFiles()];
                    case 4:
                        // Clean up temporary image files
                        _b.sent();
                        return [7 /*endfinally*/];
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    CodexModel.prototype.getStreamedResponse = function (request) {
        return __asyncGenerator(this, arguments, function getStreamedResponse_1() {
            var MAX_ACCUMULATED_SIZE, thread, input, events, textAccumulator, _a, events_1, events_1_1, event_1, totalSize, _i, _b, text, streamEvents, _c, streamEvents_1, streamEvent, e_1_1;
            var _d, e_1, _e, _f;
            var _g;
            return __generator(this, function (_h) {
                switch (_h.label) {
                    case 0:
                        MAX_ACCUMULATED_SIZE = 10000000;
                        _h.label = 1;
                    case 1:
                        _h.trys.push([1, , 20, 22]);
                        thread = this.getThread(request.conversationId || request.previousResponseId);
                        // Register any tools provided in the request
                        if (request.tools && request.tools.length > 0) {
                            this.registerRequestTools(request.tools);
                        }
                        return [4 /*yield*/, __await(this.convertRequestToInput(request))];
                    case 2:
                        input = _h.sent();
                        return [4 /*yield*/, __await(thread.runStreamed(input, {
                                outputSchema: (_g = request.outputType) === null || _g === void 0 ? void 0 : _g.schema,
                            }))];
                    case 3:
                        events = (_h.sent()).events;
                        textAccumulator = new Map();
                        _h.label = 4;
                    case 4:
                        _h.trys.push([4, 13, 14, 19]);
                        _a = true, events_1 = __asyncValues(events);
                        _h.label = 5;
                    case 5: return [4 /*yield*/, __await(events_1.next())];
                    case 6:
                        if (!(events_1_1 = _h.sent(), _d = events_1_1.done, !_d)) return [3 /*break*/, 12];
                        _f = events_1_1.value;
                        _a = false;
                        event_1 = _f;
                        totalSize = 0;
                        for (_i = 0, _b = textAccumulator.values(); _i < _b.length; _i++) {
                            text = _b[_i];
                            totalSize += text.length;
                        }
                        if (totalSize > MAX_ACCUMULATED_SIZE) {
                            throw new Error("Accumulated text exceeded maximum size limit (".concat(MAX_ACCUMULATED_SIZE, " bytes)"));
                        }
                        streamEvents = this.convertCodexEventToStreamEvent(event_1, textAccumulator);
                        _c = 0, streamEvents_1 = streamEvents;
                        _h.label = 7;
                    case 7:
                        if (!(_c < streamEvents_1.length)) return [3 /*break*/, 11];
                        streamEvent = streamEvents_1[_c];
                        return [4 /*yield*/, __await(streamEvent)];
                    case 8: return [4 /*yield*/, _h.sent()];
                    case 9:
                        _h.sent();
                        _h.label = 10;
                    case 10:
                        _c++;
                        return [3 /*break*/, 7];
                    case 11:
                        _a = true;
                        return [3 /*break*/, 5];
                    case 12: return [3 /*break*/, 19];
                    case 13:
                        e_1_1 = _h.sent();
                        e_1 = { error: e_1_1 };
                        return [3 /*break*/, 19];
                    case 14:
                        _h.trys.push([14, , 17, 18]);
                        if (!(!_a && !_d && (_e = events_1.return))) return [3 /*break*/, 16];
                        return [4 /*yield*/, __await(_e.call(events_1))];
                    case 15:
                        _h.sent();
                        _h.label = 16;
                    case 16: return [3 /*break*/, 18];
                    case 17:
                        if (e_1) throw e_1.error;
                        return [7 /*endfinally*/];
                    case 18: return [7 /*endfinally*/];
                    case 19: return [3 /*break*/, 22];
                    case 20: 
                    // Clean up temporary image files
                    return [4 /*yield*/, __await(this.cleanupTempFiles())];
                    case 21:
                        // Clean up temporary image files
                        _h.sent();
                        return [7 /*endfinally*/];
                    case 22: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Register tools from ModelRequest with the Codex instance
     *
     * Converts SerializedTool format (OpenAI Agents) to NativeToolDefinition format (Codex)
     * and registers them with the Codex instance for bidirectional tool execution.
     */
    CodexModel.prototype.registerRequestTools = function (tools) {
        var _this = this;
        for (var _i = 0, tools_1 = tools; _i < tools_1.length; _i++) {
            var tool = tools_1[_i];
            if (tool.type !== "function") {
                continue;
            }
            // Skip if already registered
            if (this.registeredTools.has(tool.name)) {
                continue;
            }
            try {
                // Convert SerializedTool to NativeToolDefinition
                var nativeToolDef = {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                    // The handler is called when Codex wants to execute this tool
                    handler: function (invocation) { return __awaiter(_this, void 0, void 0, function () {
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0: return [4 /*yield*/, this.executeToolViaFramework(invocation)];
                                case 1: return [2 /*return*/, _a.sent()];
                            }
                        });
                    }); },
                };
                // Register the tool with Codex
                this.codex.registerTool(nativeToolDef);
                this.registeredTools.add(tool.name);
                console.log("Registered tool with Codex: ".concat(tool.name));
            }
            catch (error) {
                var errorMessage = "Failed to register tool ".concat(tool.name, ": ").concat(error instanceof Error ? error.message : String(error));
                console.error(errorMessage);
                // Don't throw - allow other tools to register even if one fails
                // Individual tool failures shouldn't block the entire request
            }
        }
    };
    /**
     * Execute a tool via the OpenAI Agents framework
     *
     * This is the bridge between Codex's tool execution and the framework's tool handlers.
     *
     * FRAMEWORK INTEGRATION NOTE:
     * This method currently returns a placeholder result because the actual execution
     * requires integration with the OpenAI Agents framework's tool execution loop.
     *
     * In a full implementation, this would:
     * 1. Emit a "tool_call_requested" event that the framework can listen to
     * 2. Wait for the framework to execute the tool and provide the result
     * 3. Return that result to Codex
     *
     * For now, this creates a promise that could be resolved by framework code,
     * but the framework integration is not yet complete.
     */
    CodexModel.prototype.executeToolViaFramework = function (invocation) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                console.log("Tool execution requested by Codex: ".concat(invocation.toolName, " (callId: ").concat(invocation.callId, ")"));
                // FRAMEWORK INTEGRATION POINT:
                // The framework would need to:
                // 1. Listen for tool execution requests (e.g., via an event emitter)
                // 2. Execute the tool using its own tool handlers
                // 3. Resolve the pending promise with the result
                //
                // Example integration pattern (not implemented):
                // ```
                // this.emit('tool_execution_requested', {
                //   toolName: invocation.toolName,
                //   callId: invocation.callId,
                //   arguments: invocation.arguments,
                //   onResult: (result: string) => resolve({ output: result, success: true }),
                //   onError: (error: string) => resolve({ error, success: false })
                // });
                // ```
                // For now, return a placeholder response indicating the tool was called
                // but could not be executed without framework integration
                return [2 /*return*/, {
                        output: JSON.stringify({
                            message: "Tool execution via framework is not yet implemented",
                            toolName: invocation.toolName,
                            callId: invocation.callId,
                            arguments: invocation.arguments,
                            note: "This requires bidirectional communication between Codex and the OpenAI Agents framework. The framework needs to listen for tool execution requests and provide results back to Codex.",
                        }),
                        success: false,
                        error: "Framework integration not complete - tool execution requires the OpenAI Agents framework to handle the tool call and return results",
                    }];
            });
        });
    };
    /**
     * Handle image input by converting to local file path
     * Supports: base64 data URLs, HTTP(S) URLs, and file IDs (not yet implemented)
     */
    CodexModel.prototype.handleImageInput = function (item) {
        return __awaiter(this, void 0, void 0, function () {
            var imageValue;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        imageValue = item.image;
                        if (!(typeof imageValue === "string")) return [3 /*break*/, 6];
                        if (!imageValue.startsWith("data:image/")) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.saveBase64Image(imageValue)];
                    case 1: return [2 /*return*/, _a.sent()];
                    case 2:
                        if (!(imageValue.startsWith("http://") || imageValue.startsWith("https://"))) return [3 /*break*/, 4];
                        return [4 /*yield*/, this.downloadImage(imageValue)];
                    case 3: return [2 /*return*/, _a.sent()];
                    case 4:
                        if (fs.existsSync(imageValue)) {
                            return [2 /*return*/, imageValue];
                        }
                        // Invalid format
                        else {
                            throw new Error("Invalid image format: ".concat(imageValue.substring(0, 50), "..."));
                        }
                        _a.label = 5;
                    case 5: return [3 /*break*/, 9];
                    case 6:
                        if (!(typeof imageValue === "object" && "url" in imageValue)) return [3 /*break*/, 8];
                        return [4 /*yield*/, this.downloadImage(imageValue.url)];
                    case 7: return [2 /*return*/, _a.sent()];
                    case 8:
                        if (typeof imageValue === "object" && "fileId" in imageValue) {
                            throw new Error("Image fileId references are not yet supported. " +
                                "File IDs would need to be downloaded from the service first.");
                        }
                        _a.label = 9;
                    case 9: return [2 /*return*/, null];
                }
            });
        });
    };
    /**
     * Save base64-encoded image to temporary file
     */
    CodexModel.prototype.saveBase64Image = function (dataUrl) {
        return __awaiter(this, void 0, void 0, function () {
            var matches, mediaType, base64Data, sanitizedBase64, normalizedBase64, buffer, reencoded, normalizedInput, extension, tempDir, filename, filepath;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        matches = dataUrl.match(/^data:image\/([^;]+);base64,(.+)$/);
                        if (!matches) {
                            throw new Error("Invalid base64 image data URL");
                        }
                        mediaType = matches[1];
                        base64Data = matches[2];
                        if (!base64Data) {
                            throw new Error("Invalid base64 data in image URL");
                        }
                        sanitizedBase64 = base64Data.replace(/\s/g, "");
                        if (sanitizedBase64.length === 0) {
                            throw new Error("Invalid base64 data in image URL");
                        }
                        if (!/^[A-Za-z0-9+/=_-]+$/.test(sanitizedBase64)) {
                            throw new Error("Invalid base64 data in image URL");
                        }
                        normalizedBase64 = sanitizedBase64.replace(/-/g, "+").replace(/_/g, "/");
                        try {
                            buffer = Buffer.from(normalizedBase64, "base64");
                        }
                        catch (_b) {
                            throw new Error("Invalid base64 data in image URL");
                        }
                        if (buffer.length === 0) {
                            throw new Error("Invalid base64 data in image URL");
                        }
                        reencoded = buffer.toString("base64").replace(/=+$/, "");
                        normalizedInput = normalizedBase64.replace(/=+$/, "");
                        if (reencoded !== normalizedInput) {
                            throw new Error("Invalid base64 data in image URL");
                        }
                        extension = this.getExtensionFromMediaType(mediaType, "png");
                        tempDir = os.tmpdir();
                        filename = "codex-image-".concat(Date.now(), ".").concat(extension);
                        filepath = path.join(tempDir, filename);
                        return [4 /*yield*/, fs.promises.writeFile(filepath, buffer)];
                    case 1:
                        _a.sent();
                        this.tempImageFiles.add(filepath);
                        return [2 /*return*/, filepath];
                }
            });
        });
    };
    /**
     * Download image from URL to temporary file
     */
    CodexModel.prototype.downloadImage = function (url) {
        return __awaiter(this, void 0, void 0, function () {
            var response, buffer, contentType, mediaTypePart, mediaType, extension, tempDir, filename, filepath;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, fetch(url)];
                    case 1:
                        response = _b.sent();
                        if (!response.ok) {
                            throw new Error("Failed to download image from ".concat(url, ": ").concat(response.statusText));
                        }
                        return [4 /*yield*/, response.arrayBuffer()];
                    case 2:
                        buffer = _b.sent();
                        contentType = response.headers.get("content-type") || "image/png";
                        mediaTypePart = ((_a = contentType.split(";")[0]) === null || _a === void 0 ? void 0 : _a.trim()) || "image/png";
                        mediaType = mediaTypePart.split("/")[1] || "png";
                        extension = this.getExtensionFromMediaType(mediaType, "png");
                        tempDir = os.tmpdir();
                        filename = "codex-image-".concat(Date.now(), ".").concat(extension);
                        filepath = path.join(tempDir, filename);
                        return [4 /*yield*/, fs.promises.writeFile(filepath, Buffer.from(buffer))];
                    case 3:
                        _b.sent();
                        this.tempImageFiles.add(filepath);
                        return [2 /*return*/, filepath];
                }
            });
        });
    };
    /**
     * Convert media type to file extension
     * Handles special cases like "jpeg" -> "jpg", "svg+xml" -> "svg"
     */
    CodexModel.prototype.getExtensionFromMediaType = function (mediaType, defaultExt) {
        if (!mediaType) {
            return defaultExt;
        }
        // Normalize the media type
        var normalized = mediaType.toLowerCase().trim();
        // Handle special cases
        var extensionMap = {
            "jpeg": "jpg",
            "svg+xml": "svg",
            "vnd.microsoft.icon": "ico",
            "x-icon": "ico",
        };
        // Check if we have a mapping for this media type
        if (extensionMap[normalized]) {
            return extensionMap[normalized];
        }
        // For standard types like "png", "gif", "webp", "bmp", "tiff"
        // Just use the media type as the extension
        var simpleExtension = normalized.split("+")[0]; // Handle cases like "svg+xml"
        // Validate it's a reasonable extension (alphanumeric only)
        if (simpleExtension && /^[a-z0-9]+$/.test(simpleExtension)) {
            return simpleExtension;
        }
        // Fall back to default if we can't determine a valid extension
        return defaultExt;
    };
    CodexModel.prototype.convertRequestToInput = function (request) {
        return __awaiter(this, void 0, void 0, function () {
            var parts, _i, _a, item, imagePath, result, refusal;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        parts = [];
                        // Add system instructions as a text preamble if provided
                        if (request.systemInstructions) {
                            parts.push({
                                type: "text",
                                text: "<system>\n".concat(request.systemInstructions, "\n</system>\n\n"),
                            });
                        }
                        if (!(typeof request.input === "string")) return [3 /*break*/, 1];
                        parts.push({ type: "text", text: request.input });
                        return [3 /*break*/, 7];
                    case 1:
                        _i = 0, _a = request.input;
                        _b.label = 2;
                    case 2:
                        if (!(_i < _a.length)) return [3 /*break*/, 7];
                        item = _a[_i];
                        if (!(item.type === "input_text")) return [3 /*break*/, 3];
                        parts.push({ type: "text", text: item.text });
                        return [3 /*break*/, 6];
                    case 3:
                        if (!(item.type === "input_image")) return [3 /*break*/, 5];
                        return [4 /*yield*/, this.handleImageInput(item)];
                    case 4:
                        imagePath = _b.sent();
                        if (imagePath) {
                            parts.push({ type: "local_image", path: imagePath });
                        }
                        return [3 /*break*/, 6];
                    case 5:
                        if (item.type === "input_file") {
                            // Files could potentially be handled similarly to images
                            // For now, throw an error as we'd need to handle different file types
                            throw new Error("CodexProvider does not yet support input_file type. " +
                                "File handling needs to be implemented based on file type and format.");
                        }
                        else if (item.type === "input_audio") {
                            throw new Error("CodexProvider does not yet support input_audio type. " +
                                "Audio handling needs to be implemented.");
                        }
                        else if (item.type === "function_call_result") {
                            result = item;
                            parts.push({
                                type: "text",
                                text: "[Tool ".concat(result.name, " returned: ").concat(result.result, "]")
                            });
                        }
                        else if (item.type === "input_refusal") {
                            refusal = item;
                            parts.push({
                                type: "text",
                                text: "[Refusal: ".concat(refusal.refusal, "]")
                            });
                        }
                        _b.label = 6;
                    case 6:
                        _i++;
                        return [3 /*break*/, 2];
                    case 7:
                        // If only one text part, return as string
                        if (parts.length === 1 && parts[0].type === "text") {
                            return [2 /*return*/, parts[0].text];
                        }
                        return [2 /*return*/, parts];
                }
            });
        });
    };
    /**
     * Convert Codex Usage to ModelResponse Usage
     */
    CodexModel.prototype.convertUsage = function (usage) {
        if (!usage) {
            return { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
        }
        var inputTokensDetails = usage.cached_input_tokens
            ? [{ cachedTokens: usage.cached_input_tokens }]
            : undefined;
        var converted = {
            requests: 1,
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            totalTokens: usage.input_tokens + usage.output_tokens,
        };
        if (inputTokensDetails) {
            converted.inputTokensDetails = inputTokensDetails;
        }
        return converted;
    };
    /**
     * Convert Codex ThreadItems to AgentOutputItems
     */
    CodexModel.prototype.convertItemsToOutput = function (items, finalResponse) {
        var output = [];
        for (var _i = 0, items_1 = items; _i < items_1.length; _i++) {
            var item = items_1[_i];
            switch (item.type) {
                case "agent_message": {
                    var content = [
                        {
                            type: "output_text",
                            text: item.text,
                        },
                    ];
                    output.push({
                        type: "message",
                        role: "assistant",
                        status: "completed",
                        content: content,
                    });
                    break;
                }
                case "reasoning": {
                    output.push({
                        type: "reasoning",
                        reasoning: item.text,
                    });
                    break;
                }
                // Codex handles tools internally, so we don't expose them as function calls
                // The results are already incorporated into the agent_message
                case "command_execution":
                case "file_change":
                case "mcp_tool_call":
                    // Skip - these are internal to Codex
                    break;
                default:
                    // Unknown item type - skip
                    break;
            }
        }
        // If no items were converted, add the final response as a message
        if (output.length === 0 && finalResponse) {
            output.push({
                type: "message",
                role: "assistant",
                status: "completed",
                content: [
                    {
                        type: "output_text",
                        text: finalResponse,
                    },
                ],
            });
        }
        return output;
    };
    /**
     * Convert Codex ThreadEvent to OpenAI Agents StreamEvent
     */
    CodexModel.prototype.convertCodexEventToStreamEvent = function (event, textAccumulator) {
        var _a;
        var events = [];
        switch (event.type) {
            case "thread.started":
                events.push({ type: "response_started" });
                break;
            case "turn.started":
                // No equivalent in StreamEvent - skip
                break;
            case "item.started":
                // Initialize accumulator for this item
                if (event.item.type === "agent_message" || event.item.type === "reasoning") {
                    var itemKey = "".concat(event.item.type);
                    textAccumulator.set(itemKey, "");
                }
                break;
            case "item.updated":
                // Emit delta events for incremental text updates
                if (event.item.type === "agent_message") {
                    var itemKey = "agent_message";
                    var previousText = textAccumulator.get(itemKey) || "";
                    var currentText = event.item.text;
                    // Validate: current text should be longer than previous (no backwards updates)
                    if (currentText.length < previousText.length) {
                        console.warn("Received backwards update for text - ignoring delta");
                        break;
                    }
                    if (currentText.length > previousText.length) {
                        var delta = currentText.slice(previousText.length);
                        textAccumulator.set(itemKey, currentText);
                        events.push({
                            type: "output_text_delta",
                            delta: delta,
                        });
                    }
                }
                else if (event.item.type === "reasoning") {
                    var itemKey = "reasoning";
                    var previousText = textAccumulator.get(itemKey) || "";
                    var currentText = event.item.text;
                    if (currentText.length > previousText.length) {
                        var delta = currentText.slice(previousText.length);
                        textAccumulator.set(itemKey, currentText);
                        events.push({
                            type: "reasoning_delta",
                            delta: delta,
                        });
                    }
                }
                break;
            case "item.completed":
                if (event.item.type === "agent_message") {
                    // Emit final text done event
                    events.push({
                        type: "output_text_done",
                        text: event.item.text,
                    });
                    textAccumulator.delete("agent_message");
                }
                else if (event.item.type === "reasoning") {
                    events.push({
                        type: "reasoning_done",
                        reasoning: event.item.text,
                    });
                    textAccumulator.delete("reasoning");
                }
                break;
            case "turn.completed":
                // Emit response done with full response
                events.push({
                    type: "response_done",
                    response: {
                        usage: this.convertUsage(event.usage),
                        output: [], // Items were already emitted as deltas
                        responseId: ((_a = this.thread) === null || _a === void 0 ? void 0 : _a.id) || undefined,
                    },
                });
                break;
            case "turn.failed":
                events.push({
                    type: "error",
                    error: {
                        message: event.error.message,
                    },
                });
                break;
            case "error":
                events.push({
                    type: "error",
                    error: {
                        message: event.message,
                    },
                });
                break;
            default:
                // Unknown event type - skip
                break;
        }
        return events;
    };
    return CodexModel;
}());
