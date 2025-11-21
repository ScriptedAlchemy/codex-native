/**
 * LLM-Based Relevance Grading for Reverie Insights
 *
 * Uses an LLM to evaluate whether reverie excerpts contain specific technical details
 * relevant to the current work context. This provides a more sophisticated filter than
 * simple keyword matching or relevance scores.
 *
 * Key optimizations:
 * - Only grades high-scoring candidates (relevance >= 0.7) to minimize API costs
 * - Parallel grading for performance
 * - Strict filtering to reject boilerplate and generic content
 */

import { Agent } from "@openai/agents";
import type { ReverieInsight, GradingOptions } from "./types.js";

/**
 * Minimal interface for an agent runner that can execute prompts.
 * Compatible with @openai/agents Runner and similar implementations.
 */
export interface AgentRunner {
  run(
    agent: {
      name: string;
      instructions: string | ((...args: any[]) => any);
      outputType?: unknown;
      getEnabledHandoffs?: (...args: any[]) => Promise<unknown> | unknown;
      getAllTools?: (...args: any[]) => Promise<unknown> | unknown;
    },
    prompt: string
  ): Promise<{ finalOutput?: unknown }>;
}

/**
 * JSON schema for structured reverie grading response.
 * Ensures the LLM returns a validated, type-safe result.
 */
const REVERIE_GRADING_SCHEMA = {
  type: "object" as const,
  properties: {
    is_relevant: {
      type: "boolean" as const,
      description: "True if excerpt contains specific technical details relevant to the work context",
    },
    reasoning: {
      type: "string" as const,
      description: "Brief explanation (1-2 sentences) of why the excerpt was approved or rejected",
    },
  },
  required: ["is_relevant", "reasoning"],
  additionalProperties: false,
};

/**
 * Type-safe interface for grading results.
 */
interface GradingResult {
  is_relevant: boolean;
  reasoning: string;
}

/**
 * Uses LLM to evaluate if a reverie excerpt contains specific technical details
 * relevant to the search context.
 *
 * The grader is extremely strict and only approves excerpts with:
 * - Specific code/file references
 * - Technical decisions and rationale
 * - Error messages and debugging details
 * - Implementation specifics
 *
 * It rejects:
 * - Greetings and pleasantries
 * - Thinking markers (**, ##)
 * - JSON objects and structured data
 * - Generic phrases ("Context from past work")
 * - Metadata and system information
 *
 * @param runner - Agent runner capable of executing LLM prompts
 * @param searchContext - Context describing what we're searching for
 * @param insight - Reverie insight to evaluate
 * @returns true if the excerpt contains valuable technical details, false otherwise
 *
 * @example
 * ```typescript
 * const context = "Implementing authentication with JWT tokens";
 * const insight = {
 *   excerpt: "We decided to use RS256 for JWT signing because...",
 *   relevance: 0.85,
 *   // ...
 * };
 *
 * const isRelevant = await gradeReverieRelevance(runner, context, insight);
 * // Returns: true (contains specific technical decision)
 * ```
 */
export async function gradeReverieRelevance(
  runner: AgentRunner,
  searchContext: string,
  insight: ReverieInsight
): Promise<boolean> {
  const graderAgent = new Agent({
    name: "ReverieGrader",
    instructions: `You are a STRICT filter for conversation excerpts. Only approve excerpts with SPECIFIC technical details.

REJECT excerpts containing:
- Greetings and pleasantries
- Thinking markers (**, ##, <thinking>)
- JSON objects or structured data dumps
- Generic phrases ("Context from past work", "working on this", etc.)
- Metadata and system information
- Boilerplate text
- Task or checklist instructions ("1.", "2.", "Plan:")
- AGENTS.md guidance, sandbox instructions, or environment descriptions
- Tool output summaries or command transcript blocks

APPROVE ONLY excerpts with:
- Specific code/file references (file paths, function names, variable names)
- Technical decisions and rationale
- Error messages and debugging details
- Implementation specifics and algorithms
- Architecture patterns and design choices

Return a JSON object with:
- is_relevant: boolean indicating if this excerpt should be kept
- reasoning: brief 1-2 sentence explanation of your decision`,
    outputType: {
      type: "json_schema" as const,
      schema: REVERIE_GRADING_SCHEMA,
      name: "ReverieGrading",
      strict: true,
    },
  });

  const prompt = `Context: ${searchContext}

Excerpt to grade:
"""
${insight.excerpt.slice(0, 400)}
"""

Evaluate whether this excerpt contains specific technical details relevant to the work context.`;

  const result = await runner.run(graderAgent, prompt);

  // Parse structured output
  if (result.finalOutput && typeof result.finalOutput === "object") {
    const grading = result.finalOutput as GradingResult;
    return grading.is_relevant;
  }

  // Fallback: if structured output fails, default to rejecting (conservative)
  console.warn("Reverie grading failed to return structured output, defaulting to reject");
  return false;
}

/**
 * Grades multiple reverie insights in parallel using LLM evaluation.
 *
 * Pipeline:
 * 1. Filter insights by minimum relevance threshold (default: 0.7)
 * 2. Send high-scoring insights to LLM grader in parallel
 * 3. Return only insights that pass LLM evaluation
 *
 * This approach optimizes API costs by:
 * - Skipping low-scoring candidates entirely
 * - Running high-scoring evaluations in parallel for speed
 * - Using strict filtering to minimize false positives
 *
 * @param runner - Agent runner capable of executing LLM prompts
 * @param context - Search context describing what we're looking for
 * @param insights - Array of insights to grade
 * @param options - Grading configuration options
 * @returns Filtered array containing only LLM-approved insights
 *
 * @example
 * ```typescript
 * const allInsights = await searchReveries("authentication bug", repo);
 * const approved = await gradeReveriesInParallel(
 *   runner,
 *   "Fix authentication token validation",
 *   allInsights,
 *   { minRelevanceForGrading: 0.75, parallel: true }
 * );
 *
 * console.log(`${approved.length}/${allInsights.length} insights approved`);
 * ```
 */
export async function gradeReveriesInParallel(
  runner: AgentRunner,
  context: string,
  insights: ReverieInsight[],
  options?: GradingOptions
): Promise<ReverieInsight[]> {
  const { minRelevanceForGrading = 0.7, parallel = true } = options || {};

  // Split insights by relevance threshold
  const highScoring = insights.filter((insight) => insight.relevance >= minRelevanceForGrading);
  const lowScoring = insights.filter((insight) => insight.relevance < minRelevanceForGrading);

  // Skip LLM grading for low-scoring insights (cost optimization)
  if (highScoring.length === 0) {
    return [];
  }

  // Grade high-scoring insights
  if (parallel) {
    // Parallel grading for performance
    const gradingPromises = highScoring.map((insight) =>
      gradeReverieRelevance(runner, context, insight).then((isRelevant) => ({
        insight,
        isRelevant,
      }))
    );

    const gradedResults = await Promise.all(gradingPromises);
    return gradedResults.filter((r) => r.isRelevant).map((r) => r.insight);
  } else {
    // Sequential grading (for rate-limited scenarios)
    const approved: ReverieInsight[] = [];

    for (const insight of highScoring) {
      const isRelevant = await gradeReverieRelevance(runner, context, insight);
      if (isRelevant) {
        approved.push(insight);
      }
    }

    return approved;
  }
}
