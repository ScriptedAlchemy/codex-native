// Section 6: Reverie System - Conversation Search and Insights
// ============================================================================
//
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufRead, BufReader};
use chrono::{DateTime, Utc};


#[derive(Clone)]
#[napi(object)]
pub struct ReverieConversation {
  pub id: String,
  pub path: String,
  #[napi(js_name = "createdAt")]
  pub created_at: Option<String>,
  #[napi(js_name = "updatedAt")]
  pub updated_at: Option<String>,
  #[napi(js_name = "headRecords")]
  pub head_records: Vec<String>,
  #[napi(js_name = "tailRecords")]
  pub tail_records: Vec<String>,
  #[napi(js_name = "headRecordsToon")]
  pub head_records_toon: Vec<String>,
  #[napi(js_name = "tailRecordsToon")]
  pub tail_records_toon: Vec<String>,
}

#[derive(Clone)]
#[napi(object)]
pub struct ReverieSearchResult {
  pub conversation: ReverieConversation,
  #[napi(js_name = "relevanceScore")]
  pub relevance_score: f64,
  #[napi(js_name = "matchingExcerpts")]
  pub matching_excerpts: Vec<String>,
  pub insights: Vec<String>,
  #[napi(js_name = "rerankerScore")]
  pub reranker_score: Option<f64>,
}

const MAX_INSIGHTS_PER_CONVERSATION: usize = 4;
const SEMANTIC_SCORE_WEIGHT: f64 = 0.55;
const KEYWORD_SCORE_WEIGHT: f64 = 0.15;
const RECENCY_SCORE_WEIGHT: f64 = 0.15;
const IMPORTANCE_SCORE_WEIGHT: f64 = 0.15;
const KEYWORD_SCORE_SMOOTHING: f64 = 100.0;

#[derive(Default)]
#[napi(object)]
pub struct ReverieSemanticSearchOptions {
  pub limit: Option<i32>,
  #[napi(js_name = "maxCandidates")]
  pub max_candidates: Option<i32>,
  #[napi(js_name = "projectRoot")]
  pub project_root: Option<String>,
  #[napi(js_name = "batchSize")]
  pub batch_size: Option<u32>,
  pub normalize: Option<bool>,
  pub cache: Option<bool>,
  #[napi(js_name = "rerankerModel")]
  pub reranker_model: Option<String>,
  #[napi(js_name = "rerankerCacheDir")]
  pub reranker_cache_dir: Option<String>,
  #[napi(js_name = "rerankerMaxLength")]
  pub reranker_max_length: Option<u32>,
  #[napi(js_name = "rerankerShowProgress")]
  pub reranker_show_progress: Option<bool>,
  #[napi(js_name = "rerankerBatchSize")]
  pub reranker_batch_size: Option<u32>,
  #[napi(js_name = "rerankerTopK")]
  pub reranker_top_k: Option<u32>,
}

#[napi(object)]
pub struct ReverieSemanticIndexStats {
  #[napi(js_name = "conversationsIndexed")]
  pub conversations_indexed: i32,
  #[napi(js_name = "documentsEmbedded")]
  pub documents_embedded: i32,
  pub batches: i32,
}

struct SearchQueryContext {
  original: String,
  expanded: String,
}

impl SearchQueryContext {
  fn new(input: &str) -> Self {
    let original = input.trim().to_string();
    let mut extra_terms = expand_query_terms(&original);
    extra_terms.retain(|term| !term.is_empty());

    let expanded = if extra_terms.is_empty() {
      original.clone()
    } else {
      format!("{}\n\n{}", original, extra_terms.join(" "))
    };

    Self { original, expanded }
  }

  fn original(&self) -> &str {
    &self.original
  }

  fn keyword_text(&self) -> &str {
    &self.expanded
  }
}

fn build_embedding_queries(context: &SearchQueryContext) -> Vec<String> {
  let mut queries = Vec::new();
  let base = context.original().trim();
  if !base.is_empty() {
    queries.push(base.to_string());
  }

  for block in extract_query_blocks(base) {
    if queries.len() >= 4 {
      break;
    }
    if !block.eq_ignore_ascii_case(base) {
      queries.push(block);
    }
  }

  if queries.is_empty() {
    queries.push(context.original().to_string());
  }

  queries
}

fn extract_query_blocks(text: &str) -> Vec<String> {
  let mut blocks = Vec::new();
  for chunk in text.split("\n\n") {
    let trimmed = chunk.trim();
    if trimmed.len() > 40 {
      blocks.push(trimmed.to_string());
    }
  }

  if blocks.is_empty() {
    for line in text.lines() {
      let trimmed = line.trim();
      if trimmed.len() > 60 {
        blocks.push(trimmed.to_string());
      }
    }
  }

  blocks
}

#[napi]
pub async fn reverie_list_conversations(
  codex_home_path: String,
  limit: Option<i32>,
  offset: Option<i32>,
) -> napi::Result<Vec<ReverieConversation>> {
  let max_conversations = limit.unwrap_or(50).max(0) as usize;
  let skip_count = offset.unwrap_or(0).max(0) as usize;

  if max_conversations == 0 {
    return Ok(Vec::new());
  }

  let codex_home = Path::new(&codex_home_path);
  let conversations = load_reverie_conversations(codex_home, max_conversations, skip_count)
    .await
    .map_err(|e| napi::Error::from_reason(format!("Failed to load conversations: {e}")))?;

  Ok(conversations)
}

#[napi]
pub async fn reverie_search_conversations(
  codex_home_path: String,
  query: String,
  limit: Option<i32>,
) -> napi::Result<Vec<ReverieSearchResult>> {
  let trimmed_query = query.trim();
  if trimmed_query.is_empty() {
    return Ok(Vec::new());
  }

  let max_results = limit.unwrap_or(20).max(1) as usize;
  let search_window = max_results.saturating_mul(5).min(500);
  let codex_home = Path::new(&codex_home_path);
  let conversations = load_reverie_conversations(codex_home, search_window, 0)
    .await
    .map_err(|e| napi::Error::from_reason(format!("Failed to load conversations: {e}")))?;

  let regex = regex::RegexBuilder::new(&regex::escape(trimmed_query))
    .case_insensitive(true)
    .unicode(true)
    .build()
    .map_err(|e| napi::Error::from_reason(format!("Invalid search query: {e}")))?;

  let mut results = Vec::new();

  for conv in conversations {
    let mut relevance_score = 0.0;
    let mut matching_excerpts = Vec::new();
    let mut insights = Vec::new();

    // Use JSON records for regex matching (excerpts)
    for record in conv.head_records.iter().chain(conv.tail_records.iter()) {
      for mat in regex.find_iter(record) {
        relevance_score += 1.0;
        let excerpt_start = mat.start().saturating_sub(50);
        let excerpt_end = (mat.end() + 50).min(record.len());
        matching_excerpts.push(format!("...{}...", &record[excerpt_start..excerpt_end]));
      }
    }

    // Use TOON records for insights (LLM-friendly format)
    for record in conv.head_records_toon.iter().chain(conv.tail_records_toon.iter()) {
      if !record.trim().is_empty() {
        insights.push(record.clone());
      }
    }

    if relevance_score > 0.0 {
      results.push(ReverieSearchResult {
        conversation: conv,
        relevance_score,
        matching_excerpts,
        insights,
        reranker_score: None,
      });
    }

    if results.len() >= max_results {
      break;
    }
  }

  results.sort_by(|a, b| {
    b.relevance_score
      .partial_cmp(&a.relevance_score)
      .unwrap_or(std::cmp::Ordering::Equal)
  });
  results.truncate(max_results);

  Ok(results)
}

