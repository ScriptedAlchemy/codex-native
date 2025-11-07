"use strict";
/**
 * Example: Using Codex review method to review code changes
 *
 * This demonstrates how to use the review() method on the Codex class
 * to perform code reviews with different targets.
 *
 * Review targets:
 * - current_changes: Review staged/unstaged files
 * - custom: Custom review prompt
 *
 * Usage:
 * ```bash
 * npx tsx examples/review-example.ts
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
var index_ts_1 = require("../src/index.ts");
var promises_1 = require("fs/promises");
var path_1 = require("path");
var os_1 = require("os");
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var tmpDir, sampleCode, codex, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, promises_1.default.mkdtemp(path_1.default.join(os_1.default.tmpdir(), "codex-review-test-"))];
                case 1:
                    tmpDir = _a.sent();
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, , 5, 7]);
                    sampleCode = "\n// Sample code with some issues\nfunction calculateTotal(items) {\n  var total = 0;  // Using var instead of const/let\n  for (var i = 0; i < items.length; i++) {  // Could use forEach/map\n    total = total + items[i].price;\n  }\n  return total;  // Missing input validation\n}\n\n// Function with potential bug\nfunction divideNumbers(a, b) {\n  return a / b;  // No zero-division check\n}\n\n// Unused function\nfunction unusedFunction() {\n  console.log(\"This is never called\");\n}\n";
                    return [4 /*yield*/, promises_1.default.writeFile(path_1.default.join(tmpDir, "sample.js"), sampleCode)];
                case 3:
                    _a.sent();
                    console.log("Created sample code for review in:", tmpDir);
                    console.log("\nStarting code review with custom prompt...\n");
                    codex = new index_ts_1.Codex();
                    return [4 /*yield*/, codex.review({
                            target: {
                                type: "custom",
                                prompt: "Review the JavaScript code in sample.js. Look for:\n1. Outdated JavaScript patterns (var, for loops)\n2. Missing error handling\n3. Potential bugs\n4. Unused code\n\nProvide a concise summary of findings with 2-3 key issues.",
                                hint: "JavaScript code review",
                            },
                            threadOptions: {
                                model: "gpt-5-codex",
                                workingDirectory: tmpDir,
                                skipGitRepoCheck: true,
                                fullAuto: true,
                            },
                        })];
                case 4:
                    result = _a.sent();
                    console.log("\n" + "=".repeat(70));
                    console.log("Review Results:");
                    console.log("=".repeat(70) + "\n");
                    if (result.finalResponse) {
                        console.log(result.finalResponse);
                    }
                    else {
                        console.log("[No final review summary produced]");
                    }
                    if (result.usage) {
                        console.log("\nToken usage: ".concat(result.usage.input_tokens, " input, ").concat(result.usage.output_tokens, " output"));
                    }
                    console.log("\n✓ Review completed successfully");
                    return [3 /*break*/, 7];
                case 5: 
                // Cleanup
                return [4 /*yield*/, promises_1.default.rm(tmpDir, { recursive: true, force: true }).catch(function () { })];
                case 6:
                    // Cleanup
                    _a.sent();
                    console.log("✓ Cleaned up temporary directory");
                    return [7 /*endfinally*/];
                case 7: return [2 /*return*/];
            }
        });
    });
}
main()
    .then(function () {
    console.log("\nExample completed successfully.");
    setTimeout(function () { return process.exit(0); }, 100);
})
    .catch(function (error) {
    console.error("Error:", error);
    process.exit(1);
});
