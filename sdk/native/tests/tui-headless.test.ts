import { describe, it, expect, beforeAll } from "@jest/globals";

let binding: any;

beforeAll(async () => {
  binding = await import("../index.js");
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
    const firstFrame = frames[0]!;
    expect(typeof firstFrame).toBe("string");
    expect(firstFrame.length).toBeGreaterThan(0);
    expect(firstFrame).toContain("first");
    expect(firstFrame).toContain("second");
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
    expect(frames).toHaveLength(1);
    const firstFrame = frames[0]!;
    expect(typeof firstFrame).toBe("string");
    const totalAs = Array.from(firstFrame).filter((ch) => ch === "A").length;
    expect(totalAs).toBe(long.length);
  });

  it("preserves emoji and CJK glyphs", async () => {
    if (!binding || typeof binding.tuiTestRun !== "function") {
      return;
    }
    const sample = "😀😀😀😀😀 你好世界";
    const frames: string[] = await binding.tuiTestRun({
      width: 20,
      height: 6,
      viewport: { x: 0, y: 5, width: 20, height: 1 },
      lines: [sample],
    });
    const firstFrame = frames[0]!;
    for (const ch of sample.replace(/\s+/g, "")) {
      expect(firstFrame).toContain(ch);
    }
  });

  it("wraps prose without splitting words mid-line", async () => {
    if (!binding || typeof binding.tuiTestRun !== "function") {
      return;
    }
    const sample =
      "Years passed, and Willowmere thrived in peace and friendship. Mira’s herb garden flourished with both ordinary and enchanted plants.";
    const frames: string[] = await binding.tuiTestRun({
      width: 40,
      height: 10,
      viewport: { x: 0, y: 9, width: 40, height: 1 },
      lines: [sample],
    });
    const firstFrame = frames[0]!;
    expect(firstFrame).not.toContain("bo\nth");
  });

  it("handles em dash sequences without splitting subsequent words", async () => {
    if (!binding || typeof binding.tuiTestRun !== "function") {
      return;
    }
    const sample =
      "Mara found an old key on the shore. Curious, she opened a tarnished box half-buried in sand—and inside lay a single, glowing seed.";
    const frames: string[] = await binding.tuiTestRun({
      width: 40,
      height: 10,
      viewport: { x: 0, y: 9, width: 40, height: 1 },
      lines: [sample],
    });
    const firstFrame = frames[0]!;
    expect(firstFrame).not.toContain("insi\nde");
  });
});

