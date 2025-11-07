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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Codex = void 0;
var exec_1 = require("./exec");
var nativeBinding_1 = require("./nativeBinding");
var thread_1 = require("./thread");
var outputSchemaFile_1 = require("./outputSchemaFile");
var reviewOptions_1 = require("./reviewOptions");
/**
 * Codex is the main class for interacting with the Codex agent.
 *
 * This is the native NAPI-based implementation that uses Rust bindings directly.
 *
 * Use the `startThread()` method to start a new thread or `resumeThread()` to resume a previously started thread.
 */
var Codex = /** @class */ (function () {
    function Codex(options) {
        if (options === void 0) { options = {}; }
        var predefinedTools = options.tools ? __spreadArray([], options.tools, true) : [];
        this.nativeBinding = (0, nativeBinding_1.getNativeBinding)();
        this.options = __assign(__assign({}, options), { tools: [] });
        if (this.nativeBinding) {
            // clearRegisteredTools may not be available in all builds
            if (typeof this.nativeBinding.clearRegisteredTools === 'function') {
                this.nativeBinding.clearRegisteredTools();
            }
            for (var _i = 0, predefinedTools_1 = predefinedTools; _i < predefinedTools_1.length; _i++) {
                var tool = predefinedTools_1[_i];
                this.registerTool(tool);
            }
        }
        this.exec = new exec_1.CodexExec();
    }
    Codex.prototype.registerTool = function (tool) {
        if (!this.nativeBinding) {
            throw new Error("Native tool registration requires the NAPI binding");
        }
        // registerTool may not be available in all builds
        if (typeof this.nativeBinding.registerTool !== 'function') {
            console.warn("registerTool is not available in this build - tools feature may be incomplete");
            return;
        }
        var handler = tool.handler, info = __rest(tool, ["handler"]);
        this.nativeBinding.registerTool(info, handler);
        if (!this.options.tools) {
            this.options.tools = [];
        }
        this.options.tools.push(tool);
    };
    /**
     * Starts a new conversation with an agent.
     * @returns A new thread instance.
     */
    Codex.prototype.startThread = function (options) {
        if (options === void 0) { options = {}; }
        return new thread_1.Thread(this.exec, this.options, options);
    };
    /**
     * Resumes a conversation with an agent based on the thread id.
     * Threads are persisted in ~/.codex/sessions.
     *
     * @param id The id of the thread to resume.
     * @returns A new thread instance.
     */
    Codex.prototype.resumeThread = function (id, options) {
        if (options === void 0) { options = {}; }
        return new thread_1.Thread(this.exec, this.options, options, id);
    };
    /**
     * Starts a review task using the built-in Codex review flow.
     */
    Codex.prototype.review = function (options) {
        return __awaiter(this, void 0, void 0, function () {
            var generator, items, finalResponse, usage, turnFailure, _loop_1, _a, generator_1, generator_1_1, state_1, e_1_1;
            var _b, e_1, _c, _d;
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0:
                        generator = this.reviewStreamedInternal(options);
                        items = [];
                        finalResponse = "";
                        usage = null;
                        turnFailure = null;
                        _e.label = 1;
                    case 1:
                        _e.trys.push([1, 6, 7, 12]);
                        _loop_1 = function () {
                            _d = generator_1_1.value;
                            _a = false;
                            var event_1 = _d;
                            if (event_1.type === "item.completed") {
                                if (event_1.item.type === "agent_message") {
                                    finalResponse = event_1.item.text;
                                }
                                items.push(event_1.item);
                            }
                            else if (event_1.type === "exited_review_mode") {
                                // Capture the structured review output
                                if (event_1.review_output) {
                                    var reviewOutput = event_1.review_output;
                                    var reviewText_1 = "";
                                    // Add overall explanation
                                    if (reviewOutput.overall_explanation) {
                                        reviewText_1 += reviewOutput.overall_explanation;
                                    }
                                    // Add findings if present
                                    if (reviewOutput.findings && reviewOutput.findings.length > 0) {
                                        if (reviewText_1)
                                            reviewText_1 += "\n\n";
                                        reviewText_1 += "## Review Findings\n\n";
                                        reviewOutput.findings.forEach(function (finding, index) {
                                            reviewText_1 += "### ".concat(index + 1, ". ").concat(finding.title, "\n");
                                            reviewText_1 += "".concat(finding.body, "\n");
                                            reviewText_1 += "**Priority:** ".concat(finding.priority, " | **Confidence:** ").concat(finding.confidence_score, "\n");
                                            reviewText_1 += "**Location:** ".concat(finding.code_location.absolute_file_path, ":").concat(finding.code_location.line_range.start, "-").concat(finding.code_location.line_range.end, "\n\n");
                                        });
                                    }
                                    finalResponse = reviewText_1;
                                }
                            }
                            else if (event_1.type === "turn.completed") {
                                usage = event_1.usage;
                            }
                            else if (event_1.type === "turn.failed") {
                                turnFailure = event_1.error;
                                return "break";
                            }
                        };
                        _a = true, generator_1 = __asyncValues(generator);
                        _e.label = 2;
                    case 2: return [4 /*yield*/, generator_1.next()];
                    case 3:
                        if (!(generator_1_1 = _e.sent(), _b = generator_1_1.done, !_b)) return [3 /*break*/, 5];
                        state_1 = _loop_1();
                        if (state_1 === "break")
                            return [3 /*break*/, 5];
                        _e.label = 4;
                    case 4:
                        _a = true;
                        return [3 /*break*/, 2];
                    case 5: return [3 /*break*/, 12];
                    case 6:
                        e_1_1 = _e.sent();
                        e_1 = { error: e_1_1 };
                        return [3 /*break*/, 12];
                    case 7:
                        _e.trys.push([7, , 10, 11]);
                        if (!(!_a && !_b && (_c = generator_1.return))) return [3 /*break*/, 9];
                        return [4 /*yield*/, _c.call(generator_1)];
                    case 8:
                        _e.sent();
                        _e.label = 9;
                    case 9: return [3 /*break*/, 11];
                    case 10:
                        if (e_1) throw e_1.error;
                        return [7 /*endfinally*/];
                    case 11: return [7 /*endfinally*/];
                    case 12:
                        if (turnFailure) {
                            throw new Error(turnFailure.message);
                        }
                        return [2 /*return*/, { items: items, finalResponse: finalResponse, usage: usage }];
                }
            });
        });
    };
    /**
     * Starts a review task and returns the event stream.
     */
    Codex.prototype.reviewStreamed = function (options) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, { events: this.reviewStreamedInternal(options) }];
            });
        });
    };
    Codex.prototype.reviewStreamedInternal = function (options) {
        return __asyncGenerator(this, arguments, function reviewStreamedInternal_1() {
            var target, _a, threadOptions, _b, turnOptions, _c, prompt, hint, _d, schemaPath, cleanup, generator, _e, generator_2, generator_2_1, item, parsed, e_2_1;
            var _f, e_2, _g, _h;
            return __generator(this, function (_j) {
                switch (_j.label) {
                    case 0:
                        target = options.target, _a = options.threadOptions, threadOptions = _a === void 0 ? {} : _a, _b = options.turnOptions, turnOptions = _b === void 0 ? {} : _b;
                        _c = (0, reviewOptions_1.buildReviewPrompt)(target), prompt = _c.prompt, hint = _c.hint;
                        return [4 /*yield*/, __await((0, outputSchemaFile_1.createOutputSchemaFile)(turnOptions.outputSchema))];
                    case 1:
                        _d = _j.sent(), schemaPath = _d.schemaPath, cleanup = _d.cleanup;
                        generator = this.exec.run({
                            input: prompt,
                            baseUrl: this.options.baseUrl,
                            apiKey: this.options.apiKey,
                            model: threadOptions.model,
                            sandboxMode: threadOptions.sandboxMode,
                            workingDirectory: threadOptions.workingDirectory,
                            skipGitRepoCheck: threadOptions.skipGitRepoCheck,
                            outputSchemaFile: schemaPath,
                            outputSchema: turnOptions.outputSchema,
                            fullAuto: threadOptions.fullAuto,
                            review: {
                                userFacingHint: hint,
                            },
                        });
                        _j.label = 2;
                    case 2:
                        _j.trys.push([2, , 17, 19]);
                        _j.label = 3;
                    case 3:
                        _j.trys.push([3, 10, 11, 16]);
                        _e = true, generator_2 = __asyncValues(generator);
                        _j.label = 4;
                    case 4: return [4 /*yield*/, __await(generator_2.next())];
                    case 5:
                        if (!(generator_2_1 = _j.sent(), _f = generator_2_1.done, !_f)) return [3 /*break*/, 9];
                        _h = generator_2_1.value;
                        _e = false;
                        item = _h;
                        parsed = void 0;
                        try {
                            parsed = JSON.parse(item);
                        }
                        catch (error) {
                            throw new Error("Failed to parse item: ".concat(item), { cause: error });
                        }
                        return [4 /*yield*/, __await(parsed)];
                    case 6: return [4 /*yield*/, _j.sent()];
                    case 7:
                        _j.sent();
                        _j.label = 8;
                    case 8:
                        _e = true;
                        return [3 /*break*/, 4];
                    case 9: return [3 /*break*/, 16];
                    case 10:
                        e_2_1 = _j.sent();
                        e_2 = { error: e_2_1 };
                        return [3 /*break*/, 16];
                    case 11:
                        _j.trys.push([11, , 14, 15]);
                        if (!(!_e && !_f && (_g = generator_2.return))) return [3 /*break*/, 13];
                        return [4 /*yield*/, __await(_g.call(generator_2))];
                    case 12:
                        _j.sent();
                        _j.label = 13;
                    case 13: return [3 /*break*/, 15];
                    case 14:
                        if (e_2) throw e_2.error;
                        return [7 /*endfinally*/];
                    case 15: return [7 /*endfinally*/];
                    case 16: return [3 /*break*/, 19];
                    case 17: return [4 /*yield*/, __await(cleanup())];
                    case 18:
                        _j.sent();
                        return [7 /*endfinally*/];
                    case 19: return [2 /*return*/];
                }
            });
        });
    };
    return Codex;
}());
exports.Codex = Codex;
