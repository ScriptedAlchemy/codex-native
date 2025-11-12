import { beforeAll, describe, expect, it } from "@jest/globals";

import { tokenizerCount, tokenizerDecode, tokenizerEncode } from "../src/index";
import { setupNativeBinding } from "./testHelpers";

beforeAll(() => {
  setupNativeBinding();
});

describe("Tokenizer Native Bindings", () => {
  it("encodes and decodes text using cl100k_base", () => {
    const text = "hello world";
    const tokens = tokenizerEncode(text, { encoding: "cl100k_base" });
    expect(tokens).toEqual([15339, 1917]);

    const decoded = tokenizerDecode(tokens, { encoding: "cl100k_base" });
    expect(decoded).toBe(text);
  });

  it("counts tokens for given text", () => {
    const count = tokenizerCount("hello world", { encoding: "cl100k_base" });
    expect(count).toBe(2);
  });

  it("supports withSpecialTokens flag", () => {
    const tokens = tokenizerEncode("test", {
      encoding: "cl100k_base",
      withSpecialTokens: true,
    });
    expect(Array.isArray(tokens)).toBe(true);
    expect(tokens.length).toBeGreaterThan(0);
  });
});

