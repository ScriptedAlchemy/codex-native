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

  // OpenAI Responses-style wrapper:
  // { type: "json_schema", json_schema: { name, schema, strict } }
  if (
    isJsonObject(schema) &&
    (schema.type === "json_schema" || schema.type === "json-schema") &&
    isJsonObject(schema.json_schema) &&
    isJsonObject(schema.json_schema.schema)
  ) {
    const strict =
      typeof schema.json_schema.strict === "boolean" ? schema.json_schema.strict : true;
    return normalizeJsonSchemaObject(schema.json_schema.schema, strict);
  }

  // Lenient wrapper we also accept:
  // { schema, strict?, name? }
  if (isJsonObject(schema) && isJsonObject(schema.schema)) {
    const strict = typeof schema.strict === "boolean" ? schema.strict : true;
    return normalizeJsonSchemaObject(schema.schema, strict);
  }

  // Back-compat: plain JSON schema object
  if (!isJsonObject(schema)) {
    throw new Error(
      "outputSchema must be a plain JSON object or an OpenAI-style json_schema wrapper",
    );
  }

  return normalizeJsonSchemaObject(schema, true);
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

function normalizeJsonSchemaObject(
  schema: Record<string, unknown>,
  strict: boolean,
): Record<string, unknown> {
  const record = { ...schema } as Record<string, unknown> & {
    additionalProperties?: unknown;
  };
  const hasExplicitAdditional =
    typeof record.additionalProperties === "boolean" ||
    typeof record.additionalProperties === "object";
  // If strict=true, default additionalProperties to false unless explicitly provided.
  // If strict=false, preserve as-is and do not force false.
  const additionalProperties =
    hasExplicitAdditional ? record.additionalProperties : strict ? false : record.additionalProperties;

  return {
    ...record,
    ...(hasExplicitAdditional || strict ? { additionalProperties } : {}),
  };
}
