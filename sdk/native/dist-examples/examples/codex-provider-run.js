"use strict";
/**
 * Example: Use CodexProvider for a single execution run
 *
 * This demonstrates how to create and use a Codex provider for a specific
 * operation without registering it globally.
 *
 * CodexProvider capabilities:
 * - Multi-modal inputs (text and images)
 * - Streaming deltas for real-time response updates
 * - Automatic tool registration
 * - Local file path, URL, and base64 image support
 *
 * Usage:
 * ```bash
 * npx tsx examples/codex-provider-run.ts
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
var agents_1 = require("@openai/agents");
var index_ts_1 = require("../src/index.ts");
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var provider, codexModel, agent, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    provider = new index_ts_1.CodexProvider({
                        defaultModel: 'gpt-5',
                        workingDirectory: process.cwd(),
                        skipGitRepoCheck: true,
                    });
                    return [4 /*yield*/, provider.getModel()];
                case 1:
                    codexModel = _a.sent();
                    agent = new agents_1.Agent({
                        name: 'TaskSpecificAgent',
                        model: codexModel,
                        instructions: 'You are a helpful assistant. Answer questions directly and concisely in 1-2 sentences.',
                    });
                    return [4 /*yield*/, (0, agents_1.run)(agent, 'What is 2+2? Answer with just the number.')];
                case 2:
                    result = _a.sent();
                    console.log('Result:');
                    console.log(result.finalOutput);
                    return [2 /*return*/];
            }
        });
    });
}
main()
    .then(function () {
    console.log('\nMain completed successfully.');
    // Force exit after completion - native bindings may keep handles open
    // Using setTimeout to ensure output is flushed before exit
    setTimeout(function () { return process.exit(0); }, 100);
})
    .catch(function (error) {
    console.error('Error:', error);
    process.exit(1);
});
