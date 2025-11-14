// Section 6: Reverie System - Conversation Search and Insights
// ============================================================================
//
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
}

#[napi(object)]
pub struct ReverieSearchResult {
  pub conversation: ReverieConversation,
  #[napi(js_name = "relevanceScore")]
  pub relevance_score: f64,
  #[napi(js_name = "matchingExcerpts")]
  pub matching_excerpts: Vec<String>,
  pub insights: Vec<String>,
}

const MAX_INSIGHTS_PER_CONVERSATION: usize = 4;

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
}

#[napi(object)]
pub struct ReverieSemanticIndexStats {
  #[napi(js_name = "conversationsIndexed")]
  pub conversations_indexed: i32,
  #[napi(js_name = "documentsEmbedded")]
  pub documents_embedded: i32,
  pub batches: i32,
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

    for record in conv.head_records.iter().chain(conv.tail_records.iter()) {
      for mat in regex.find_iter(record) {
        relevance_score += 1.0;
        let excerpt_start = mat.start().saturating_sub(50);
        let excerpt_end = (mat.end() + 50).min(record.len());
        matching_excerpts.push(format!("...{}...", &record[excerpt_start..excerpt_end]));
      }

      if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(record)
        && let Some(content) = extract_insight_from_json(&json_value)
      {
        insights.push(content);
      }
    }

