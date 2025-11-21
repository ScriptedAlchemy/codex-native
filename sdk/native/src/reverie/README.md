# Reverie Module

Comprehensive reverie system for searching and filtering conversation history. This module preserves **ALL** sophisticated features from diff-agent while being fully generic and reusable.

## Features

### Core Capabilities

1. **Quality Filtering** - Comprehensive boilerplate detection
   - System prompts and instructions
   - XML/HTML tags and structured data
   - JSON objects and tool outputs
   - Percentage indicators and metadata
   - Generic phrases and thinking markers

2. **Smart Deduplication** - Preserves highest-relevance duplicates
   - **FIXED BUG**: Now keeps the insight with highest relevance score
   - Fingerprint-based similarity detection (first 100 chars)
   - Automatic sorting by relevance

3. **LLM Relevance Grading** - Strict technical detail filter
   - Only grades high-scoring candidates (≥0.7) for cost optimization
   - Parallel grading for performance
   - Rejects boilerplate and generic content
   - Approves only specific technical details

4. **Symbol Extraction** - Focuses search on code symbols
   - Extracts functions, classes, variables
   - Filters out keywords and short symbols
   - Returns top 5 symbols for targeted searches

5. **Advanced Semantic Search** - Multi-stage filtering
   - 3x candidate multiplier for aggressive filtering
   - Optional reranker support for precision
   - Quality filtering and deduplication
   - Transparent statistics logging

6. **Complete Pipeline** - Orchestrates entire process
   - Search → Quality Filter → Score Split → LLM Grade → Deduplicate
   - Logging at every stage
   - File-specific pipeline optimization
   - Configurable options at each stage

7. **Multi-Level Search** - Three-tier search hierarchy
   - **Project level**: Repository-wide patterns and architecture
   - **Branch level**: Feature-specific work and branch context
   - **File level**: Individual file changes with symbol extraction
   - Context builders for structured queries
   - Optimized candidate counts per level

## Module Structure

```
reverie/
├── constants.ts             # Configuration constants
├── types.ts                 # TypeScript type definitions
├── context.ts               # Multi-level context builders (NEW)
├── quality.ts               # Quality filtering and deduplication
├── logger.ts                # Transparent logging utilities
├── symbols.ts               # Code symbol extraction
├── search.ts                # Advanced semantic search
├── grader.ts                # LLM-based relevance grading
├── pipeline.ts              # Complete orchestration pipeline + multi-level
├── index.ts                 # Barrel exports with examples
├── README.md                # This file
├── EXAMPLES.md              # Detailed usage examples
└── MULTI_LEVEL_EXAMPLES.md  # Multi-level search examples (NEW)
```

## Constants

From `/Volumes/sandisk/codex/sdk/native/src/reverie/constants.ts`:

```typescript
DEFAULT_REVERIE_LIMIT = 6              // Final results to return
DEFAULT_REVERIE_MAX_CANDIDATES = 80    // Initial candidates to fetch
REVERIE_EMBED_MODEL = "BAAI/bge-large-en-v1.5"
REVERIE_RERANKER_MODEL = "rozgo/bge-reranker-v2-m3"
REVERIE_CANDIDATE_MULTIPLIER = 3       // Fetch 3x for filtering
REVERIE_LLM_GRADE_THRESHOLD = 0.7      // Min score for LLM grading
DEFAULT_RERANKER_TOP_K = 20
DEFAULT_RERANKER_BATCH_SIZE = 8
```

## Usage Examples

### Basic Quality Filtering

```typescript
import { isValidReverieExcerpt, deduplicateReverieInsights } from '@codex-native/sdk/reverie';

const insights = [
  { excerpt: "Let's refactor auth...", relevance: 0.9, ... },
  { excerpt: "<INSTRUCTIONS>...", relevance: 0.8, ... },      // Filtered
  { excerpt: "Let's refactor auth module", relevance: 0.85, ... }  // Duplicate
];

// Filter out system prompts
const valid = insights.filter(i => isValidReverieExcerpt(i.excerpt));

// Deduplicate, keeping highest relevance (0.9)
const unique = deduplicateReverieInsights(valid);
```

### Advanced Search with Reranking

```typescript
import { searchReveries } from '@codex-native/sdk/reverie';

const insights = await searchReveries(
  "/Users/me/.codex",
  "authentication bug with JWT tokens",
  "/Users/me/my-project",
  {
    limit: 6,
    useReranker: true,
    candidateMultiplier: 3  // Fetch 3x for aggressive filtering
  }
);

console.log(`Found ${insights.length} relevant insights`);
```

