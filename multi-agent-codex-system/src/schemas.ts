import { z } from "zod";
import type { JsonSchemaDefinition } from "@openai/agents-core";

const IntentionSchema = z.object({
  category: z
    .enum(["Feature", "Refactor", "BugFix", "Performance", "Security", "DevEx", "Architecture", "Testing"])
    .describe("High-level intention category"),
  title: z.string().min(5).max(160),
  summary: z.string().min(10).max(800),
  impactScope: z.enum(["local", "module", "system"]).default("module"),
  evidence: z.array(z.string()).default([]),
});
export type Intention = z.output<typeof IntentionSchema>;
const IntentionListSchema = z.array(IntentionSchema).min(1).max(12);

const RecommendationSchema = z.object({
  category: z.enum(["Code", "Tests", "Docs", "Tooling", "DevEx", "Observability"]),
  title: z.string().min(5).max(160),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  effort: z.enum(["Low", "Medium", "High"]).default("Medium"),
  description: z.string().min(10).max(400),
  location: nullableStringWithDefault(200),
  example: nullableStringWithDefault(400),
});
export type Recommendation = z.output<typeof RecommendationSchema>;
const RecommendationListSchema = z.array(RecommendationSchema).min(1).max(10);

const CiIssueSchema = z.object({
  source: z.enum(["lint", "tests", "build", "security"]).or(z.string()),
  severity: z.enum(["P0", "P1", "P2", "P3"]),
  title: z.string().min(5).max(160),
  summary: z.string().min(10).max(400),
  suggestedCommands: z.array(z.string()).default([]),
  files: z.array(z.string()).default([]),
  owner: z.string().min(2).max(160).optional().or(z.literal(null)),
  autoFixable: z.boolean().default(false),
});
export type CiIssue = z.output<typeof CiIssueSchema>;
const CiIssueListSchema = z.array(CiIssueSchema).min(1).max(12);

const CiFixSchema = z.object({
  title: z.string().min(5).max(160),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  steps: z.array(z.string()).default([]),
  owner: z.string().min(2).max(160).optional().or(z.literal(null)),
  commands: z.array(z.string()).default([]),
  etaHours: z.number().min(0).max(40).optional(),
});
export type CiFix = z.output<typeof CiFixSchema>;
const CiFixListSchema = z.array(CiFixSchema).min(1).max(15);

const IntentionResponseSchema = z.object({ items: IntentionListSchema });
const RecommendationResponseSchema = z.object({ items: RecommendationListSchema });
const CiIssueResponseSchema = z.object({ items: CiIssueListSchema });
const CiFixResponseSchema = z.object({ items: CiFixListSchema });

type JsonSchemaProperty = { schema: Record<string, any>; optional?: boolean };
type JsonSchemaProperties = Record<string, JsonSchemaProperty | Record<string, any>>;

function stringField(min?: number, max?: number) {
  const schema: Record<string, any> = { type: "string" as const };
  if (typeof min === "number") {
    schema.minLength = min;
  }
  if (typeof max === "number") {
    schema.maxLength = max;
  }
  return schema;
}

function nullableStringWithDefault(max: number) {
  return z
    .string()
    .max(max)
    .optional()
    .or(z.literal(null))
    .transform((value) => value ?? "");
}

function optionalStringField(bounds?: number | { min?: number; max?: number }) {
  const { min, max } = typeof bounds === "number" ? { min: undefined, max: bounds } : bounds ?? {};
  const base = stringField(min, max);
  return { anyOf: [base, { type: "null" as const }] };
}

function stringArrayField(options?: { minItems?: number; maxItems?: number }) {
  const schema: Record<string, any> = { type: "array" as const, items: { type: "string" as const } };
  if (typeof options?.minItems === "number") {
    schema.minItems = options.minItems;
  }
  if (typeof options?.maxItems === "number") {
    schema.maxItems = options.maxItems;
  }
  return schema;
}

