import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { setupNativeBinding } from "./testHelpers";

setupNativeBinding();

let Codex: any;

beforeAll(async () => {
  ({ Codex } = await import("../src/index"));
});

describe("programmatic approval callback registration", () => {
  it("registers approval callback with native binding when available", () => {
    const codex = new Codex({ skipGitRepoCheck: true });
    const originalBinding = (codex as any).nativeBinding;
    const registerApprovalCallback = jest.fn();
    (codex as any).nativeBinding = { registerApprovalCallback };

    const handler = jest.fn(() => true);

    try {
      codex.setApprovalCallback(handler);
      expect(registerApprovalCallback).toHaveBeenCalledTimes(1);
      expect(registerApprovalCallback).toHaveBeenCalledWith(handler);
    } finally {
      (codex as any).nativeBinding = originalBinding;
    }
  });

  it("emits a warning when approval callback is not supported", () => {
    const codex = new Codex({ skipGitRepoCheck: true });
    const originalBinding = (codex as any).nativeBinding;
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    (codex as any).nativeBinding = {};

    try {
      codex.setApprovalCallback(() => true);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      (codex as any).nativeBinding = originalBinding;
      warnSpy.mockRestore();
    }
  });
});