### Complete Pipeline with LLM Grading

```typescript
import { applyReveriePipeline } from '@codex-native/sdk/reverie';

const result = await applyReveriePipeline(
  codexHome,
  "Fix authentication token validation",
  repo,
  runner,  // Agent runner for LLM grading
  {
    limit: 6,
    useReranker: true,
    minRelevanceForGrading: 0.7,
    parallel: true
  }
);

console.log(`Pipeline: ${result.stats.total} → ${result.stats.final}`);
console.log(`LLM approved: ${result.stats.afterLLMGrade}/${result.stats.afterScore}`);

// Access filtered insights
result.insights.forEach(insight => {
  console.log(`[${insight.relevance.toFixed(2)}] ${insight.excerpt.slice(0, 100)}`);
});
```

### Symbol Extraction for Focused Searches

```typescript
import { extractKeySymbols } from '@codex-native/sdk/reverie';

const diff = `
+function validateToken(token: string) {
+  const decoded = jwt.verify(token, SECRET);
+  return decoded;
+}
`;

const symbols = extractKeySymbols(diff);
// Returns: "validateToken, decoded"

// Use in search query
const query = `File: src/auth/jwt.ts\nImplementing: ${symbols}`;
const insights = await searchReveries(codexHome, query, repo);
```

### File-Specific Pipeline

```typescript
import { applyFileReveriePipeline, extractKeySymbols } from '@codex-native/sdk/reverie';

const filePath = "src/auth/jwt.ts";
const diff = "... git diff content ...";
const symbols = extractKeySymbols(diff);
const context = `File: ${filePath}\nImplementing: ${symbols}`;

const result = await applyFileReveriePipeline(
  codexHome,
  filePath,
  context,
  repo,
  runner,
  { limit: 3 }
);

console.log(`Found ${result.insights.length} file-specific insights`);
```

### Skip LLM Grading (Faster, Lower Quality)

```typescript
const result = await applyReveriePipeline(
  codexHome,
  query,
  repo,
  null,  // No runner needed
  {
    skipLLMGrading: true,
    limit: 6
  }
);
```

### Multi-Level Search (NEW)

Search at multiple levels in a single operation:

```typescript
import {
  buildProjectContext,
  buildBranchContext,
  buildFileContext,
  searchMultiLevel,
} from '@codex-native/sdk/reverie';

// Build contexts for each level
const contexts = [
  // Project: Repository-wide patterns
  buildProjectContext(
    "Authentication patterns in this repository",
    { repoPath: repo }
  ),

  // Branch: Feature-specific work
  buildBranchContext(
    "feat/oauth2",
    ["src/auth/oauth.ts", "src/auth/tokens.ts"],
    {
      baseBranch: "main",
      recentCommits: "Add OAuth2 support",
      repoPath: repo
    }
  ),

  // File: Specific file changes
  buildFileContext(
    "src/auth/oauth.ts",
    {
      diff: "... git diff ...",
      extractSymbols: true,  // Auto-extract function names
      repoPath: repo
    }
  )
];

// Execute multi-level search
const results = await searchMultiLevel(
  codexHome,
  contexts,
  runner,
  { limit: 5, useReranker: true }
);

// Access results by level
const projectInsights = results.get('project')?.insights || [];
const branchInsights = results.get('branch')?.insights || [];
const fileInsights = results.get('file')?.insights || [];

console.log(`Project: ${projectInsights.length} insights`);
console.log(`Branch: ${branchInsights.length} insights`);
console.log(`File: ${fileInsights.length} insights`);
```

Or search at individual levels:

```typescript
import {
  searchProjectLevel,
  searchBranchLevel,
  searchFileLevel,
} from '@codex-native/sdk/reverie';

// Project-level search (1.5x candidates for broader coverage)
const projectResult = await searchProjectLevel(
  codexHome,
  buildProjectContext("Testing conventions", { repoPath: repo }),
  runner,
  { limit: 8 }
);

// Branch-level search (standard candidates)
const branchResult = await searchBranchLevel(
  codexHome,
  buildBranchContext("feat/auth", changedFiles, { repoPath: repo }),
  runner,
  { limit: 6 }
);

// File-level search (0.5x candidates for focused results)
const fileResult = await searchFileLevel(
  codexHome,
  buildFileContext("src/auth.ts", { diff, repoPath: repo }),
  runner,
  { limit: 3 }
);
```

