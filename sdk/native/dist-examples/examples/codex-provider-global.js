"use strict";
/**
 * Example: Using CodexProvider with OpenAI Agents framework
 *
 * This demonstrates how to create a CodexProvider and use it
 * with the OpenAI Agents framework to run queries.
 *
 * CodexProvider features:
 * - Multi-modal input support (text + images)
 * - Streaming response deltas for real-time updates
 * - Automatic tool registration when passed to agents
 * - No API key required (uses local Codex instance)
 *
 * Usage:
 * ```bash
 * npx tsx examples/codex-provider-global.ts
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
        var codexProvider, model, agent, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    codexProvider = new index_ts_1.CodexProvider({
                        defaultModel: 'gpt-5',
                        workingDirectory: process.cwd(),
                        skipGitRepoCheck: true,
                    });
                    model = codexProvider.getModel();
                    agent = new agents_1.Agent({
                        name: 'SharedCodexAgent',
                        model: model,
                        instructions: 'You are a helpful assistant powered by Codex. Answer concisely in one sentence.',
                    });
                    // Run a single query to demonstrate the integration
                    console.log('Query:');
                    return [4 /*yield*/, (0, agents_1.run)(agent, 'What is 2+2?')];
                case 1:
                    result = _a.sent();
                    console.log(result.finalOutput);
                    console.log('\nQuery completed successfully!');
                    return [2 /*return*/];
            }
        });
    });
}
main()
    .then(function () {
    console.log('\nExiting...');
    // Force exit after completion to avoid hanging from native binding
    // Use a small delay to ensure stdout flushes
    setTimeout(function () { return process.exit(0); }, 100);
})
    .catch(function (error) {
    console.error('Error:', error);
    setTimeout(function () { return process.exit(1); }, 100);
});
// Fallback timeout in case the native binding hangs
setTimeout(function () {
    console.error('\nERROR: Script timed out after 30 seconds');
    process.exit(124);
}, 30000);
