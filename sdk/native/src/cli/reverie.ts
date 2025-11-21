import path from "node:path";
import os from "node:os";
import { parseArgs } from "node:util";

import { fastEmbedInit, reverieIndexSemantic, type ReverieSemanticSearchOptions } from "../nativeBinding";

const DEFAULT_MODEL = "mixedbread-ai/mxbai-embed-large-v1";

const INDEX_OPTION_DEFS = {
  "codex-home": { type: "string" } as const,
  "project-root": { type: "string" } as const,
  limit: { type: "string" } as const,
  "max-candidates": { type: "string" } as const,
  "batch-size": { type: "string" } as const,
  normalize: { type: "boolean" } as const,
  cache: { type: "boolean" } as const,
  "embed-model": { type: "string" } as const,
  "embed-cache-dir": { type: "string" } as const,
  "embed-max-length": { type: "string" } as const,
  "no-progress": { type: "boolean" } as const,
  "skip-embed-init": { type: "boolean" } as const,
};

export async function executeReverieCommand(args: string[]): Promise<void> {
  const [first, ...rest] = args;
  const isFlag = first?.startsWith("-");
  const command = !first || isFlag ? "index" : first;
  const tail = !first || isFlag ? args : rest;
  if (command !== "index") {
    throw new Error(`Unknown reverie command '${command}'. Supported subcommands: index`);
  }
  await runReverieIndex(tail);
}

async function runReverieIndex(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: INDEX_OPTION_DEFS, allowPositionals: false, strict: true });

  const codexHome = resolveCodexHome(values["codex-home"]);
  const projectRoot = resolveProjectRoot(values["project-root"]);
  const limit = parseOptionalInt(values.limit);
  const maxCandidates = parseOptionalInt(values["max-candidates"]);
  const batchSize = parseOptionalInt(values["batch-size"]);
  const embedMaxLength = parseOptionalInt(values["embed-max-length"]);
  const normalize = typeof values.normalize === "boolean" ? values.normalize : undefined;
  const cache = typeof values.cache === "boolean" ? values.cache : undefined;
  const embedModel = typeof values["embed-model"] === "string" ? values["embed-model"] : DEFAULT_MODEL;
  const embedCacheDir = typeof values["embed-cache-dir"] === "string" ? values["embed-cache-dir"] : undefined;
  const showDownloadProgress = values["no-progress"] ? false : true;
  const skipEmbedInit = values["skip-embed-init"] === true;

  if (!skipEmbedInit) {
    await fastEmbedInit({
      model: embedModel,
      cacheDir: embedCacheDir ? path.resolve(embedCacheDir) : defaultCacheDir(),
      maxLength: embedMaxLength ?? undefined,
      showDownloadProgress,
    });
  }

  const options: ReverieSemanticSearchOptions = {
    limit,
    maxCandidates,
    projectRoot,
    batchSize,
    normalize,
    cache,
  };

  console.log(`📂 Codex home: ${codexHome}`);
  console.log(`📁 Project root: ${projectRoot}`);
  const stats = await reverieIndexSemantic(codexHome, options);
  console.log(
    `✅ Indexed ${stats.documentsEmbedded} conversation(s) across ${stats.batches} batch(es); cache warmed at ${projectRoot}`,
  );
}

function resolveCodexHome(explicit?: string): string {
  if (explicit) {
    return path.resolve(explicit);
  }
  if (process.env.CODEX_HOME) {
    return process.env.CODEX_HOME;
  }
  const home = os.homedir() || process.cwd();
  return path.join(home, ".codex");
}

function resolveProjectRoot(explicit?: string): string {
  if (explicit) {
    return path.resolve(explicit);
  }
  return process.cwd();
}

function parseOptionalInt(value: unknown): number | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function defaultCacheDir(): string | undefined {
  if (process.env.CODEX_EMBED_CACHE) {
    return path.resolve(process.env.CODEX_EMBED_CACHE);
  }
  return path.join(os.tmpdir(), "codex-embed-cache");
}