See `MULTI_LEVEL_EXAMPLES.md` for comprehensive examples.

## Pipeline Architecture

### Main Pipeline (`applyReveriePipeline`)

```
Input: Search Query + Repo
   ↓
1. Search (3x candidates with reranking)
   ↓
2. Quality Filter (remove boilerplate)
   ↓
3. Score Split (≥0.7 vs <0.7)
   ↓
4. LLM Grade (only high-scoring, parallel)
   ↓
5. Deduplicate (keep highest relevance)
   ↓
6. Limit to top N
   ↓
Output: Filtered Insights + Statistics
```

### File Pipeline (`applyFileReveriePipeline`)

Same as main pipeline but:
- Uses fewer candidates (maxCandidates / 2)
- Optimized for single file context
- Symbol extraction recommended for context

### Multi-Level Pipeline (`searchMultiLevel`)

Orchestrates searches at multiple levels:
```
Input: Array of ReverieContext (project/branch/file)
   ↓
For each context:
  1. Determine level (project/branch/file)
  2. Apply level-specific optimizations:
     - Project: 1.5x candidates (broader search)
     - Branch: 1x candidates (standard)
     - File: 0.5x candidates (focused)
  3. Run standard pipeline
  4. Log level results
   ↓
Output: Map<Level, Results> + Statistics
```

Level-specific functions:
- `searchProjectLevel()` - Repository-wide patterns
- `searchBranchLevel()` - Feature/branch context
- `searchFileLevel()` - Individual file changes

## Key Optimizations from diff-agent

1. **3x Candidate Multiplier** (lines 560-561)
   - Fetches 3x more candidates than needed
   - Provides headroom for aggressive filtering
   - Ensures quality results even with heavy filtering

2. **LLM Grading Threshold** (lines 438-443)
   - Only grades candidates with relevance ≥ 0.7
   - Saves API costs by skipping obvious low-quality
   - Parallel grading for performance

3. **Quality Filtering** (lines 115-178)
   - Comprehensive boilerplate pattern matching
   - Rejects ANY match (strict filtering)
   - JSON detection, tag counting, percentage indicators

4. **Deduplication Fix** (lines 594-609)
   - **BUG FIX**: Now keeps highest relevance, not first occurrence
   - Fingerprint-based (first 100 chars)
   - Sorts by relevance automatically

5. **Transparent Logging** (lines 432-467, 470-507)
   - Shows search context
   - Shows filtering stats at each stage
   - Shows approved excerpts with previews
   - Shows approved/rejected counts

## Types

```typescript
interface ReverieInsight {
  conversationId: string;
  timestamp: string;
  relevance: number;
  excerpt: string;
  insights: string[];
}

interface ReverieSearchOptions {
  limit?: number;
  maxCandidates?: number;
  useReranker?: boolean;
  rerankerModel?: string;
  rerankerTopK?: number;
  rerankerBatchSize?: number;
  candidateMultiplier?: number;
}

interface GradingOptions {
  minRelevanceForGrading?: number;
  parallel?: boolean;
}

interface ReveriePipelineOptions extends ReverieSearchOptions, GradingOptions {
  skipLLMGrading?: boolean;
}

interface ReverieFilterStats {
  total: number;
  afterQuality: number;
  afterScore: number;
  afterDedup: number;
  afterLLMGrade?: number;
  final: number;
}

interface ReveriePipelineResult {
  insights: ReverieInsight[];
  stats: ReverieFilterStats;
}

interface AgentRunner {
  run(
    agent: { name: string; instructions: string },
    prompt: string
  ): Promise<{ finalOutput?: unknown }>;
}

// Multi-Level Search Types (NEW)
type ReverieSearchLevel = 'project' | 'branch' | 'file';

interface ProjectLevelContext {
  level: 'project';
  repoPath: string;
  query: string;
  filePatterns?: string[];
}

interface BranchLevelContext {
  level: 'branch';
  repoPath: string;
  branch: string;
  baseBranch?: string;
  changedFiles: string[];
  recentCommits?: string;
}

interface FileLevelContext {
  level: 'file';
  repoPath: string;
  filePath: string;
  diff?: string;
  symbols?: string[];
}

type ReverieContext = ProjectLevelContext | BranchLevelContext | FileLevelContext;
```