/// Search using blocks from the current ongoing conversation to find similar past sessions
#[napi]
pub async fn reverie_search_by_conversation(
  codex_home_path: String,
  conversation_messages: Vec<String>,
  options: Option<ReverieSemanticSearchOptions>,
) -> napi::Result<Vec<ReverieSearchResult>> {
  if conversation_messages.is_empty() {
    return Ok(Vec::new());
  }

  // Extract meaningful blocks from current conversation
  let query_blocks = extract_conversation_query_blocks(&conversation_messages);

  if query_blocks.is_empty() {
    return Ok(Vec::new());
  }

  // Combine blocks into a composite query (weighted by recency and importance)
  let composite_query = build_composite_query(&query_blocks);

  // Use the composite query to search
  reverie_search_semantic(codex_home_path, composite_query, options).await
}

#[napi]
pub async fn reverie_search_semantic(
  codex_home_path: String,
  context_text: String,
  options: Option<ReverieSemanticSearchOptions>,
) -> napi::Result<Vec<ReverieSearchResult>> {
  let trimmed = context_text.trim();
  if trimmed.is_empty() {
    return Ok(Vec::new());
  }

  let query_context = SearchQueryContext::new(trimmed);

  let opts = options.unwrap_or_default();
  let limit = opts.limit.unwrap_or(10).max(1) as usize;
  let max_candidates = opts
    .max_candidates
    .unwrap_or(80)
    .max(limit as i32) as usize;

  let project_root_for_cache = opts.project_root.clone();
  let normalized_project_root = opts
    .project_root
    .as_deref()
    .map(normalize_path);

  let codex_home = Path::new(&codex_home_path);
  let raw_conversations = load_reverie_conversations(codex_home, max_candidates.saturating_mul(2), 0)
    .await
    .map_err(|e| napi::Error::from_reason(format!("Failed to load conversations: {e}")))?;

  let mut scored_conversations: Vec<(usize, ReverieConversation)> = Vec::new();
  for conversation in raw_conversations {
    if !conversation_matches_project(&conversation.head_records, normalized_project_root.as_deref()) {
      continue;
    }

    let lex_score = conversation_lexical_score(&conversation, query_context.keyword_text());
    scored_conversations.push((lex_score, conversation));
  }

  if scored_conversations.is_empty() {
    return Ok(Vec::new());
  }

  scored_conversations.sort_by(|a, b| b.0.cmp(&a.0));

  let lexical_budget = max_candidates.saturating_mul(2);
  let mut candidates = Vec::<SemanticCandidate>::new();
  let mut total_documents = 0usize;
  for (_lex_score, conversation) in scored_conversations.into_iter().take(lexical_budget) {
    let insights = derive_insights_for_semantic(&conversation.head_records_toon, &conversation.tail_records_toon);
    let message_chunks = build_compact_document(&conversation, &insights, Some(query_context.keyword_text()));

    if message_chunks.is_empty() {
      continue;
    }

    total_documents += message_chunks.len();
    candidates.push(SemanticCandidate {
      conversation,
      insights,
      message_chunks,
    });

    if candidates.len() >= max_candidates {
      break;
    }
  }

  if candidates.is_empty() || total_documents == 0 {
    return Ok(Vec::new());
  }

  let embedding_queries = build_embedding_queries(&query_context);
  if embedding_queries.is_empty() {
    return Ok(Vec::new());
  }

  let mut inputs = Vec::with_capacity(total_documents.saturating_add(embedding_queries.len()));
  let mut doc_refs = Vec::with_capacity(total_documents);
  for query in &embedding_queries {
    inputs.push(query.clone());
  }
  for (candidate_idx, candidate) in candidates.iter().enumerate() {
    for (message_idx, chunk) in candidate.message_chunks.iter().enumerate() {
      inputs.push(chunk.clone());
      doc_refs.push(MessageDocRef {
        candidate_idx,
        message_idx,
        keyword_score: score_query_relevance(chunk, query_context.keyword_text()),
      });
    }
  }

  if doc_refs.is_empty() {
    return Ok(Vec::new());
  }

  let embed_request = FastEmbedEmbedRequest {
    inputs,
    batch_size: opts.batch_size,
    normalize: Some(opts.normalize.unwrap_or(true)),
    project_root: project_root_for_cache,
    cache: Some(opts.cache.unwrap_or(true)),
  };

  let embeddings = fast_embed_embed(embed_request).await?;
  if embeddings.len() != doc_refs.len().saturating_add(embedding_queries.len()) {
    return Err(napi::Error::from_reason("Embedding API returned unexpected length"));
  }

  let (query_embeddings, doc_embeddings) = embeddings.split_at(embedding_queries.len());
  let mut per_candidate_matches: Vec<Vec<MessageMatch>> = (0..candidates.len()).map(|_| Vec::new()).collect();
  for (doc_ref, embedding) in doc_refs.iter().zip(doc_embeddings.iter()) {
    let mut best_score = f64::NEG_INFINITY;
    for query_embedding in query_embeddings {
      let candidate_score = cosine_similarity(query_embedding, embedding);
      if candidate_score > best_score {
        best_score = candidate_score;
      }
    }
    let score = if best_score.is_finite() { best_score } else { 0.0 };
    if let Some(bucket) = per_candidate_matches.get_mut(doc_ref.candidate_idx) {
      bucket.push(MessageMatch {
        message_idx: doc_ref.message_idx,
        semantic_score: score,
        keyword_score: doc_ref.keyword_score,
      });
    }
  }

  let mut matches: Vec<RankedMatch> = candidates
    .into_iter()
    .zip(per_candidate_matches.into_iter())
    .filter_map(|(candidate, message_matches)| RankedMatch::new(candidate, message_matches))
    .collect();

  if let Err(err) = maybe_rerank_matches(&mut matches, query_context.original(), &opts).await {
    eprintln!("codex-native: reverie reranker failed; falling back to embedding scores: {err}");
  }

  matches.sort_by(|a, b| b
    .result
    .relevance_score
    .partial_cmp(&a.result.relevance_score)
    .unwrap_or(std::cmp::Ordering::Equal));
  matches.truncate(limit);

  Ok(matches.into_iter().map(|entry| entry.result).collect())
}

