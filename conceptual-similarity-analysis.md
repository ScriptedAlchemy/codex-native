# Conceptual Similarity Analysis

## Current Approach

### How Reverie Search Works Now

The search pipeline has **two distinct phases**:

#### Phase 1: Document Construction (Keyword-Based)
**File**: `reverie.rs:573` - `build_compact_document()`

```rust
// Score messages by query relevance BEFORE embedding
let score = if let Some(q) = query {
  score_query_relevance(&text, q)  // Uses keywords, stemming, n-grams
} else {
  score_message_importance(&text)   // Structural heuristics only
};

// Sort by score and take top 50 messages
scored_messages.sort_by(|a, b| b.1.cmp(&a.1));
message_chunks = scored_messages.take(MAX_MESSAGES).collect();
```

**Purpose**: Select the most relevant messages from each conversation to include in the embedding

#### Phase 2: Semantic Ranking (Embedding-Based)
**File**: `reverie.rs:276` - `reverie_search_semantic()`

```rust
// Compute cosine similarity between query and document embeddings
let score = cosine_similarity(query_embedding, embedding);

// Sort by embedding similarity ONLY
matches.sort_by(|a, b| b.result.relevance_score.partial_cmp(...));
```

**Purpose**: Rank conversations by semantic similarity using BAAI/bge-large-en-v1.5 embeddings

#### Phase 3: Optional Reranking (Cross-Encoder)
**File**: `reverie.rs:363` - `maybe_rerank_matches()`

```rust
// Optional: Apply reranker model if configured
if let Some(config) = build_reranker_config(opts) {
  let reranked = fast_embed_rerank_documents(config, query, documents).await?;
  // Update scores with reranker results
}
```

**Purpose**: Refine ranking with more powerful cross-encoder model

## The Problem: Conceptual Similarity Gaps

### Issue 1: Keyword-Based Document Construction
**Problem**: If a conceptually similar conversation doesn't share keywords with the query, its messages get low scores during document construction.

**Example**:
- Query: "fix webpack compilation errors"
- Conceptually similar conversation about "build pipeline issues with bundler failures"
- No keyword overlap → low score → poor message selection → weak embedding

**Impact**: The embedding only captures partial conversation context

### Issue 2: Pure Cosine Similarity Ranking
**Problem**: Cosine similarity on single embedding vector loses nuance

**Example**:
- Query: "why is the API slow?"
- Conceptually similar: "investigating performance bottlenecks in backend"
- Different vocabulary → different embedding region → low similarity score

**Impact**: Conceptually related but differently worded conversations rank low

### Issue 3: No Hybrid Scoring
**Problem**: Final ranking uses ONLY embedding similarity, ignoring keyword signals entirely

**Current**:
```rust
let score = cosine_similarity(query_embedding, embedding);  // Only semantic
```

**Missing**: Combined signal from both keyword relevance and semantic similarity

### Issue 4: Single Embedding Per Conversation
**Problem**: Each conversation compressed into one 1024-dim vector loses detail

**Example**:
- Long conversation about "fixing build errors" (early) AND "optimizing performance" (late)
- Query: "optimize API response time"
- Single embedding averages both topics → diluted similarity

**Impact**: Multi-topic conversations poorly matched

## Improvements for Better Conceptual Similarity

### 1. Query Expansion (Pre-Processing)
**Add conceptual synonyms and related terms**

```rust
fn expand_query(query: &str) -> Vec<String> {
  let mut expanded = vec![query.to_string()];

  // Technical synonyms
  if query.contains("slow") || query.contains("performance") {
    expanded.push("latency optimization bottleneck".to_string());
  }
  if query.contains("error") || query.contains("fail") {
    expanded.push("exception bug crash issue problem".to_string());
  }
  if query.contains("build") || query.contains("compile") {
    expanded.push("bundler transpile build-time compilation".to_string());
  }

  expanded
}
```

**Benefit**: Find conversations with different vocabulary but same concept

### 2. Multi-Vector Embeddings (Chunked)
**Embed multiple chunks per conversation, keep best match**

```rust
async fn embed_conversation_chunks(
  conversation: &ReverieConversation,
  chunk_size: usize,
) -> Vec<Vec<f32>> {
  let segments = load_segments(&conversation.path);
  let chunks: Vec<String> = segments
    .chunks(chunk_size)
    .map(|group| group.join("\n\n"))
    .collect();

  // Embed each chunk separately
  fast_embed_embed(chunks).await
}

fn max_similarity_score(
  query_embedding: &[f32],
  chunk_embeddings: &[Vec<f32>],
) -> f64 {
  chunk_embeddings
    .iter()
    .map(|chunk_emb| cosine_similarity(query_embedding, chunk_emb))
    .max()
    .unwrap_or(0.0)
}
```

**Benefit**: Long multi-topic conversations don't get diluted