    if relevance_score > 0.0 {
      results.push(ReverieSearchResult {
        conversation: conv,
        relevance_score,
        matching_excerpts,
        insights,
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
    .map(|root| normalize_path(root));

  let codex_home = Path::new(&codex_home_path);
  let raw_conversations = load_reverie_conversations(codex_home, max_candidates.saturating_mul(2), 0)
    .await
    .map_err(|e| napi::Error::from_reason(format!("Failed to load conversations: {e}")))?;

  let mut candidates = Vec::<SemanticCandidate>::new();
  for conversation in raw_conversations {
    if !conversation_matches_project(&conversation.head_records, normalized_project_root.as_deref()) {
      continue;
    }

    let insights = derive_insights_for_semantic(&conversation.head_records, &conversation.tail_records);
    let doc_text = build_compact_document(&conversation.head_records, &conversation.tail_records, &insights);

    if doc_text.trim().is_empty() {
      continue;
    }

    candidates.push(SemanticCandidate {
      conversation,
      insights,
      doc_text,
    });

    if candidates.len() >= max_candidates {
      break;
    }
  }

  if candidates.is_empty() {
    return Ok(Vec::new());
  }

  let mut inputs = Vec::with_capacity(candidates.len() + 1);
  inputs.push(trimmed.to_string());
  for candidate in &candidates {
    inputs.push(candidate.doc_text.clone());
  }

  let embed_request = FastEmbedEmbedRequest {
    inputs,
    batch_size: opts.batch_size,
    normalize: opts.normalize,
    project_root: project_root_for_cache,
    cache: opts.cache,
  };

  let embeddings = fast_embed_embed(embed_request).await?;
  if embeddings.len() != candidates.len() + 1 {
    return Err(napi::Error::from_reason("Embedding API returned unexpected length"));
  }

  let (query_embedding, doc_embeddings) = embeddings.split_first().unwrap();
  let mut scored: Vec<ReverieSearchResult> = candidates
    .into_iter()
    .zip(doc_embeddings.iter())
    .map(|(candidate, embedding)| {
      let score = cosine_similarity(query_embedding, embedding);
      ReverieSearchResult {
        conversation: candidate.conversation,
        relevance_score: score,
        matching_excerpts: vec![build_excerpt(&candidate.doc_text)],
        insights: candidate.insights,
      }
    })
    .collect();

  scored.sort_by(|a, b| b
    .relevance_score
    .partial_cmp(&a.relevance_score)
    .unwrap_or(std::cmp::Ordering::Equal));
  scored.truncate(limit);

  Ok(scored)
}

#[napi]
pub async fn reverie_index_semantic(
  codex_home_path: String,
  options: Option<ReverieSemanticSearchOptions>,
) -> napi::Result<ReverieSemanticIndexStats> {
  let opts = options.unwrap_or_default();
  let max_candidates = opts.max_candidates.unwrap_or(500).max(1) as usize;
  let doc_limit = opts
    .limit
    .unwrap_or(max_candidates as i32)
    .max(1) as usize;
  let project_root = opts
    .project_root
    .as_deref()
    .map(|root| normalize_path(root));

  let codex_home = Path::new(&codex_home_path);
  let conversations = load_reverie_conversations(codex_home, max_candidates, 0)
    .await
    .map_err(|e| napi::Error::from_reason(format!("Failed to load conversations: {e}")))?;

  let mut documents = Vec::new();
  for conversation in conversations {
    if !conversation_matches_project(&conversation.head_records, project_root.as_deref()) {
      continue;
    }
    let insights = derive_insights_for_semantic(&conversation.head_records, &conversation.tail_records);
    let doc_text = build_compact_document(&conversation.head_records, &conversation.tail_records, &insights);
    if doc_text.trim().is_empty() {
      continue;
    }
    documents.push(doc_text);
    if documents.len() >= doc_limit {
      break;
    }
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
    conversations_indexed: documents.len() as i32,
    documents_embedded: documents.len() as i32,
    batches,
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

  ReverieConversation {
    id,
    path: item.path.to_string_lossy().into_owned(),
    created_at: item.created_at,
    updated_at: item.updated_at,
    head_records: serialize_json_records(&item.head),
    tail_records: serialize_json_records(&item.tail),
  }
}

fn serialize_json_records(values: &[serde_json::Value]) -> Vec<String> {
  values
    .iter()
    .map(|value| serde_json::to_string(value).unwrap_or_else(|_| value.to_string()))
    .collect()
}

struct SemanticCandidate {
  conversation: ReverieConversation,
  insights: Vec<String>,
  doc_text: String,
}

fn extract_insight_from_json(value: &serde_json::Value) -> Option<String> {
  // Extract meaningful content from JSON records
  // RolloutItem uses tag+content serde format, so data is in "payload" field

  // First try to get payload (for tag+content serde format)
  let target = value.get("payload").unwrap_or(value);

  // Try to extract content from ResponseItem::Message which has content array
  if let Some(content_array) = target.get("content").and_then(|c| c.as_array()) {
    // Extract text from ContentItem array
    let texts: Vec<String> = content_array
      .iter()
      .filter_map(|item| {
        item
          .get("text")
          .and_then(|t| t.as_str())
          .map(|s| s.to_string())
      })
      .collect();
    if !texts.is_empty() {
      return Some(texts.join(" "));
    }
  }

  // Try direct content string (for simple cases)
  if let Some(content) = target.get("content").and_then(|c| c.as_str()) {
    return Some(content.to_string());
  }

  // Try text field
  if let Some(text) = target.get("text").and_then(|t| t.as_str()) {
    return Some(text.to_string());
  }

  // Try output field (for tool results in EventMsg)
  if let Some(output) = target.get("output").and_then(|o| o.as_str()) {
    return Some(format!("Tool output: {}", output));
  }

  // Try message field in payload (for user messages in EventMsg)
  if let Some(message) = target.get("message").and_then(|m| m.as_str()) {
    return Some(message.to_string());
  }

  None
}

fn derive_insights_for_semantic(head_records: &[String], tail_records: &[String]) -> Vec<String> {
  let mut insights = Vec::new();
  for record in head_records.iter().chain(tail_records.iter()) {
    if insights.len() >= MAX_INSIGHTS_PER_CONVERSATION {
      break;
    }
    if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(record)
      && let Some(content) = extract_insight_from_json(&json_value)
    {
      insights.push(content.chars().take(400).collect());
    }
  }
  insights
}

fn build_compact_document(
  head_records: &[String],
  tail_records: &[String],
  insights: &[String],
) -> String {
  const MAX_CHARS: usize = 4000;
  let mut texts: Vec<String> = Vec::new();
  for record in head_records.iter().chain(tail_records.iter()) {
    if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(record)
      && let Some(content) = extract_insight_from_json(&json_value)
    {
      texts.push(content);
    }
  }
  texts.extend(insights.iter().cloned());
  let joined = texts.join(" ");
  truncate_to_chars(&joined, MAX_CHARS)
}

fn truncate_to_chars(input: &str, max_chars: usize) -> String {
  if input.chars().count() <= max_chars {
    return input.to_string();
  }
  input.chars().take(max_chars).collect()
}

fn conversation_matches_project(head_records: &[String], project_root: Option<&Path>) -> bool {
  let Some(root) = project_root else {
    return true;
  };
  for record in head_records {
    if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(record) {
      if let Some(cwd) = json_value
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