#[napi]
pub async fn reverie_index_semantic(
  codex_home_path: String,
  options: Option<ReverieSemanticSearchOptions>,
) -> napi::Result<ReverieSemanticIndexStats> {
  let opts = options.unwrap_or_default();
  let max_candidates = opts.max_candidates.unwrap_or(500).max(1) as usize;
  let conversation_limit = opts
    .limit
    .unwrap_or(max_candidates as i32)
    .max(1) as usize;
  let project_root = opts
    .project_root
    .as_deref()
    .map(normalize_path);

  let codex_home = Path::new(&codex_home_path);
  let conversations = load_reverie_conversations(codex_home, max_candidates, 0)
    .await
    .map_err(|e| napi::Error::from_reason(format!("Failed to load conversations: {e}")))?;

  let mut documents = Vec::new();
  let mut conversations_indexed = 0i32;
  for conversation in conversations {
    if conversations_indexed as usize >= conversation_limit {
      break;
    }
    if !conversation_matches_project(&conversation.head_records, project_root.as_deref()) {
      continue;
    }
    let insights = derive_insights_for_semantic(&conversation.head_records_toon, &conversation.tail_records_toon);
    let doc_chunks = build_compact_document(&conversation, &insights, None); // No query during indexing
    if doc_chunks.is_empty() {
      continue;
    }
    conversations_indexed += 1;
    documents.extend(doc_chunks);
  }

  if documents.is_empty() {
    return Ok(ReverieSemanticIndexStats {
      conversations_indexed: 0,
      documents_embedded: 0,
      batches: 0,
    });
  }

  const INDEX_CHUNK: usize = 64;
  let chunk_size = INDEX_CHUNK;
  let mut batches = 0;
  for chunk in documents.chunks(chunk_size) {
    batches += 1;
    let embed_request = FastEmbedEmbedRequest {
      inputs: chunk.to_vec(),
      batch_size: opts.batch_size,
      normalize: opts.normalize,
      project_root: opts.project_root.clone(),
      cache: opts.cache.or(Some(true)),
    };
    // Ignore the result; the goal is to populate the cache
    let _ = fast_embed_embed(embed_request).await?;
  }

  Ok(ReverieSemanticIndexStats {
    conversations_indexed,
    documents_embedded: documents.len() as i32,
    batches,
  })
}

async fn maybe_rerank_matches(
  matches: &mut Vec<RankedMatch>,
  query: &str,
  opts: &ReverieSemanticSearchOptions,
) -> napi::Result<()> {
  let Some(config) = build_reranker_config(opts) else {
    return Ok(());
  };
  if matches.is_empty() {
    return Ok(());
  }

  let documents: Vec<String> = matches.iter().map(|entry| entry.doc_text.clone()).collect();
  let reranked = fast_embed_rerank_documents(
    &config,
    query,
    documents,
    opts.reranker_batch_size.map(|value| value as usize),
    opts.reranker_top_k.map(|value| value as usize),
  )
  .await?;
  if reranked.is_empty() {
    return Ok(());
  }

  let mut seen = HashSet::new();
  let mut reordered = Vec::with_capacity(matches.len());
  for item in reranked {
    if item.index >= matches.len() {
      continue;
    }
    let mut candidate = matches[item.index].clone();
    let rerank_score = item.score as f64;
    candidate.result.relevance_score = rerank_score;
    candidate.result.reranker_score = Some(rerank_score);
    reordered.push(candidate);
    seen.insert(item.index);
  }

  for (idx, candidate) in matches.iter().enumerate() {
    if !seen.contains(&idx) {
      reordered.push(candidate.clone());
    }
  }

  *matches = reordered;
  Ok(())
}

fn build_reranker_config(
  opts: &ReverieSemanticSearchOptions,
) -> Option<FastEmbedRerankConfig> {
  let model = opts
    .reranker_model
    .as_ref()?
    .trim();
  let trimmed = if model.is_empty() { return None; } else { model };
  Some(FastEmbedRerankConfig {
    model: trimmed.to_string(),
    cache_dir: opts.reranker_cache_dir.clone(),
    max_length: opts.reranker_max_length,
    show_download_progress: opts.reranker_show_progress,
  })
}

async fn load_reverie_conversations(
  codex_home: &Path,
  limit: usize,
  offset: usize,
) -> std::io::Result<Vec<ReverieConversation>> {
  if limit == 0 {
    return Ok(Vec::new());
  }

  let page_size = limit.saturating_add(offset).max(1);
  let page = RolloutRecorder::list_conversations(
    codex_home,
    page_size,
    None,
    &[],
    None,
    BUILT_IN_OSS_MODEL_PROVIDER_ID,
  )
  .await?;

  Ok(
    page
      .items
      .into_iter()
      .skip(offset)
      .take(limit)
      .map(conversation_item_to_reverie)
      .collect(),
  )
}

fn conversation_item_to_reverie(item: ConversationItem) -> ReverieConversation {
  let id = item
    .path
    .file_stem()
    .and_then(|s| s.to_str())
    .unwrap_or("unknown")
    .to_string();

  let (head_records, head_records_toon) = serialize_records(&item.head);
  let (tail_records, tail_records_toon) = serialize_records(&item.tail);

  ReverieConversation {
    id,
    path: item.path.to_string_lossy().into_owned(),
    created_at: item.created_at,
    updated_at: item.updated_at,
    head_records,
    tail_records,
    head_records_toon,
    tail_records_toon,
  }
}

fn serialize_records(values: &[serde_json::Value]) -> (Vec<String>, Vec<String>) {
  let mut json_records = Vec::with_capacity(values.len());
  let mut toon_records = Vec::with_capacity(values.len());
  for value in values {
    let json_text = serde_json::to_string(value).unwrap_or_else(|_| value.to_string());
    let toon_text = encode_json_value_to_toon(value).unwrap_or_else(|| fallback_toon_snippet(&json_text));
    json_records.push(json_text);
    toon_records.push(toon_text);
  }
  (json_records, toon_records)
}

