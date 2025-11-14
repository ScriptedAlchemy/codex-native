import assert from "node:assert/strict";
import Ajv from "ajv";
import {
  IntentionOutputType,
  RecommendationOutputType,
  CiIssueOutputType,
  CiFixOutputType,
} from "../src/schemas.js";
import { ReverieSystem } from "../src/reverie.js";
import type { MultiAgentConfig, ReverieResult } from "../src/types.js";
import type { Thread } from "@codex-native/sdk";

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
        suggestedCommands: ["pnpm --filter multi-agent-codex-system run test"],
        files: ["src/schemas.ts"],
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
        owner: "infra",
        etaHours: 24,
        commands: ["pnpm --filter multi-agent-codex-system test"],
      },
    ],
  },
);

expectInvalid(
  "CiFixList",
  CiFixOutputType.schema,
  { items: [{ title: "Missing commands", priority: "P2", steps: ["Investigate"], owner: "ci-bot", etaHours: 6 }] },
);

await runReverieInjectionTests();

console.log("Schema + reverie tests passed ✔");

async function runReverieInjectionTests(): Promise<void> {
  const baseConfig: MultiAgentConfig = {
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
  };
  const reverieSystem = new ReverieSystem(baseConfig);

  const injectedMessages: string[] = [];
  const threadWithLog = {
    run: async (message: string) => {
      injectedMessages.push(message);
      return { items: [], finalResponse: "", usage: null };
    },
  } as unknown as Thread;

  const reveries: ReverieResult[] = [
    {
      conversationId: "conv-1",
      timestamp: new Date().toISOString(),
      relevance: 0.82,
      excerpt: "Investigated auth failures",
      insights: ["Add retry with jitter", "Surface metrics in CI"],
    },
  ];

  await reverieSystem.injectReverie(threadWithLog, reveries, "auth outage");
  assert.equal(injectedMessages.length, 1, "reverie insights should be injected once");
  assert.match(injectedMessages[0], /auth outage/);
  assert.match(injectedMessages[0], /retry with jitter/);

  let runCount = 0;
  const threadWithoutLog = {
    run: async () => {
      runCount += 1;
      return { items: [], finalResponse: "", usage: null };
    },
  } as unknown as Thread;

  await reverieSystem.injectReverie(threadWithoutLog, [], "noop query");
  assert.equal(runCount, 0, "no reveries should skip thread.run calls");
}