function buildResponseSchema(
  properties: JsonSchemaProperties,
  options?: { maxItems?: number },
): JsonSchemaDefinition["schema"] {
  const entries = Object.entries(properties).map(([key, value]) => {
    if ("schema" in value && value.schema) {
      return [key, value as JsonSchemaProperty];
    }
    return [key, { schema: value as Record<string, any> }];
  }) as [string, JsonSchemaProperty][];
  const required = entries.filter(([, value]) => !value.optional).map(([key]) => key);
  const props = Object.fromEntries(entries.map(([key, value]) => [key, value.schema]));
  return {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      items: {
        type: "array" as const,
        minItems: 1,
        ...(options?.maxItems ? { maxItems: options.maxItems } : {}),
        items: {
          type: "object" as const,
          additionalProperties: false,
          properties: props,
          required,
        },
      },
    },
    required: ["items"],
  };
}

const IntentionOutputType: JsonSchemaDefinition = {
  type: "json_schema",
  name: "Intentions",
  strict: true,
  schema: buildResponseSchema(
    {
      category: { type: "string", enum: ["Feature", "Refactor", "BugFix", "Performance", "Security", "DevEx", "Architecture", "Testing"] },
      title: stringField(5, 160),
      summary: stringField(10, 800),
      impactScope: { type: "string", enum: ["local", "module", "system"] },
      evidence: stringArrayField(),
    },
    { maxItems: 12 },
  ),
};

const RecommendationOutputType: JsonSchemaDefinition = {
  type: "json_schema",
  name: "Recommendations",
  strict: true,
  schema: buildResponseSchema(
    {
      category: { type: "string", enum: ["Code", "Tests", "Docs", "Tooling", "DevEx", "Observability"] },
      title: stringField(5, 160),
      priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
      effort: { type: "string", enum: ["Low", "Medium", "High"] },
      description: stringField(10, 400),
      location: { schema: optionalStringField(200), optional: true },
      example: { schema: optionalStringField(400), optional: true },
    },
    { maxItems: 10 },
  ),
};

const CiIssueOutputType: JsonSchemaDefinition = {
  type: "json_schema",
  name: "CiIssueList",
  strict: true,
  schema: buildResponseSchema(
    {
      source: { type: "string" },
      severity: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
      title: stringField(5, 160),
      summary: stringField(10, 400),
      suggestedCommands: stringArrayField(),
      files: stringArrayField(),
      owner: { schema: optionalStringField({ min: 2, max: 160 }), optional: true },
      autoFixable: { type: "boolean" },
    },
    { maxItems: 12 },
  ),
};

const CiFixOutputType: JsonSchemaDefinition = {
  type: "json_schema",
  name: "CiFixList",
  strict: true,
  schema: buildResponseSchema(
    {
      title: stringField(5, 160),
      priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
      steps: stringArrayField(),
      owner: { schema: optionalStringField({ min: 2, max: 160 }), optional: true },
      commands: { schema: stringArrayField(), optional: true },
      etaHours: { schema: { type: "number", minimum: 0, maximum: 40 }, optional: true },
    },
    { maxItems: 15 },
  ),
};

function coerceStructuredOutput<T>(value: unknown, schema: z.ZodType<T>, fallback: T): T {
  if (value == null) {
    return fallback;
  }
  try {
    const candidate = typeof value === "string" ? JSON.parse(value) : value;
    return schema.parse(candidate);
  } catch (error) {
    console.warn("Failed to parse structured agent output", error);
    return fallback;
  }
}

export {
  IntentionSchema,
  IntentionListSchema,
  IntentionResponseSchema,
  RecommendationSchema,
  RecommendationListSchema,
  RecommendationResponseSchema,
  CiIssueSchema,
  CiIssueListSchema,
  CiIssueResponseSchema,
  CiFixSchema,
  CiFixListSchema,
  CiFixResponseSchema,
  IntentionOutputType,
  RecommendationOutputType,
  CiIssueOutputType,
  CiFixOutputType,
  coerceStructuredOutput,
};
