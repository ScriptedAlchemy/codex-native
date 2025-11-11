#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const incomingArgs = process.argv.slice(2);
const hasRunInBand = incomingArgs.includes("--runInBand") || incomingArgs.includes("-i");

const sanitizedArgs = [];
for (let i = 0; i < incomingArgs.length; i += 1) {
  const arg = incomingArgs[i];

  if (hasRunInBand) {
    if (arg === "-w" || arg === "--maxWorkers") {
      if (arg === "-w") {
        const next = incomingArgs[i + 1];
        if (next && !next.startsWith("-")) {
          i += 1;
        }
      }
      continue;
    }

    if (arg.startsWith("--maxWorkers=")) {
      continue;
    }
  }

  sanitizedArgs.push(arg);
}

const existingNodeOptions = process.env.NODE_OPTIONS ? [process.env.NODE_OPTIONS] : [];
process.env.NODE_OPTIONS = ["--experimental-vm-modules", ...existingNodeOptions]
  .filter(Boolean)
  .join(" ");

const scriptDir = dirname(fileURLToPath(import.meta.url));
const jestBinCandidates = [
  resolve(scriptDir, "../node_modules/.bin/jest"),
  resolve(scriptDir, "../node_modules/.bin/jest.cmd"),
  resolve(scriptDir, "../node_modules/jest/bin/jest.cjs"),
  resolve(scriptDir, "../node_modules/jest/bin/jest.js"),
  resolve(scriptDir, "../node_modules/jest-cli/bin/jest.js"),
];

let jestBin;
for (const candidate of jestBinCandidates) {
  if (existsSync(candidate)) {
    jestBin = candidate;
    break;
  }
}

if (!jestBin) {
  console.error("Unable to locate jest executable. Tried:", jestBinCandidates.join(", "));
  process.exit(1);
}

const isCmd = process.platform === "win32" && jestBin.toLowerCase().endsWith(".cmd");
const spawnOptions = {
  stdio: "inherit",
  env: process.env,
};

const result = isCmd
  ? spawnSync(jestBin, sanitizedArgs, { ...spawnOptions, shell: true })
  : spawnSync(jestBin, sanitizedArgs, spawnOptions);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);

