use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use codex_native::{
  reverie_get_conversation_insights, reverie_list_conversations, reverie_search_conversations,
};
use codex_protocol::ConversationId;
use codex_protocol::models::{ContentItem, ResponseItem};
use codex_protocol::protocol::{
  EventMsg, RolloutItem, RolloutLine, SessionMeta, SessionMetaLine, SessionSource, UserMessageEvent,
};

fn write_rollout_file<P: AsRef<Path>>(path: P, items: &[RolloutLine]) {
  let parent = path.as_ref().parent().unwrap();
  fs::create_dir_all(parent).unwrap();
  let mut file = fs::File::create(path).unwrap();
  for item in items {
    let json = serde_json::to_string(item).unwrap();
    writeln!(file, "{}", json).unwrap();
  }
}

fn make_fake_codex_home() -> (tempfile::TempDir, PathBuf) {
  let tmp = tempfile::tempdir().unwrap();
  let sessions = tmp.path().join("sessions/2025/01/01");
  let uuid = "019a0000-0000-0000-0000-000000000001";
  let convo = sessions.join(format!("rollout-2025-01-01T12-00-00-{}.jsonl", uuid));
  let timestamp = "2025-01-01T12:00:00Z".to_string();

  // Create proper RolloutLine structs using the actual protocol types
  let items = vec![
    // Session metadata
    RolloutLine {
      timestamp: timestamp.clone(),
      item: RolloutItem::SessionMeta(SessionMetaLine {
        meta: SessionMeta {
          id: ConversationId::from_string(uuid).unwrap(),
          timestamp: timestamp.clone(),
          instructions: None,
          cwd: PathBuf::from("."),
          originator: "test".to_string(),
          cli_version: "0.0.0".to_string(),
          model_provider: Some("test-provider".to_string()),
          source: SessionSource::VSCode,
        },
        git: None,
      }),
    },
    // User message event
    RolloutLine {
      timestamp: "2025-01-01T12:00:01Z".to_string(),
      item: RolloutItem::EventMsg(EventMsg::UserMessage(UserMessageEvent {
        message: "We fixed the auth timeout bug by adjusting retries with reverie test keyword"
          .to_string(),
        images: None,
      })),
    },
    // Assistant response with "auth" keyword
    RolloutLine {
      timestamp: "2025-01-01T12:00:02Z".to_string(),
      item: RolloutItem::ResponseItem(ResponseItem::Message {
        id: None,
        role: "assistant".to_string(),
        content: vec![ContentItem::OutputText {
          text: "The auth timeout issue has been resolved using exponential backoff in the reverie system".to_string(),
        }],
      }),
    },
    // Another assistant response with "reverie" keyword
    RolloutLine {
      timestamp: "2025-01-01T12:00:03Z".to_string(),
      item: RolloutItem::ResponseItem(ResponseItem::Message {
        id: None,
        role: "assistant".to_string(),
        content: vec![ContentItem::OutputText {
          text: "Successfully authenticated with retry logic for reverie integration".to_string(),
        }],
      }),
    },
  ];

  write_rollout_file(&convo, &items);
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
