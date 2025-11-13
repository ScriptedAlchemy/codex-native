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
  location: z.string().max(200).optional().default(""),
  example: z.string().max(400).optional().default(""),
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
  owner: z.string().optional(),
  autoFixable: z.boolean().default(false),
});
export type CiIssue = z.output<typeof CiIssueSchema>;
const CiIssueListSchema = z.array(CiIssueSchema).min(1).max(12);

const CiFixSchema = z.object({
  title: z.string().min(5).max(160),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  steps: z.array(z.string()).default([]),
  owner: z.string().optional(),
  etaHours: z.number().min(0).max(40).optional(),
  commands: z.array(z.string()).default([]),
});
export type CiFix = z.output<typeof CiFixSchema>;
const CiFixListSchema = z.array(CiFixSchema).min(1).max(15);

const IntentionResponseSchema = z.object({ items: IntentionListSchema });
const RecommendationResponseSchema = z.object({ items: RecommendationListSchema });
const CiIssueResponseSchema = z.object({ items: CiIssueListSchema });
const CiFixResponseSchema = z.object({ items: CiFixListSchema });

type JsonSchemaProperties = Record<string, any>;

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

function optionalStringField(max?: number) {
  return stringField(undefined, max);
}

function stringArrayField() {
  return { type: "array" as const, items: { type: "string" as const } };
}

function buildResponseSchema(
  properties: JsonSchemaProperties,
  required: string[],
  options?: { maxItems?: number },
): JsonSchemaDefinition["schema"] {
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
          properties,
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
    ["category", "title", "summary", "impactScope"],
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
      location: optionalStringField(200),
      example: optionalStringField(400),
    },
    ["category", "title", "priority", "effort", "description"],
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
      owner: optionalStringField(),
      autoFixable: { type: "boolean" },
    },
    ["severity", "title", "summary"],
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
      owner: optionalStringField(),
      etaHours: { type: "number", minimum: 0, maximum: 40 },
      commands: stringArrayField(),
    },
    ["title", "priority"],
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
