import { describe, it, beforeAll, expect } from "@jest/globals";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

import { setupNativeBinding } from "./testHelpers";

setupNativeBinding();

const LONG_TIMEOUT_MS = 120_000;

describe("FastEmbed integration", () => {
  let fastEmbedInit: typeof import("../src/index").fastEmbedInit;
  let fastEmbedEmbed: typeof import("../src/index").fastEmbedEmbed;

  beforeAll(async () => {
    ({ fastEmbedInit, fastEmbedEmbed } = await import("../src/index"));
  });

  it(
    "initializes the small model and returns normalized embeddings",
    async () => {
      const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-fastembed-home-"));
      process.env.CODEX_HOME = codexHome;
      const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-fastembed-cache-"));

      await fastEmbedInit({
        model: "BAAI/bge-small-en-v1.5",
        cacheDir,
        maxLength: 512,
        showDownloadProgress: false,
      });

      const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-fastembed-project-"));
      const inputs = [
        "passage: thread fork channel fixes",
        "query: diagnose channel closure",
      ];

      const embeddings = await fastEmbedEmbed({
        inputs,
        projectRoot,
        normalize: true,
        cache: true,
      });

      expect(embeddings).toHaveLength(inputs.length);
      embeddings.forEach((vector) => {
        expect(vector.length).toBeGreaterThan(0);
        const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
        expect(Math.abs(norm - 1)).toBeLessThan(1e-3);
      });
    },
    LONG_TIMEOUT_MS,
  );
});