## Integration with diff-agent

This module is a **drop-in replacement** for diff-agent's reverie logic:

```typescript
// diff-agent pattern (lines 421-514)
const branchInsights = await searchReveries(branchContext, context.repoPath);
const basicFiltered = branchInsights.filter(match => isValidReverieExcerpt(match.excerpt));
const highScoring = basicFiltered.filter(match => match.relevance >= 0.7);
const gradedResults = await Promise.all(gradingPromises);
const validBranchInsights = gradedResults.filter(r => r.isRelevant).map(r => r.insight);

// Equivalent using reverie module
const result = await applyReveriePipeline(
  codexHome,
  branchContext,
  context.repoPath,
  runner,
  { limit: DEFAULT_REVERIE_LIMIT }
);
const validBranchInsights = result.insights;
```

## Comparison with diff-agent

| Feature | diff-agent | reverie module |
|---------|-----------|----------------|
| Quality filtering | ✅ Lines 115-178 | ✅ `quality.ts` |
| Deduplication bug fix | ❌ Keeps first | ✅ Keeps highest relevance |
| LLM grading | ✅ Lines 392-419 | ✅ `grader.ts` |
| Symbol extraction | ✅ Lines 520-541 | ✅ `symbols.ts` |
| Advanced search | ✅ Lines 543-589 | ✅ `search.ts` |
| Transparent logging | ✅ Lines 432-507 | ✅ `logger.ts` |
| Complete pipeline | ✅ Inline | ✅ `pipeline.ts` |
| Reusability | ❌ Tightly coupled | ✅ Generic/modular |
| TypeScript strict | ❌ Implicit types | ✅ Full types |
| Documentation | ❌ Comments only | ✅ JSDoc + examples |

## File Sizes

```
constants.ts  - 55 lines   - Configuration constants
types.ts      - 89 lines   - TypeScript type definitions
symbols.ts    - 62 lines   - Code symbol extraction
quality.ts    - 231 lines  - Quality filtering and deduplication
logger.ts     - 153 lines  - Transparent logging utilities
grader.ts     - 165 lines  - LLM-based relevance grading
search.ts     - 139 lines  - Advanced semantic search
pipeline.ts   - 242 lines  - Complete orchestration pipeline
index.ts      - 213 lines  - Barrel exports with examples
─────────────────────────
TOTAL:        1,349 lines
```

## Testing

```typescript
// Test quality filtering
const testExcerpts = [
  "Implement auth with JWT",        // Valid
  "<INSTRUCTIONS>...",              // Invalid
  "{ \"file\": \"test.ts\" }",      // Invalid
  "## Thinking about...",           // Invalid
];

testExcerpts.forEach(excerpt => {
  console.log(`"${excerpt}" → ${isValidReverieExcerpt(excerpt)}`);
});

// Test deduplication with relevance preservation
const testInsights = [
  { excerpt: "We refactored auth", relevance: 0.7, ... },
  { excerpt: "We refactored auth module", relevance: 0.9, ... },  // Duplicate, higher score
];

const deduped = deduplicateReverieInsights(testInsights);
console.log(deduped[0].relevance); // Should be 0.9
```

## Migration from diff-agent

Replace diff-agent's inline reverie logic with:

```typescript
// Before (diff-agent style)
const insights = await searchReveries(text, repo);
const validInsights = insights.filter(match => isValidReverieExcerpt(match.excerpt));
const highScoring = validInsights.filter(match => match.relevance >= 0.7);
const gradingPromises = highScoring.map(insight =>
  gradeReverieRelevance(runner, context, insight)
    .then(isRelevant => ({ insight, isRelevant }))
);
const gradedResults = await Promise.all(gradingPromises);
const approved = gradedResults.filter(r => r.isRelevant).map(r => r.insight);

// After (reverie module)
const result = await applyReveriePipeline(codexHome, text, repo, runner);
const approved = result.insights;
```

## Credits

This module preserves ALL features from `/Volumes/sandisk/codex/diff-agent/src/index.ts`:
- Constants (lines 81-84)
- Quality filtering (lines 115-178)
- Deduplication with bug fix (lines 594-609)
- LLM grading (lines 392-419)
- Symbol extraction (lines 520-541)
- Advanced search (lines 543-589)
- Transparent logging (lines 432-467, 470-507)

**Key improvement**: Fixed deduplication bug to keep highest relevance instead of first occurrence.
