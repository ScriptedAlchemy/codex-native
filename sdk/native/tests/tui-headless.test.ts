import { describe, it, expect, beforeAll } from "@jest/globals";

let binding: any;

beforeAll(async () => {
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);

  try {
    binding = req("../index.cjs");
  } catch {
    // Fallback to compiled N-API binding entry
    const mod = await import("../index.js");
    binding = mod.default ?? mod;
  }
});

describe("tuiTestRun headless snapshots", () => {
  it("renders inserted history lines into vt100 screen", async () => {
    if (!binding || typeof binding.tuiTestRun !== "function") {
      return;
    }
    const frames: string[] = await binding.tuiTestRun({
      width: 20,
      height: 6,
      viewport: { x: 0, y: 5, width: 20, height: 1 },
      lines: ["first", "second"],
    });
    expect(frames).toHaveLength(1);
    expect(frames[0]?.length ?? 0).toBeGreaterThan(0);
  });

  it("wraps long tokens across lines without dropping characters", async () => {
    if (!binding || typeof binding.tuiTestRun !== "function") {
      return;
    }
    const long = "A".repeat(45);
    const frames: string[] = await binding.tuiTestRun({
      width: 20,
      height: 6,
      viewport: { x: 0, y: 5, width: 20, height: 1 },
      lines: [long],
    });
    const screen = frames[0] ?? "";
    const cellCount = Array.from(screen.replace(/\n/g, "")).length;
    expect(cellCount).toBeGreaterThanOrEqual(long.length);
  });
});

