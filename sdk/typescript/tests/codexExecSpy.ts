import * as child_process from "node:child_process";

jest.mock("node:child_process", () => {
  const actual = jest.requireActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, spawn: jest.fn(actual.spawn) };
});

const actualChildProcess =
  jest.requireActual<typeof import("node:child_process")>("node:child_process");
const spawnMock = child_process.spawn as jest.MockedFunction<typeof actualChildProcess.spawn>;

export function codexExecSpy(): {
  args: string[][];
  envs: (Record<string, string> | undefined)[];
  inputItemsPayloads: unknown[];
  dynamicToolsPayloads: unknown[];
  restore: () => void;
} {
  const previousImplementation = spawnMock.getMockImplementation() ?? actualChildProcess.spawn;
  const args: string[][] = [];
  const envs: (Record<string, string> | undefined)[] = [];
  const inputItemsPayloads: unknown[] = [];
  const dynamicToolsPayloads: unknown[] = [];

  spawnMock.mockImplementation(((...spawnArgs: Parameters<typeof child_process.spawn>) => {
    const commandArgs = spawnArgs[1];
    args.push(Array.isArray(commandArgs) ? [...commandArgs] : []);
    const options = spawnArgs[2] as child_process.SpawnOptions | undefined;
    envs.push(options?.env as Record<string, string> | undefined);
    if (Array.isArray(commandArgs)) {
      const inputItemsJson = getFlagValue(commandArgs, "--input-items-json");
      if (inputItemsJson) {
        const payload = readJsonArg(inputItemsJson);
        if (payload !== undefined) {
          inputItemsPayloads.push(payload);
        }
      }
      const dynamicToolsJson = getFlagValue(commandArgs, "--dynamic-tools-json");
      if (dynamicToolsJson) {
        const payload = readJsonArg(dynamicToolsJson);
        if (payload !== undefined) {
          dynamicToolsPayloads.push(payload);
        }
      }
    }
    return previousImplementation(...spawnArgs);
  }) as typeof actualChildProcess.spawn);

  return {
    args,
    envs,
    inputItemsPayloads,
    dynamicToolsPayloads,
    restore: () => {
      spawnMock.mockClear();
      spawnMock.mockImplementation(previousImplementation);
    },
  };
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.findIndex((arg) => arg === flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

function readJsonArg(value: string): unknown | undefined {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
