import test from "node:test";
import assert from "node:assert/strict";
import { computeMaxRelevance } from "../src/reverie-hints.js";

test("computeMaxRelevance picks highest bestRelevance", () => {
  const value = computeMaxRelevance([
    { bestRelevance: 0.42 } as any,
    { bestRelevance: 0.78 } as any,
    { bestRelevance: 0.61 } as any,
  ]);
  assert.equal(value, 0.78);
});

test("computeMaxRelevance handles empty arrays", () => {
  assert.equal(computeMaxRelevance([]), 0);
});
