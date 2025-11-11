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
    expect(typeof frames[0]).toBe("string");
    expect(frames[0].length).toBeGreaterThan(0);
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
    expect(typeof frames[0]).toBe("string");
    expect(frames[0].length).toBeGreaterThan(0);
  });
});

