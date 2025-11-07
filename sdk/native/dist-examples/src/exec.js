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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodexExec = void 0;
var nativeBinding_1 = require("./nativeBinding");
/**
 * CodexExec for the native package - uses NAPI bindings exclusively.
 * No CLI fallback.
 */
var CodexExec = /** @class */ (function () {
    function CodexExec() {
        var nativeBinding = (0, nativeBinding_1.getNativeBinding)();
        if (!nativeBinding) {
            throw new Error("Native NAPI binding not available. Make sure @openai/codex-native is properly installed and built.");
        }
        this.native = nativeBinding;
    }
    CodexExec.prototype.run = function (args) {
        return __asyncGenerator(this, arguments, function run_1() {
            var binding, queue, request, runPromise, loopError, _a, queue_1, queue_1_1, value, e_1_1, error_1;
            var _b, e_1, _c, _d;
            var _e, _f;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0:
                        binding = this.native;
                        queue = new AsyncQueue();
                        request = {
                            prompt: args.input,
                            threadId: (_e = args.threadId) !== null && _e !== void 0 ? _e : undefined,
                            images: args.images && args.images.length > 0 ? args.images : undefined,
                            model: args.model,
                            sandboxMode: args.sandboxMode,
                            workingDirectory: args.workingDirectory,
                            skipGitRepoCheck: args.skipGitRepoCheck,
                            outputSchema: args.outputSchema,
                            baseUrl: args.baseUrl,
                            apiKey: args.apiKey,
                            fullAuto: args.fullAuto,
                            reviewMode: args.review ? true : undefined,
                            reviewHint: (_f = args.review) === null || _f === void 0 ? void 0 : _f.userFacingHint,
                        };
                        try {
                            runPromise = binding
                                .runThreadStream(request, function (err, eventJson) {
                                if (err) {
                                    queue.fail(err);
                                    return;
                                }
                                try {
                                    queue.push(eventJson !== null && eventJson !== void 0 ? eventJson : "null");
                                }
                                catch (error) {
                                    queue.fail(error);
                                }
                            })
                                .then(function () {
                                queue.end();
                            }, function (error) {
                                queue.fail(error);
                            });
                        }
                        catch (error) {
                            queue.fail(error);
                            throw error;
                        }
                        _g.label = 1;
                    case 1:
                        _g.trys.push([1, 17, 18, 21]);
                        _g.label = 2;
                    case 2:
                        _g.trys.push([2, 9, 10, 15]);
                        _a = true, queue_1 = __asyncValues(queue);
                        _g.label = 3;
                    case 3: return [4 /*yield*/, __await(queue_1.next())];
                    case 4:
                        if (!(queue_1_1 = _g.sent(), _b = queue_1_1.done, !_b)) return [3 /*break*/, 8];
                        _d = queue_1_1.value;
                        _a = false;
                        value = _d;
                        return [4 /*yield*/, __await(value)];
                    case 5: return [4 /*yield*/, _g.sent()];
                    case 6:
                        _g.sent();
                        _g.label = 7;
                    case 7:
                        _a = true;
                        return [3 /*break*/, 3];
                    case 8: return [3 /*break*/, 15];
                    case 9:
                        e_1_1 = _g.sent();
                        e_1 = { error: e_1_1 };
                        return [3 /*break*/, 15];
                    case 10:
                        _g.trys.push([10, , 13, 14]);
                        if (!(!_a && !_b && (_c = queue_1.return))) return [3 /*break*/, 12];
                        return [4 /*yield*/, __await(_c.call(queue_1))];
                    case 11:
                        _g.sent();
                        _g.label = 12;
                    case 12: return [3 /*break*/, 14];
                    case 13:
                        if (e_1) throw e_1.error;
                        return [7 /*endfinally*/];
                    case 14: return [7 /*endfinally*/];
                    case 15: return [4 /*yield*/, __await(runPromise)];
                    case 16:
                        _g.sent();
                        return [3 /*break*/, 21];
                    case 17:
                        error_1 = _g.sent();
                        loopError = error_1;
                        throw error_1;
                    case 18:
                        queue.end();
                        if (!loopError) return [3 /*break*/, 20];
                        return [4 /*yield*/, __await(runPromise.catch(function () { }))];
                    case 19:
                        _g.sent();
                        _g.label = 20;
                    case 20: return [7 /*endfinally*/];
                    case 21: return [2 /*return*/];
                }
            });
        });
    };
    return CodexExec;
}());
exports.CodexExec = CodexExec;
var AsyncQueue = /** @class */ (function () {
    function AsyncQueue() {
        this.buffer = [];
        this.waiters = [];
        this.ended = false;
    }
    AsyncQueue.prototype.push = function (value) {
        if (this.ended)
            return;
        if (this.waiters.length > 0) {
            var waiter = this.waiters.shift();
            waiter.resolve({ value: value, done: false });
            return;
        }
        this.buffer.push(value);
    };
    AsyncQueue.prototype.end = function () {
        if (this.ended)
            return;
        this.ended = true;
        var waiters = this.waiters;
        this.waiters = [];
        for (var _i = 0, waiters_1 = waiters; _i < waiters_1.length; _i++) {
            var waiter = waiters_1[_i];
            waiter.resolve({ value: undefined, done: true });
        }
    };
    AsyncQueue.prototype.fail = function (error) {
        if (this.ended)
            return;
        this.error = error;
        this.ended = true;
        var waiters = this.waiters;
        this.waiters = [];
        for (var _i = 0, waiters_2 = waiters; _i < waiters_2.length; _i++) {
            var waiter = waiters_2[_i];
            waiter.reject(error);
        }
    };
    AsyncQueue.prototype.next = function () {
        return __awaiter(this, void 0, void 0, function () {
            var value;
            var _this = this;
            return __generator(this, function (_a) {
                if (this.buffer.length > 0) {
                    value = this.buffer.shift();
                    return [2 /*return*/, { value: value, done: false }];
                }
                if (this.error) {
                    return [2 /*return*/, Promise.reject(this.error)];
                }
                if (this.ended) {
                    return [2 /*return*/, { value: undefined, done: true }];
                }
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        _this.waiters.push({ resolve: resolve, reject: reject });
                    })];
            });
        });
    };
    AsyncQueue.prototype[Symbol.asyncIterator] = function () {
        return this;
    };
    return AsyncQueue;
}());
