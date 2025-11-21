import { z } from "zod";
import type { JsonSchemaDefinition } from "@openai/agents-core";

const IntentionSchema = z.object({
  category: z
    .enum(["Feature", "Refactor", "BugFix", "Performance", "Security", "DevEx", "Architecture", "Testing"])
    .or(z.string())
    .describe("High-level intention category"),
  title: z.string().min(5),
  summary: z.string().min(10),
  impactScope: z.enum(["local", "module", "system"]).or(z.string()).default("module"),
  evidence: z.array(z.string()).default([]).or(z.string().transform(s => [])),
});
export type Intention = z.output<typeof IntentionSchema>;
const IntentionListSchema = z.array(IntentionSchema).min(1).max(12);

const RecommendationSchema = z.object({
  category: z.enum(["Code", "Tests", "Docs", "Tooling", "DevEx", "Observability"]).or(z.string()),
  title: z.string().min(5),
  priority: z.enum(["P0", "P1", "P2", "P3"]).or(z.string()),
  effort: z.enum(["Low", "Medium", "High"]).or(z.string()).default("Medium"),
  description: z.string().min(10),
  location: z.string().optional().or(z.literal(null)).transform((value) => value ?? ""),
  example: z.string().optional().or(z.literal(null)).transform((value) => value ?? ""),
});
export type Recommendation = z.output<typeof RecommendationSchema>;
const RecommendationListSchema = z.array(RecommendationSchema).min(1).max(10);

const CiIssueSchema = z.object({
  source: z.enum(["lint", "tests", "build", "security"]).or(z.string()),
  severity: z.enum(["P0", "P1", "P2", "P3"]).or(z.string()),
  title: z.string().min(5),
  summary: z.string().min(10),
  suggestedCommands: z.array(z.string()).default([]),
  files: z.array(z.string()).default([]),
  owner: z.string().optional().or(z.literal(null)).transform((value) => value ?? ""),
  autoFixable: z.boolean().default(false),
});
export type CiIssue = z.output<typeof CiIssueSchema>;
const CiIssueListSchema = z.array(CiIssueSchema).min(1).max(12);

const CiFixSchema = z.object({
  title: z.string().min(5),
  priority: z.enum(["P0", "P1", "P2", "P3"]).or(z.string()),
  steps: z.array(z.string()).default([]),
  commands: z.array(z.string()).default([]),
  owner: z.string().optional().or(z.literal(null)).transform((value) => value ?? ""),
});
export type CiFix = z.output<typeof CiFixSchema>;
const CiFixListSchema = z.array(CiFixSchema).min(1).max(15);

const IntentionResponseSchema = z.object({ items: IntentionListSchema });
const RecommendationResponseSchema = z.object({ items: RecommendationListSchema });
const CiIssueResponseSchema = z.object({ items: CiIssueListSchema });
const CiFixResponseSchema = z.object({ items: CiFixListSchema });

type JsonSchemaProperty = { schema: Record<string, any>; optional?: boolean };
type JsonSchemaProperties = Record<string, JsonSchemaProperty | Record<string, any>>;

function stringField(min?: number) {
  const schema: Record<string, any> = { type: "string" as const };
  if (typeof min === "number") {
    schema.minLength = min;
  }
  return schema;
}

function nullableStringWithDefault() {
  return z
    .string()
    .optional()
    .or(z.literal(null))
    .transform((value) => value ?? "");
}

function optionalStringField(bounds?: number | { min?: number }) {
  const { min } = typeof bounds === "number" ? { min: bounds } : bounds ?? {};
  const base = stringField(min);
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
      title: stringField(5),
      summary: stringField(10),
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
      title: stringField(5),
      priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
      effort: { type: "string", enum: ["Low", "Medium", "High"] },
      description: stringField(10),
      location: optionalStringField(),
      example: optionalStringField(),
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
      title: stringField(5),
      summary: stringField(10),
      suggestedCommands: stringArrayField(),
      files: stringArrayField(),
      owner: optionalStringField(),
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
      title: stringField(5),
      priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
      steps: stringArrayField(),
      commands: { schema: stringArrayField(), optional: true },
      owner: optionalStringField(),
    },
    { maxItems: 15 },
  ),
};

function normalizeStructuredOutput(obj: any): any {
  if (obj == null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(normalizeStructuredOutput);
  }

  // Comprehensive enum mappings for common LLM variations
  const enumNormalizations: Record<string, Record<string, string>> = {
    // Impact scope variations
    impactScope: {
      'system-wide': 'system',
      'System': 'system',
      'Module': 'module',
      'Local': 'local',
    },
    // Category variations (handle both Intention and Recommendation schemas)
    category: {
      'CodeQuality': 'Code',
      'Code Quality': 'Code',
      'Testing': 'Tests',
      'Test': 'Tests',
      'Documentation': 'Docs',
      'Bug Fix': 'BugFix',
      'bug-fix': 'BugFix',
    },
    // Priority variations
    priority: {
      'p0': 'P0',
      'p1': 'P1',
      'p2': 'P2',
      'p3': 'P3',
      'critical': 'P0',
      'high': 'P1',
      'medium': 'P2',
      'low': 'P3',
    },
    // Effort variations
    effort: {
      'low': 'Low',
      'medium': 'Medium',
      'high': 'High',
      'small': 'Low',
      'large': 'High',
    },
    // Severity variations
    severity: {
      'p0': 'P0',
      'p1': 'P1',
      'p2': 'P2',
      'p3': 'P3',
    },
  };

  // Fields that should be arrays
  const arrayFields = new Set(['evidence', 'suggestedCommands', 'files', 'steps', 'commands']);

  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    // Handle fields that should be arrays but came as strings or single values
    if (arrayFields.has(key)) {
      if (typeof value === 'string') {
        result[key] = value.trim() ? [value] : [];
      } else if (Array.isArray(value)) {
        result[key] = value;
      } else if (value == null) {
        result[key] = [];
      } else {
        result[key] = [value];
      }
    }
    // Handle enum normalizations
    else if (typeof value === 'string' && enumNormalizations[key]) {
      const normalized = enumNormalizations[key][value];
      result[key] = normalized ?? value; // Use original if no mapping found
    }
    // Recursively process nested objects and arrays
    else if (typeof value === 'object') {
      result[key] = normalizeStructuredOutput(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function coerceStructuredOutput<T>(value: unknown, schema: z.ZodType<T>, fallback: T): T {
  if (value == null) {
    return fallback;
  }
  try {
    let candidate = typeof value === "string" ? JSON.parse(value) : value;

    // If candidate is an array but schema expects { items: array }, wrap it
    if (Array.isArray(candidate) && !Array.isArray(fallback)) {
      candidate = { items: candidate };
    }

    // Normalize enum values and field types to match schema expectations
    candidate = normalizeStructuredOutput(candidate);

    return schema.parse(candidate);
  } catch (error) {
    // Log validation errors with details but continue with fallback
    if (error instanceof z.ZodError) {
      console.warn(
        "⚠️  Structured output validation failed:",
        error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")
      );
    } else {
      console.warn("⚠️  Failed to parse structured agent output:", error instanceof Error ? error.message : String(error));
    }
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