fn fallback_toon_snippet(source: &str) -> String {
  const MAX_FALLBACK_CHARS: usize = 320;
  if source.chars().count() <= MAX_FALLBACK_CHARS {
    source.to_string()
  } else {
    let mut snippet: String = source.chars().take(MAX_FALLBACK_CHARS).collect();
    snippet.push('…');
    snippet
  }
}

#[derive(Clone)]
struct SemanticCandidate {
  conversation: ReverieConversation,
  insights: Vec<String>,
  message_chunks: Vec<String>,
}

struct MessageDocRef {
  candidate_idx: usize,
  message_idx: usize,
  keyword_score: usize,
}

struct MessageMatch {
  message_idx: usize,
  semantic_score: f64,
  keyword_score: usize,
}

#[derive(Clone)]
struct RankedMatch {
  doc_text: String,
  result: ReverieSearchResult,
}

impl RankedMatch {
  fn new(candidate: SemanticCandidate, mut message_matches: Vec<MessageMatch>) -> Option<Self> {
    if message_matches.is_empty() {
      return None;
    }

    message_matches.sort_by(|a, b| {
      b
        .semantic_score
        .partial_cmp(&a.semantic_score)
        .unwrap_or(std::cmp::Ordering::Equal)
        .then(b.keyword_score.cmp(&a.keyword_score))
    });

    let SemanticCandidate {
      conversation,
      insights,
      message_chunks,
    } = candidate;

    let best_match = message_matches.first()?;
    let doc_text = message_chunks.get(best_match.message_idx)?.clone();
    let top_k = message_matches.iter().take(3).collect::<Vec<_>>();
    let avg_semantic = top_k
      .iter()
      .map(|entry| entry.semantic_score)
      .sum::<f64>()
      / (top_k.len() as f64);
    let best_keyword_raw = top_k
      .iter()
      .map(|entry| entry.keyword_score)
      .max()
      .unwrap_or(0);

    let semantic_component = normalize_semantic_score(avg_semantic);
    let keyword_component = normalize_keyword_score(best_keyword_raw);
    let recency_component = recency_score(&conversation.updated_at);
    let importance_component = compute_conversation_importance(&message_matches, &message_chunks);
    let blended_score = blend_similarity_scores(
      semantic_component,
      keyword_component,
      recency_component,
      importance_component,
    );

    let mut excerpts = Vec::new();
    for entry in message_matches.iter().take(3) {
      if let Some(text) = message_chunks.get(entry.message_idx) {
        let excerpt = build_excerpt(text);
        if !excerpt.is_empty() {
          excerpts.push(excerpt);
        }
      }
    }

    if excerpts.is_empty() {
      excerpts.push(build_excerpt(&doc_text));
    }

    Some(Self {
      doc_text,
      result: ReverieSearchResult {
        conversation,
        relevance_score: blended_score,
        matching_excerpts: excerpts,
        insights,
        reranker_score: None,
      },
    })
  }
}

fn normalize_semantic_score(value: f64) -> f64 {
  ((value + 1.0) / 2.0).clamp(0.0, 1.0)
}

fn normalize_keyword_score(value: usize) -> f64 {
  if value == 0 {
    0.0
  } else {
    (value as f64) / ((value as f64) + KEYWORD_SCORE_SMOOTHING)
  }
}

fn blend_similarity_scores(
  semantic_component: f64,
  keyword_component: f64,
  recency_component: f64,
  importance_component: f64,
) -> f64 {
  (semantic_component * SEMANTIC_SCORE_WEIGHT)
    + (keyword_component * KEYWORD_SCORE_WEIGHT)
    + (recency_component.clamp(0.0, 1.0) * RECENCY_SCORE_WEIGHT)
    + (importance_component.clamp(0.0, 1.0) * IMPORTANCE_SCORE_WEIGHT)
}

fn conversation_lexical_score(conversation: &ReverieConversation, keyword_text: &str) -> usize {
  conversation
    .head_records_toon
    .iter()
    .chain(conversation.tail_records_toon.iter())
    .take(20)
    .map(|line| score_query_relevance(line, keyword_text))
    .max()
    .unwrap_or(0)
}

fn recency_score(updated_at: &Option<String>) -> f64 {
  if let Some(ts) = updated_at
    && let Ok(dt) = DateTime::parse_from_rfc3339(ts)
  {
    let utc: DateTime<Utc> = dt.with_timezone(&Utc);
    let age_seconds = (Utc::now() - utc).num_seconds().max(0) as f64;
    let age_days = age_seconds / 86_400.0;
    let lambda = 0.05_f64; // ~half-life of ~14 days
    return (-lambda * age_days).exp().clamp(0.0, 1.0);
  }
  0.5
}

fn compute_conversation_importance(message_matches: &[MessageMatch], message_chunks: &[String]) -> f64 {
  if message_matches.is_empty() {
    return 0.0;
  }

  let mut best = 0usize;
  for entry in message_matches.iter().take(8) {
    if let Some(text) = message_chunks.get(entry.message_idx) {
      let local = score_message_importance(text);
      if local > best {
        best = local;
      }
    }
  }

  (best as f64 / 20.0).clamp(0.0, 1.0)
}

fn extract_insight_from_json(value: &serde_json::Value) -> Option<String> {
  // Extract meaningful content from JSON records, excluding system prompts

  // First classify the message type
  let msg_type = classify_message_type(value);

  // Skip system prompts and tool outputs
  if msg_type == MessageType::System || msg_type == MessageType::Tool {
    return None;
  }

  // Extract text content
  let text = extract_text_content(value)?;

  // Final check: ensure it's not an instruction marker
  if contains_instruction_marker(&text) {
    return None;
  }

  Some(text)
}

