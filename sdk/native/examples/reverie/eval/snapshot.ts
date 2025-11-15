import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { loadReasoningSlices } from "./dataset";

type CliOptions = {
  codexHome?: string;
  limit: number;
  chunkSize: number;
  chunkOverlap: number;
  outputDir: string;
};

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), "sdk/native/examples/reverie/eval/data");

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const codexHome = options.codexHome ?? resolveCodexHome();

  console.log(`Extracting slices from ${codexHome}`);
  console.log(`Output directory => ${options.outputDir}`);

  const slices = await loadReasoningSlices({
    codexHome,
    maxSlices: options.limit,
    conversationLimit: options.limit * 2,
    chunkSize: options.chunkSize,
    chunkOverlap: options.chunkOverlap,
  });

  if (slices.length === 0) {
    console.log("No slices generated – check CODEX_HOME contents.");
    return;
  }

  await fs.mkdir(options.outputDir, { recursive: true });

  const slicesPath = path.join(options.outputDir, "slices.json");
  const userPath = path.join(options.outputDir, "user_messages.json");
  const assistantPath = path.join(options.outputDir, "assistant_responses.json");

  await fs.writeFile(slicesPath, JSON.stringify(sanitizeSlices(slices), null, 2), "utf8");
  await fs.writeFile(userPath, JSON.stringify(collectUnique(slices.map((slice) => slice.userMessage)), null, 2), "utf8");
  await fs.writeFile(
    assistantPath,
    JSON.stringify(collectUnique(slices.map((slice) => slice.assistantResponse)), null, 2),
    "utf8",
  );

  console.log(`Wrote ${slices.length} slices.`);
  console.log(`User prompts => ${userPath}`);
  console.log(`Assistant responses => ${assistantPath}`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: 20,
    chunkSize: 8,
    chunkOverlap: 3,
    outputDir: DEFAULT_OUTPUT_DIR,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    const [key, rawValue] = arg.split("=");
    const value = rawValue ?? "";
    switch (key) {
      case "--codex-home":
        options.codexHome = value ? path.resolve(value) : undefined;
        break;
      case "--limit":
        options.limit = Number(value) || options.limit;
        break;
      case "--chunk-size":
        options.chunkSize = Number(value) || options.chunkSize;
        break;
      case "--chunk-overlap":
        options.chunkOverlap = Number(value) || options.chunkOverlap;
        break;
      case "--output":
        options.outputDir = value ? path.resolve(value) : options.outputDir;
        break;
      default:
        console.warn(`Unknown flag ${arg}`);
    }
  }

  return options;
}

function printUsage(): void {
  console.log(`Usage: npx tsx sdk/native/examples/reverie/eval/snapshot.ts [options]
  --codex-home=<path>    Override CODEX_HOME directory
  --limit=<n>            Number of slices to extract (default 20)
  --chunk-size=<n>       Events per chunk (default 8)
  --chunk-overlap=<n>    Overlap between chunks (default 3)
  --output=<path>        Destination directory for JSON files`);
}

function collectUnique(values: Array<string | undefined>): string[] {
  const unique = new Set(values.filter((value): value is string => Boolean(value?.trim())));
  return Array.from(unique);
}

function sanitizeSlices(slices: Awaited<ReturnType<typeof loadReasoningSlices>>): unknown {
  return slices.map((slice) => ({
    id: slice.id,
    conversationId: slice.conversationId,
    reasoningText: slice.reasoningText,
    userMessage: slice.userMessage,
    assistantResponse: slice.assistantResponse,
    reasoningSource: slice.reasoningSource,
    chunkIndex: slice.chunkIndex,
    chunkSize: slice.chunkSize,
    previewToon: slice.previewToon,
  }));
}

function resolveCodexHome(): string {
  if (process.env.CODEX_HOME) {
    return path.resolve(process.env.CODEX_HOME);
  }
  const home = process.env.HOME || process.cwd();
  return path.join(home, ".codex");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

