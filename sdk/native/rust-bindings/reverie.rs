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