fn derive_insights_for_semantic(head_records_toon: &[String], tail_records_toon: &[String]) -> Vec<String> {
  let mut insights = Vec::new();
  let mut seen_prefixes: HashSet<String> = HashSet::new();

  // TOON-encoded records are already in LLM-friendly format, but filter for quality
  for record in head_records_toon.iter().chain(tail_records_toon.iter()) {
    if insights.len() >= MAX_INSIGHTS_PER_CONVERSATION {
      break;
    }

    let trimmed = record.trim();

    // Quality check: require substantive content (100+ chars minimum)
    if trimmed.len() < 100 {
      continue;
    }

    // Quality check: skip if looks like metadata/JSON/code blocks
    if trimmed.starts_with('{')
      || trimmed.starts_with('[')
      || trimmed.starts_with("```")
      || trimmed.starts_with("type:")
      || trimmed.starts_with("id:")
    {
      continue;
    }

    let lowercase = trimmed.to_lowercase();

    // Quality check: skip if starts with common system/thinking markers
    if lowercase.starts_with("**")
      || lowercase.starts_with("context")
      || lowercase.starts_with("hello")
      || lowercase.starts_with("#")
      || lowercase.starts_with("<")
    {
      continue;
    }

    // Quality check: require lexical diversity (not just repetitive text)
    let unique_words: HashSet<&str> = lowercase.split_whitespace().collect();
    let total_words = lowercase.split_whitespace().count();
    if total_words > 0 && (unique_words.len() as f64 / total_words as f64) < 0.4 {
      continue; // Skip if less than 40% unique words (too repetitive)
    }

    // Deduplicate by checking if we've seen similar content
    // Take first 60 chars as a fingerprint (after any timestamp)
    let content_start = if lowercase.starts_with("timestamp:") {
      trimmed.find('\n').map(|pos| pos + 1).unwrap_or(0)
    } else {
      0
    };
    let prefix: String = trimmed.chars().skip(content_start).take(60).collect();

    if seen_prefixes.contains(&prefix) {
      continue;
    }

    seen_prefixes.insert(prefix);
    insights.push(trimmed.chars().take(400).collect());
  }

  insights
}

fn build_compact_document(
  conversation: &ReverieConversation,
  insights: &[String],
  query: Option<&str>,
) -> Vec<String> {
  const MAX_CHARS: usize = 6000; // Increased from 4000 to preserve more technical details
  const MAX_MESSAGES: usize = 50; // Increased from 32 to sample more of conversation

  let segments = load_full_conversation_json_segments(&conversation.path, 200); // Load more segments

  // Filter and score messages by relevance to query
  let mut scored_messages: Vec<(String, usize)> = segments
    .iter()
    .filter_map(|value| {
      let msg_type = classify_message_type(value);

      // Skip system prompts and tool outputs entirely
      if msg_type == MessageType::System || msg_type == MessageType::Tool {
        return None;
      }

      // Extract clean content from user/agent messages
      let text = extract_text_content(value)?
        .trim()
        .to_string();

      if text.is_empty() || contains_instruction_marker(&text) {
        return None;
      }

      // Score by query relevance if query provided, otherwise by general importance
      let score = if let Some(q) = query {
        score_query_relevance(&text, q)
      } else {
        score_message_importance(&text)
      };
      Some((text, score))
    })
    .collect();

  // Sort by relevance (descending) to prioritize most relevant messages
  scored_messages.sort_by(|a, b| b.1.cmp(&a.1));

  // Take top messages
  let mut message_chunks: Vec<String> = scored_messages
    .into_iter()
    .take(MAX_MESSAGES)
    .map(|(text, _score)| text)
    .collect();

  // Fallback: if no valid messages found, use TOON records (LLM-friendly format)
  if message_chunks.is_empty() {
    message_chunks = conversation
      .head_records_toon
      .iter()
      .chain(conversation.tail_records_toon.iter())
      .filter(|line| !line.trim().is_empty())
      .take(MAX_MESSAGES)
      .cloned()
      .collect();
  }

  // Add insights at the beginning (they're high-value summaries)
  let mut final_chunks = insights.to_vec();
  final_chunks.extend(message_chunks);

  if final_chunks.is_empty() {
    return Vec::new();
  }

  // Smart truncation: preserve complete messages, don't cut mid-message
  let mut selected = Vec::new();
  let mut total_chars = 0usize;
  for chunk in final_chunks {
    let trimmed = chunk.trim();
    if trimmed.is_empty() {
      continue;
    }

    let chunk_chars = trimmed.chars().count();
    if total_chars + chunk_chars <= MAX_CHARS {
      selected.push(trimmed.to_string());
      total_chars += chunk_chars;
    } else if selected.is_empty() {
      selected.push(truncate_to_chars(trimmed, MAX_CHARS));
      break;
    } else {
      break;
    }
  }

  selected
}

/// Represents a meaningful block extracted from the current conversation
struct ConversationBlock {
  text: String,
  weight: f32,  // Recency and importance weight
  block_type: BlockType,
}

#[derive(Debug, PartialEq)]
enum BlockType {
  UserRequest,       // User messages (define intent)
  AgentResponse,     // Agent explanations
  Implementation,    // Code/technical details
}

/// Extract meaningful blocks from current conversation messages
fn extract_conversation_query_blocks(messages: &[String]) -> Vec<ConversationBlock> {
  let mut blocks = Vec::new();

  for (idx, msg) in messages.iter().enumerate() {
    // Parse message as JSON if possible to get structured content
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(msg) {
      // Extract text content
      if let Some(text) = extract_text_content(&value) {
        let trimmed = text.trim();
        if trimmed.is_empty() || trimmed.len() < 20 {
          continue;
        }

        // Determine block type by message structure only (no content assumptions)
        let msg_type = classify_message_type(&value);
        let has_code = trimmed.contains("```") || trimmed.contains("fn ") || trimmed.contains("function ") || trimmed.contains("class ");

        let (block_type, base_weight) = match msg_type {
          MessageType::User => {
            // User messages are prioritized (they define intent)
            (BlockType::UserRequest, 1.3)
          },
          MessageType::Agent => {
            if has_code && trimmed.len() > 300 {
              // Long agent messages with code are likely implementations
              (BlockType::Implementation, 1.2)
            } else {
              (BlockType::AgentResponse, 1.0)
            }
          },
          MessageType::Reasoning => {
            // Reasoning can contain important context
            (BlockType::AgentResponse, 0.9)
          },
          _ => {
            // Tool and System messages filtered elsewhere
            (BlockType::AgentResponse, 0.5)
          }
        };

        // Recency weight: more recent messages are more important
        let recency_weight = 0.5 + (idx as f32 / messages.len() as f32) * 0.5;
        let final_weight = base_weight * recency_weight;

        blocks.push(ConversationBlock {
          text: trimmed.to_string(),
          weight: final_weight,
          block_type,
        });
      }
    } else {
      // Plain text message
      let trimmed = msg.trim();
      if trimmed.len() >= 20 {
        let recency_weight = 0.5 + (idx as f32 / messages.len() as f32) * 0.5;
        blocks.push(ConversationBlock {
          text: trimmed.to_string(),
          weight: recency_weight,
          block_type: BlockType::UserRequest,
        });
      }
    }
  }

  // Sort by weight (highest first) and limit to most important blocks
  blocks.sort_by(|a, b| b.weight.partial_cmp(&a.weight).unwrap_or(std::cmp::Ordering::Equal));
  blocks.truncate(10);  // Top 10 most important blocks

  blocks
}