### 3. Hybrid Scoring (Combine Signals)
**Blend keyword and semantic scores**

```rust
fn hybrid_score(
  embedding_score: f64,
  keyword_score: usize,
  query: &str,
  doc_text: &str,
) -> f64 {
  // Normalize keyword score to 0-1 range
  let max_keyword_score = query.split_whitespace().count() * 200;
  let norm_keyword = (keyword_score as f64) / (max_keyword_score as f64).max(1.0);

  // Weighted combination
  let semantic_weight = 0.7;  // Favor semantic similarity
  let keyword_weight = 0.3;   // But consider keyword matches

  (semantic_weight * embedding_score) + (keyword_weight * norm_keyword)
}
```

**Benefit**: Catches both semantic and lexical similarity

### 4. Enable Reranker by Default
**Use cross-encoder for better precision**

```typescript
// In search options
const results = await reverieSearchSemantic(codexHome, query, {
  limit: 10,
  maxCandidates: 50,
  rerankerModel: "BAAI/bge-reranker-base",  // Add by default
  rerankerTopK: 10,
});
```

**Benefit**: Cross-encoders better capture query-document interaction

### 5. Concept-Based Boosting
**Identify conceptual categories and boost matches**

```rust
fn detect_query_concept(query: &str) -> Vec<&'static str> {
  let mut concepts = Vec::new();

  let lower = query.to_lowercase();

  if lower.contains("slow") || lower.contains("performance") || lower.contains("latency") {
    concepts.push("performance");
  }
  if lower.contains("error") || lower.contains("fail") || lower.contains("crash") {
    concepts.push("debugging");
  }
  if lower.contains("build") || lower.contains("compile") || lower.contains("bundler") {
    concepts.push("build-system");
  }
  if lower.contains("test") || lower.contains("ci") || lower.contains("failing") {
    concepts.push("testing");
  }

  concepts
}

fn boost_concept_matches(
  score: f64,
  doc_text: &str,
  query_concepts: &[&str],
) -> f64 {
  let mut boost = 1.0;

  for concept in query_concepts {
    let concept_terms = match *concept {
      "performance" => vec!["slow", "fast", "optimize", "latency", "speed", "bottleneck"],
      "debugging" => vec!["error", "bug", "crash", "fail", "exception", "issue"],
      "build-system" => vec!["build", "compile", "bundler", "webpack", "transpile"],
      "testing" => vec!["test", "ci", "spec", "assertion", "failing"],
      _ => vec![],
    };

    let doc_lower = doc_text.to_lowercase();
    let match_count = concept_terms.iter()
      .filter(|term| doc_lower.contains(*term))
      .count();

    if match_count > 0 {
      boost += 0.15 * (match_count as f64).min(3.0);  // Cap boost per concept
    }
  }

  score * boost
}
```

**Benefit**: Conceptually related terms boost similarity even without exact matches

## Recommended Implementation Priority

### High Priority (Immediate)
1. **Enable reranker by default** - Quick win, no code changes needed
2. **Query expansion for common concepts** - Small change, big impact
3. **Hybrid scoring** - Combine keyword + semantic signals

### Medium Priority (Near-term)
4. **Concept-based boosting** - Catch related vocabulary
5. **Multi-vector embeddings** - Better for long conversations

### Low Priority (Future)
6. **LLM-based query expansion** - Most powerful but slower/costly
7. **Fine-tuned embedding model** - Domain-specific improvements

## Testing Conceptual Similarity

### Test Cases to Add

```typescript
const conceptualTests = [
  {
    query: "API is slow, high latency",
    expectedConcepts: ["performance bottleneck", "optimize response time", "reduce server overhead"],
    unexpectedTerms: ["slow", "API"],  // Should match even without exact terms
  },
  {
    query: "webpack build failing",
    expectedConcepts: ["bundler errors", "compilation issues", "build pipeline broken"],
    unexpectedTerms: ["webpack"],
  },
  {
    query: "fix authentication bug",
    expectedConcepts: ["login not working", "auth flow broken", "credential issues"],
    unexpectedTerms: ["authentication", "bug"],
  },
];
```

## Current Status

✅ **Semantic embeddings working** (BAAI/bge-large-en-v1.5)
✅ **Keyword scoring for document construction**
✅ **Optional reranker support**
❌ **No query expansion**
❌ **No hybrid scoring**
❌ **No multi-vector embeddings**
❌ **No concept-based boosting**
❌ **Reranker not enabled by default**

## Conclusion

The current system uses **pure semantic similarity** for final ranking, which is good for conceptual matching. However:

1. **Document construction** filters too aggressively based on keywords
2. **Single embedding per conversation** loses nuance in multi-topic discussions
3. **No hybrid scoring** misses cases where keyword + semantic together would rank higher
4. **Reranker disabled** by default, missing precision improvements

**Quick Win**: Enable reranker by default and add query expansion for common technical concepts.
