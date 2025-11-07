"use strict";
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
exports.Thread = void 0;
var outputSchemaFile_1 = require("./outputSchemaFile");
/** Respesent a thread of conversation with the agent. One thread can have multiple consecutive turns. */
var Thread = /** @class */ (function () {
    /* @internal */
    function Thread(exec, options, threadOptions, id) {
        if (id === void 0) { id = null; }
        this._exec = exec;
        this._options = options;
        this._id = id;
        this._threadOptions = threadOptions;
    }
    Object.defineProperty(Thread.prototype, "id", {
        /** Returns the ID of the thread. Populated after the first turn starts. */
        get: function () {
            return this._id;
        },
        enumerable: false,
        configurable: true
    });
    /** Provides the input to the agent and streams events as they are produced during the turn. */
    Thread.prototype.runStreamed = function (input_1) {
        return __awaiter(this, arguments, void 0, function (input, turnOptions) {
            if (turnOptions === void 0) { turnOptions = {}; }
            return __generator(this, function (_a) {
                return [2 /*return*/, { events: this.runStreamedInternal(input, turnOptions) }];
            });
        });
    };
    Thread.prototype.runStreamedInternal = function (input_1) {
        return __asyncGenerator(this, arguments, function runStreamedInternal_1(input, turnOptions) {
            var _a, schemaPath, cleanup, options, _b, prompt, images, generator, _c, generator_1, generator_1_1, item, parsed, e_1_1;
            var _d, e_1, _e, _f;
            if (turnOptions === void 0) { turnOptions = {}; }
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0: return [4 /*yield*/, __await((0, outputSchemaFile_1.createOutputSchemaFile)(turnOptions.outputSchema))];
                    case 1:
                        _a = _g.sent(), schemaPath = _a.schemaPath, cleanup = _a.cleanup;
                        options = this._threadOptions;
                        _b = normalizeInput(input), prompt = _b.prompt, images = _b.images;
                        generator = this._exec.run({
                            input: prompt,
                            baseUrl: this._options.baseUrl,
                            apiKey: this._options.apiKey,
                            threadId: this._id,
                            images: images,
                            model: options === null || options === void 0 ? void 0 : options.model,
                            sandboxMode: options === null || options === void 0 ? void 0 : options.sandboxMode,
                            workingDirectory: options === null || options === void 0 ? void 0 : options.workingDirectory,
                            skipGitRepoCheck: options === null || options === void 0 ? void 0 : options.skipGitRepoCheck,
                            outputSchemaFile: schemaPath,
                            outputSchema: turnOptions.outputSchema,
                            fullAuto: options === null || options === void 0 ? void 0 : options.fullAuto,
                        });
                        _g.label = 2;
                    case 2:
                        _g.trys.push([2, , 17, 19]);
                        _g.label = 3;
                    case 3:
                        _g.trys.push([3, 10, 11, 16]);
                        _c = true, generator_1 = __asyncValues(generator);
                        _g.label = 4;
                    case 4: return [4 /*yield*/, __await(generator_1.next())];
                    case 5:
                        if (!(generator_1_1 = _g.sent(), _d = generator_1_1.done, !_d)) return [3 /*break*/, 9];
                        _f = generator_1_1.value;
                        _c = false;
                        item = _f;
                        parsed = void 0;
                        try {
                            parsed = JSON.parse(item);
                        }
                        catch (error) {
                            throw new Error("Failed to parse item: ".concat(item), { cause: error });
                        }
                        if (parsed.type === "thread.started") {
                            this._id = parsed.thread_id;
                        }
                        return [4 /*yield*/, __await(parsed)];
                    case 6: return [4 /*yield*/, _g.sent()];
                    case 7:
                        _g.sent();
                        _g.label = 8;
                    case 8:
                        _c = true;
                        return [3 /*break*/, 4];
                    case 9: return [3 /*break*/, 16];
                    case 10:
                        e_1_1 = _g.sent();
                        e_1 = { error: e_1_1 };
                        return [3 /*break*/, 16];
                    case 11:
                        _g.trys.push([11, , 14, 15]);
                        if (!(!_c && !_d && (_e = generator_1.return))) return [3 /*break*/, 13];
                        return [4 /*yield*/, __await(_e.call(generator_1))];
                    case 12:
                        _g.sent();
                        _g.label = 13;
                    case 13: return [3 /*break*/, 15];
                    case 14:
                        if (e_1) throw e_1.error;
                        return [7 /*endfinally*/];
                    case 15: return [7 /*endfinally*/];
                    case 16: return [3 /*break*/, 19];
                    case 17: return [4 /*yield*/, __await(cleanup())];
                    case 18:
                        _g.sent();
                        return [7 /*endfinally*/];
                    case 19: return [2 /*return*/];
                }
            });
        });
    };
    /** Provides the input to the agent and returns the completed turn. */
    Thread.prototype.run = function (input_1) {
        return __awaiter(this, arguments, void 0, function (input, turnOptions) {
            var generator, items, finalResponse, usage, turnFailure, _a, generator_2, generator_2_1, event_1, e_2_1;
            var _b, e_2, _c, _d;
            if (turnOptions === void 0) { turnOptions = {}; }
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0:
                        generator = this.runStreamedInternal(input, turnOptions);
                        items = [];
                        finalResponse = "";
                        usage = null;
                        turnFailure = null;
                        _e.label = 1;
                    case 1:
                        _e.trys.push([1, 6, 7, 12]);
                        _a = true, generator_2 = __asyncValues(generator);
                        _e.label = 2;
                    case 2: return [4 /*yield*/, generator_2.next()];
                    case 3:
                        if (!(generator_2_1 = _e.sent(), _b = generator_2_1.done, !_b)) return [3 /*break*/, 5];
                        _d = generator_2_1.value;
                        _a = false;
                        event_1 = _d;
                        if (event_1.type === "item.completed") {
                            if (event_1.item.type === "agent_message") {
                                finalResponse = event_1.item.text;
                            }
                            items.push(event_1.item);
                        }
                        else if (event_1.type === "turn.completed") {
                            usage = event_1.usage;
                        }
                        else if (event_1.type === "turn.failed") {
                            turnFailure = event_1.error;
                            return [3 /*break*/, 5];
                        }
                        _e.label = 4;
                    case 4:
                        _a = true;
                        return [3 /*break*/, 2];
                    case 5: return [3 /*break*/, 12];
                    case 6:
                        e_2_1 = _e.sent();
                        e_2 = { error: e_2_1 };
                        return [3 /*break*/, 12];
                    case 7:
                        _e.trys.push([7, , 10, 11]);
                        if (!(!_a && !_b && (_c = generator_2.return))) return [3 /*break*/, 9];
                        return [4 /*yield*/, _c.call(generator_2)];
                    case 8:
                        _e.sent();
                        _e.label = 9;
                    case 9: return [3 /*break*/, 11];
                    case 10:
                        if (e_2) throw e_2.error;
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
    return Thread;
}());
exports.Thread = Thread;
function normalizeInput(input) {
    if (typeof input === "string") {
        return { prompt: input, images: [] };
    }
    var promptParts = [];
    var images = [];
    for (var _i = 0, input_1 = input; _i < input_1.length; _i++) {
        var item = input_1[_i];
        if (item.type === "text") {
            promptParts.push(item.text);
        }
        else if (item.type === "local_image") {
            images.push(item.path);
        }
    }
    return { prompt: promptParts.join("\n\n"), images: images };
}