/// Build a composite query from conversation blocks (fully dynamic, no content assumptions)
fn build_composite_query(blocks: &[ConversationBlock]) -> String {
  if blocks.is_empty() {
    return String::new();
  }

  // Blocks are already sorted by weight (importance * recency)
  // Just take the top weighted blocks for the query
  let query_parts: Vec<&str> = blocks
    .iter()
    .filter(|block| !matches!(block.block_type, BlockType::AgentResponse)) // Prioritize user requests and implementations
    .take(3)
    .map(|block| block.text.as_str())
    .collect();

  // If we don't have enough, include agent responses too
  let final_parts: Vec<&str> = if query_parts.len() < 3 {
    blocks
      .iter()
      .take(5)
      .map(|block| block.text.as_str())
      .collect()
  } else {
    query_parts
  };

  // Join with spacing, truncate if too long
  let composite = final_parts.join(" ");
  if composite.len() > 2000 {
    composite.chars().take(2000).collect()
  } else {
    composite
  }
}

/// Detect if a term is a technical identifier (CamelCase, PascalCase, snake_case, kebab-case, or has special chars)
fn is_technical_term(term: &str) -> bool {
  // CamelCase or PascalCase (e.g., FastEmbed, fastEmbedInit, TurnItem)
  let has_internal_caps = term.chars().skip(1).any(|c| c.is_uppercase());

  // snake_case or kebab-case (e.g., fast_embed, codex-native)
  let has_separator = term.contains('_') || term.contains('-');

  // Contains numbers or special chars (e.g., @codex-native/sdk, v1.5, gpt-4)
  let has_special = term.chars().any(|c| !c.is_alphabetic() && !c.is_whitespace());

  // Has file extension (e.g., .rs, .ts, .json)
  let is_file = term.contains('.');

  has_internal_caps || has_separator || has_special || is_file
}

/// Extract all technical terms from query before stop-word filtering
fn extract_technical_terms(query: &str) -> Vec<String> {
  query
    .split_whitespace()
    .filter(|term| is_technical_term(term))
    .map(|s| s.to_string())
    .collect()
}

/// Score message relevance to search query (enhanced RAG with stemming and n-grams)
fn score_query_relevance(text: &str, query: &str) -> usize {
  use stop_words::{get, LANGUAGE};
  use rust_stemmers::{Algorithm, Stemmer};

  let text_lower = text.to_lowercase();
  let query_lower = query.to_lowercase();

  // Extract technical terms BEFORE stop word filtering (critical for API names, etc.)
  let technical_terms = extract_technical_terms(query);

  // Extract meaningful query terms (filter out common words)
  let stop_words_set = get(LANGUAGE::English);
  let query_terms: Vec<&str> = query_lower
    .split_whitespace()
    .filter(|term| {
      // Keep if: technical term, longer than 2 chars and not a stop word
      is_technical_term(term) || (term.len() > 2 && !stop_words_set.contains(&term.to_string()))
    })
    .collect();

  if query_terms.is_empty() {
    return score_message_importance(text);
  }

  let mut score = 0;
  let stemmer = Stemmer::create(Algorithm::English);

  // CRITICAL: Exact technical term matching (structural detection, not content assumptions)
  // Technical terms are identified by structure (CamelCase, kebab-case, etc.), not by domain knowledge
  for tech_term in &technical_terms {
    let tech_lower = tech_term.to_lowercase();
    if text_lower.contains(&tech_lower) {
      score += 100; // High value for matching structural technical identifiers

      // Frequency bonus
      let occurrences = text_lower.matches(&tech_lower).count();
      if occurrences > 1 {
        score += (occurrences - 1).min(3) * 20;
      }
    }
  }

  // Exact multi-word phrase match (query appears verbatim in text)
  if text_lower.contains(&query_lower) {
    score += 150;
  }

  // Stem query terms for fuzzy matching
  let stemmed_query: Vec<String> = query_terms
    .iter()
    .map(|term| stemmer.stem(term).to_string())
    .collect();

  // Stem text words for comparison
  let text_words: Vec<&str> = text_lower.split_whitespace().collect();
  let stemmed_text: Vec<String> = text_words
    .iter()
    .map(|word| stemmer.stem(word).to_string())
    .collect();

  // Count matching query terms (both exact and stemmed)
  let mut matched_terms = 0;
  let mut rare_term_bonus = 0;

  for (i, term) in query_terms.iter().enumerate() {
    let mut term_matched = false;
    let mut term_count = 0;

    // Exact match
    let exact_count = text_lower.matches(term).count();
    if exact_count > 0 {
      term_matched = true;
      term_count += exact_count;
      score += 25; // Exact match worth more
    }

    // Stemmed match (catches plurals, tenses, etc.)
    let stemmed_matches = stemmed_text.iter().filter(|w| **w == stemmed_query[i]).count();
    if stemmed_matches > exact_count {
      term_matched = true;
      term_count += stemmed_matches - exact_count;
      score += 15; // Stemmed match worth less than exact
    }

    if term_matched {
      matched_terms += 1;

      // Frequency bonus (but with diminishing returns)
      if term_count > 1 {
        score += (term_count - 1).min(3) * 5;
      }

      // Rare term bonus (longer terms are usually more specific/valuable)
      if term.len() > 8 {
        rare_term_bonus += 10;
      } else if term.len() > 6 {
        rare_term_bonus += 5;
      }
    }
  }

  score += rare_term_bonus;

  // N-gram matching for partial matches (e.g., "FastEmbed" matches "fast" + "embed")
  for term in &query_terms {
    if term.len() > 5 {
      let bigrams = extract_bigrams(term);
      for bigram in bigrams {
        if text_lower.contains(&bigram) {
          score += 8; // Partial match bonus
        }
      }
    }
  }

  // Match ratio bonus (BM25-inspired)
  let match_ratio = matched_terms as f64 / query_terms.len() as f64;
  if match_ratio > 0.7 {
    score += 50; // Most terms matched
  } else if match_ratio > 0.5 {
    score += 30;
  } else if match_ratio > 0.3 {
    score += 15;
  }

  // Proximity scoring: reward terms appearing close together
  if matched_terms >= 2 {
    let proximity_score = calculate_proximity_score(&text_lower, &query_terms);
    score += proximity_score;
  }

  // Add base importance score (weighted lower than query relevance)
  score += score_message_importance(text) / 3;

  score
}

/// Extract character bigrams from a term for partial matching (UTF-8 safe)
fn extract_bigrams(term: &str) -> Vec<String> {
  let chars: Vec<char> = term.chars().collect();
  if chars.len() < 4 {
    return vec![];
  }
  (0..chars.len().saturating_sub(2))
    .map(|i| {
      let end = (i + 3).min(chars.len());
      chars[i..end].iter().collect()
    })
    .collect()
}

