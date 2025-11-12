use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use codex_native::{
  reverie_get_conversation_insights, reverie_list_conversations, reverie_search_conversations,
};
use pretty_assertions::assert_eq;

fn write_jsonl<P: AsRef<Path>>(path: P, lines: &[&str]) {
  let parent = path.as_ref().parent().unwrap();
  fs::create_dir_all(parent).unwrap();
  let mut file = fs::File::create(path).unwrap();
  for line in lines {
    writeln!(file, "{}", line).unwrap();
  }
}

fn make_fake_codex_home() -> (tempfile::TempDir, PathBuf) {
  let tmp = tempfile::tempdir().unwrap();
  let sessions = tmp.path().join("sessions/2025/01/01");
  let uuid = "019a0000-0000-0000-0000-000000000001";
  let convo = sessions.join(format!("rollout-2025-01-01T12-00-00-{}.jsonl", uuid));

  // Proper rollout JSONL format with session_meta and event_msg
  write_jsonl(
    &convo,
    &[
      r#"{"timestamp":"2025-01-01T12:00:00Z","type":"session_meta","payload":{"id":"019a0000-0000-0000-0000-000000000001","timestamp":"2025-01-01T12:00:00Z","instructions":null,"cwd":".","originator":"test","cli_version":"0.0.0","model_provider":"test-provider"}}"#,
      r#"{"timestamp":"2025-01-01T12:00:01Z","type":"event_msg","payload":{"type":"user_message","message":"We fixed the auth timeout bug by adjusting retries with reverie test keyword","kind":"plain"}}"#,
      r#"{"timestamp":"2025-01-01T12:00:02Z","type":"response_item","content":"The auth timeout issue has been resolved using exponential backoff in the reverie system","role":"assistant"}"#,
      r#"{"timestamp":"2025-01-01T12:00:03Z","type":"tool_result","output":"Successfully authenticated with retry logic for reverie integration","call_id":"test-call-1"}"#,
    ],
  );

  (tmp, convo)
}

#[tokio::test]
async fn test_reverie_list_conversations_finds_file() {
  let (home, _convo) = make_fake_codex_home();
  let path = home.path().to_string_lossy().to_string();

  let list = reverie_list_conversations(path, Some(10), Some(0))
    .await
    .unwrap();
  assert!(!list.is_empty(), "expected at least one conversation");
  let first = &list[0];
  assert!(first.path.contains("rollout-2025-01-01T12-00-00"));
  assert!(first.path.ends_with(".jsonl"));
  // created_at is optional; verify head_records parsed
  assert!(!first.head_records.is_empty(), "expected head records");
}

#[tokio::test]
async fn test_reverie_search_conversations_matches_query() {
  let (home, _convo) = make_fake_codex_home();
  let path = home.path().to_string_lossy().to_string();

  let results = reverie_search_conversations(path, "reverie".to_string(), Some(10))
    .await
    .unwrap();
  assert!(!results.is_empty(), "expected at least one search result");
  let top = &results[0];
  assert!(top.relevance_score > 0.0);
  assert!(!top.matching_excerpts.is_empty());
}

#[tokio::test]
async fn test_reverie_get_conversation_insights_filters() {
  let (_home, convo) = make_fake_codex_home();
  let insights = reverie_get_conversation_insights(
    convo.to_string_lossy().to_string(),
    Some("auth".to_string()),
  )
  .await
  .unwrap();
  assert!(!insights.is_empty(), "expected at least one insight");
  assert!(insights.iter().any(|s| s.to_lowercase().contains("auth")));
}
