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

fn conversation_matches_project(
  conversation_cwd: Option<&str>,
  head_records: &[String],
  project_root: Option<&Path>,
) -> bool {
  let Some(root) = project_root else {
    return true;
  };

  if let Some(cwd) = conversation_cwd {
    let candidate = normalize_path(cwd);
    if path_starts_with(&candidate, root) {
      return true;
    }
  }

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

#[cfg(test)]
mod json_utils_tests {
  use super::conversation_matches_project;
  use std::path::Path;

  #[test]
  fn project_match_prefers_conversation_cwd() {
    let matches = conversation_matches_project(
      Some("/tmp/workspace/project"),
      &[],
      Some(Path::new("/tmp/workspace")),
    );
    assert!(matches);
  }

  #[test]
  fn project_match_uses_meta_cwd_from_records() {
    let head_records = vec![r#"{"meta":{"cwd":"/tmp/workspace/project"}}"#.to_string()];
    let matches = conversation_matches_project(None, &head_records, Some(Path::new("/tmp/workspace")));
    assert!(matches);
  }

  #[test]
  fn project_match_ignores_legacy_payload_cwd() {
    let head_records = vec![r#"{"payload":{"cwd":"/tmp/workspace/project"}}"#.to_string()];
    let matches = conversation_matches_project(None, &head_records, Some(Path::new("/tmp/workspace")));
    assert!(!matches);
  }
}
