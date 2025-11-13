import assert from "node:assert/strict";
import Ajv from "ajv";
import {
  IntentionOutputType,
  RecommendationOutputType,
  CiIssueOutputType,
  CiFixOutputType,
} from "../src/schemas.js";

const ajv = new Ajv({ strict: true, allErrors: true });

function validateSchema(name: string, schema: any, sample: unknown): void {
  const validate = ajv.compile(schema);
  if (!validate(sample)) {
    throw new Error(`${name} schema rejected sample: ${ajv.errorsText(validate.errors)}`);
  }
}

function expectInvalid(name: string, schema: any, sample: unknown): void {
  const validate = ajv.compile(schema);
  const result = validate(sample);
  if (result) {
    throw new Error(`${name} schema accepted invalid sample`);
  }
}

validateSchema(
  "Intentions",
  IntentionOutputType.schema,
  {
    items: [
      {
        category: "Feature",
        title: "Add streaming logs",
        summary: "Surface agent events as they happen",
        impactScope: "module",
        evidence: ["src/pr-deep-reviewer.ts"],
      },
    ],
  },
);
expectInvalid(
  "Intentions",
  IntentionOutputType.schema,
  { items: [{ title: "Missing category", summary: "", impactScope: "module" }] },
);

validateSchema(
  "Recommendations",
  RecommendationOutputType.schema,
  {
    items: [
      {
        category: "Docs",
        title: "Document streaming",
        priority: "P2",
        effort: "Low",
        description: "Explain how to enable streaming logs",
      },
    ],
  },
);

validateSchema(
  "CiIssueList",
  CiIssueOutputType.schema,
  {
    items: [
      {
        source: "tests",
        severity: "P1",
        title: "Missing unit tests",
        summary: "Schema definitions lack coverage",
      },
    ],
  },
);

validateSchema(
  "CiFixList",
  CiFixOutputType.schema,
  {
    items: [
      {
        title: "Add schema tests",
        priority: "P1",
        steps: ["Add AJV", "Write schema.test.ts"],
        commands: ["pnpm --filter multi-agent-codex-system run test"],
      },
    ],
  },
);

console.log("Schema tests passed ✔");