/// Calculate proximity score based on how close query terms appear in text
fn calculate_proximity_score(text: &str, query_terms: &[&str]) -> usize {
  let words: Vec<&str> = text.split_whitespace().collect();
  let mut max_proximity = 0;

  // Find positions of query terms
  for (i, word) in words.iter().enumerate() {
    let word_lower = word.to_lowercase();
    for term in query_terms {
      if word_lower.contains(term) {
        // Check nearby words for other query terms
        let window_start = i.saturating_sub(10);
        let window_end = (i + 10).min(words.len());

        let nearby_matches = words[window_start..window_end]
          .iter()
          .filter(|w| {
            let w_lower = w.to_lowercase();
            query_terms.iter().any(|t| w_lower.contains(t))
          })
          .count();

        max_proximity = max_proximity.max(nearby_matches);
      }
    }
  }

  // Reward terms appearing in close proximity
  match max_proximity {
    0..=1 => 0,
    2 => 15,
    3 => 25,
    4..=5 => 35,
    _ => 50,
  }
}

/// Score message importance based on structural properties only (fallback when no query)
/// Relies on semantic embeddings for content understanding
fn score_message_importance(text: &str) -> usize {
  let mut score: usize = 0;

  // Structural indicators only - no content assumptions

  // Has question mark (structural indicator of question)
  if text.contains('?') {
    score += 5;
  }

  // Reasonable length (not too short, not too long)
  if text.len() > 200 && text.len() < 1000 {
    score += 3;
  } else if text.len() >= 100 && text.len() < 200 {
    score += 2;
  }

  // Very short messages are less informative
  if text.len() < 50 {
    score = score.saturating_sub(3);
  }

  // Contains code-like structures (structural)
  if text.contains("```") || text.contains("fn ") || text.contains("function ") || text.contains("class ") {
    score += 4;
  }

  score
}

fn expand_query_terms(query: &str) -> Vec<String> {
  let mut extras = Vec::new();
  let mut seen = HashSet::new();

  for raw in query.split(|c: char| c.is_ascii_punctuation() || c.is_whitespace()) {
    let normalized = raw
      .trim_matches(|ch: char| !ch.is_alphanumeric() && ch != '-' && ch != '_')
      .to_lowercase();
    if normalized.is_empty() {
      continue;
    }
    if !seen.insert(normalized.clone()) {
      continue;
    }
    for synonym in lookup_query_synonyms(&normalized) {
      if seen.insert((*synonym).to_string()) {
        extras.push((*synonym).to_string());
      }
    }
  }

  extras
}

fn lookup_query_synonyms(term: &str) -> &'static [&'static str] {
  match term {
    "slow" | "slowness" => &["latency", "lag", "bottleneck", "performance"],
    "latency" => &["slow", "delay", "lag", "throughput"],
    "lag" => &["latency", "slow", "delay"],
    "performance" => &["latency", "throughput", "optimization", "profiling"],
    "bottleneck" => &["slow", "constraint", "latency"],
    "optimize" | "optimization" => &["improve", "tune", "refine"],
    "improve" | "improvement" => &["optimize", "enhance", "refine"],
    "quality" => &["relevance", "accuracy", "precision"],
    "error" | "errors" => &["bug", "failure", "exception", "crash"],
    "bug" | "bugs" => &["defect", "issue", "error"],
    "failure" | "fail" | "failed" => &["error", "fault", "crash"],
    "crash" | "panic" => &["failure", "exception", "bug"],
    "timeout" | "timeouts" => &["hang", "delay", "latency"],
    "hang" | "hung" => &["freeze", "timeout", "deadlock"],
    "memory" => &["ram", "heap", "allocation"],
    "cpu" => &["processor", "core", "utilization"],
    "network" => &["latency", "connectivity", "bandwidth"],
    "api" | "apis" => &["endpoint", "service", "request"],
    "endpoint" | "endpoints" => &["api", "route", "service"],
    "auth" | "authentication" => &["login", "token", "credentials"],
    "token" | "tokens" => &["auth", "credential", "session"],
    "deploy" | "deployment" => &["release", "ship", "rollout"],
    "release" | "rollout" => &["deploy", "ship", "launch"],
    "search" => &["retrieval", "lookup", "query"],
    "query" | "queries" => &["search", "lookup", "prompt"],
    "index" | "indexing" => &["catalog", "ingest", "register"],
    "embedding" | "embeddings" => &["vector", "semantic", "representation"],
    "rerank" | "reranker" => &["rescore", "rank", "cross-encoder"],
    "similarity" => &["distance", "match", "closeness"],
    "diagnose" => &["debug", "investigate", "triage"],
    "debug" => &["diagnose", "investigate", "trace"],
    "latencies" => &["slow", "delay", "throughput"],
    "throughput" => &["performance", "latency", "capacity"],
    _ => &[],
  }
}

fn load_full_conversation_json_segments(path: &str, max_records: usize) -> Vec<serde_json::Value> {
  if max_records == 0 {
    return Vec::new();
  }
  let file = match File::open(path) {
    Ok(file) => file,
    Err(_) => return Vec::new(),
  };
  let reader = BufReader::new(file);
  let mut records = Vec::new();
  for line in reader.lines() {
    if records.len() >= max_records {
      break;
    }
    let line = match line {
      Ok(line) => line,
      Err(_) => continue,
    };
    let trimmed = line.trim();
    if trimmed.is_empty() {
      continue;
    }
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed)
      && !is_metadata_record(&value)
    {
      records.push(value);
    }
  }
  records
}

#[allow(dead_code)]
fn parse_json_strings(records: &[String], limit: usize) -> Vec<serde_json::Value> {
  if limit == 0 {
    return Vec::new();
  }
  records
    .iter()
    .take(limit)
    .filter_map(|record| serde_json::from_str::<serde_json::Value>(record).ok())
    .filter(|value| !is_metadata_record(value))
    .collect()
}

fn truncate_to_chars(input: &str, max_chars: usize) -> String {
  if input.chars().count() <= max_chars {
    return input.to_string();
  }
  input.chars().take(max_chars).collect()
}

