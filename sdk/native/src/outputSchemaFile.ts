import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type OutputSchemaFile = {
  schemaPath?: string;
  cleanup: () => Promise<void>;
};

export function normalizeOutputSchema(schema: unknown): Record<string, unknown> | undefined {
  if (schema === undefined) {
    return undefined;
  }

  if (!isJsonObject(schema)) {
    throw new Error("outputSchema must be a plain JSON object");
  }

  const record = { ...schema } as Record<string, unknown> & {
    additionalProperties?: unknown;
  };
  const additionalProperties =
    typeof record.additionalProperties === "boolean" ? record.additionalProperties : false;

  return {
    ...record,
    additionalProperties,
  };
}

export async function createOutputSchemaFile(schema: unknown): Promise<OutputSchemaFile> {
  const normalizedSchema = normalizeOutputSchema(schema);
  if (!normalizedSchema) {
    return { cleanup: async () => {} };
  }

  const schemaDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-output-schema-"));
  const schemaPath = path.join(schemaDir, "schema.json");
  const cleanup = async () => {
    try {
      await fs.rm(schemaDir, { recursive: true, force: true });
    } catch {
      // suppress
    }
  };

  try {
    await fs.writeFile(schemaPath, JSON.stringify(normalizedSchema), "utf8");
    return { schemaPath, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