fn is_metadata_record(value: &serde_json::Value) -> bool {
  if let Some(record_type) = value.get("type").and_then(|kind| kind.as_str()) {
    if record_type == "session_meta" {
      return true;
    }
    if record_type == "event_msg"
      && let Some(payload) = value.get("payload")
      && payload
        .get("type")
        .and_then(|kind| kind.as_str())
        .is_some_and(|kind| kind == "user_message")
      && let Some(message) = payload.get("message").and_then(|msg| msg.as_str())
      && contains_instruction_marker(message)
    {
      return true;
    }
    if record_type == "message"
      && let Some(content) = value.get("content").and_then(|c| c.as_str())
      && contains_instruction_marker(content)
    {
      return true;
    }
  }

  if let Some(text) = value.get("text").and_then(|t| t.as_str())
    && contains_instruction_marker(text)
  {
    return true;
  }
  false
}

fn contains_instruction_marker(text: &str) -> bool {
  let normalized = text.to_lowercase();
  normalized.contains("# agents.md instructions")
    || normalized.contains("agents.md instructions for")
    || normalized.contains("<environment_context>")
    || normalized.contains("<system>")
    || normalized.contains("codex-rs folder where the rust code lives")
    || normalized.contains("<instructions>")
    || normalized.contains("sandbox env vars")
    || normalized.contains("approval_policy")
    || normalized.contains("sandbox_mode")
    || normalized.contains("tool output:")
    || normalized.contains("ci fix orchestrator")
    || normalized.contains("ci remediation orchestrator")
    || normalized.contains("branch intent analyst")
    || normalized.contains("file diff inspector")
    || normalized.contains("you are coordinating an automated")
    || normalized.contains("respond strictly with json")
    || normalized.contains("judge whether each change")
}

/// Classify message type to filter system prompts and tool outputs
#[derive(Debug, Clone, Copy, PartialEq)]
enum MessageType {
  User,
  Agent,
  Reasoning,
  Tool,
  System,  // System prompts - should be excluded
}

fn classify_message_type(value: &serde_json::Value) -> MessageType {
  // Check for system prompts first
  if let Some(text) = extract_text_content(value) {
    if contains_instruction_marker(&text) {
      return MessageType::System;
    }

    // Check for tool output markers
    if text.trim().starts_with("Tool output:") || text.contains("\"metadata\":{\"exit_code\"") {
      return MessageType::Tool;
    }
  }

  // Check type field for proper classification
  if let Some(record_type) = value.get("type").and_then(|t| t.as_str()) {
    match record_type {
      "event_msg" => {
        if let Some(payload) = value.get("payload")
          && let Some(msg_type) = payload.get("type").and_then(|t| t.as_str())
        {
          return match msg_type {
            "user_message" => MessageType::User,
            "agent_message" => MessageType::Agent,
            "agent_reasoning" => MessageType::Reasoning,
            "command_execution" | "mcp_tool_call" => MessageType::Tool,
            _ => MessageType::Agent,
          };
        }
      }
      "session_meta" => return MessageType::System,
      _ => {}
    }
  }

  MessageType::Agent
}

fn extract_text_content(value: &serde_json::Value) -> Option<String> {
  // Try to get payload first (for tag+content serde format)
  let target = value.get("payload").unwrap_or(value);

  // Try content array (ResponseItem::Message format)
  if let Some(content_array) = target.get("content").and_then(|c| c.as_array()) {
    let texts: Vec<String> = content_array
      .iter()
      .filter_map(|item| item.get("text").and_then(|t| t.as_str()).map(String::from))
      .collect();
    if !texts.is_empty() {
      return Some(texts.join(" "));
    }
  }

  // Try direct fields
  target.get("content").and_then(|c| c.as_str()).map(String::from)
    .or_else(|| target.get("text").and_then(|t| t.as_str()).map(String::from))
    .or_else(|| target.get("message").and_then(|m| m.as_str()).map(String::from))
}

fn conversation_matches_project(head_records: &[String], project_root: Option<&Path>) -> bool {
  let Some(root) = project_root else {
    return true;
  };
  for record in head_records {
    if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(record)
      && let Some(cwd) = json_value
        .get("meta")
        .and_then(|meta| meta.get("cwd"))
        .and_then(|cwd| cwd.as_str())
        .or_else(|| json_value.get("cwd").and_then(|cwd| cwd.as_str()))
    {
      let candidate = normalize_path(cwd);
      if path_starts_with(&candidate, root) {
        return true;
      }
    }
  }
  false
}

fn normalize_path<P: AsRef<Path>>(value: P) -> PathBuf {
  let path = value.as_ref();
  if path.is_absolute() {
    path.to_path_buf()
  } else if let Ok(cwd) = std::env::current_dir() {
    cwd.join(path)
  } else {
    path.to_path_buf()
  }
}

fn path_starts_with(candidate: &Path, root: &Path) -> bool {
  candidate == root || candidate.starts_with(root)
}

fn cosine_similarity(query: &[f32], document: &[f32]) -> f64 {
  if query.len() != document.len() {
    return 0.0;
  }
  let mut dot = 0.0f64;
  let mut q_norm = 0.0f64;
  let mut d_norm = 0.0f64;
  for (q, d) in query.iter().zip(document.iter()) {
    let qf = *q as f64;
    let df = *d as f64;
    dot += qf * df;
    q_norm += qf * qf;
    d_norm += df * df;
  }
  if q_norm == 0.0 || d_norm == 0.0 {
    return 0.0;
  }
  dot / (q_norm.sqrt() * d_norm.sqrt())
}

fn build_excerpt(text: &str) -> String {
  let trimmed = text.trim();
  if trimmed.is_empty() {
    return String::new();
  }
  const MAX_EXCERPT_CHARS: usize = 240;
  if trimmed.chars().count() <= MAX_EXCERPT_CHARS {
    trimmed.to_string()
  } else {
    let mut excerpt: String = trimmed.chars().take(MAX_EXCERPT_CHARS).collect();
    excerpt.push('…');
    excerpt
  }
}

#[napi]
pub async fn reverie_get_conversation_insights(
  conversation_path: String,
  query: Option<String>,
) -> napi::Result<Vec<String>> {
  use std::path::Path;
  use tokio::fs;

  let path = Path::new(&conversation_path);

  // Read the conversation file
  let content = fs::read_to_string(path)
    .await
    .map_err(|e| napi::Error::from_reason(format!("Failed to read conversation: {e}")))?;

  let mut insights = Vec::new();
  let lines: Vec<&str> = content.lines().collect();

  for line in lines {
    if line.trim().is_empty() {
      continue;
    }

    if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(line)
      && let Some(insight) = extract_insight_from_json(&json_value)
    {
      // Filter by query if provided
      if let Some(ref q) = query {
        if insight.to_lowercase().contains(&q.to_lowercase()) {
          insights.push(insight);
        }
      } else {
        insights.push(insight);
      }
    }
  }

  // Limit to most relevant insights
  insights.truncate(50);

  Ok(insights)
}

// ============================================================================
