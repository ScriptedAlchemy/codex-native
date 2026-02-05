use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use codex_native::{
  FastEmbedInitOptions, ReverieSemanticSearchOptions, clear_fast_embed_rerank_hook,
  fast_embed_init, reverie_get_conversation_insights, reverie_index_semantic,
  reverie_list_conversations, reverie_search_conversations, reverie_search_semantic,
  set_fast_embed_rerank_hook,
};
use codex_protocol::ThreadId;
use codex_protocol::models::{ContentItem, ResponseItem};
use codex_protocol::protocol::{
  EventMsg, RolloutItem, RolloutLine, SessionMeta, SessionMetaLine, SessionSource, UserMessageEvent,
};
use fastembed::RerankResult;
use tokio::sync::{Mutex, OnceCell};

static FAST_EMBED_ONCE: OnceCell<()> = OnceCell::const_new();
static RERANK_HOOK_LOCK: Mutex<()> = Mutex::const_new(());

async fn ensure_fast_embed_initialized() {
  FAST_EMBED_ONCE
    .get_or_init(|| async {
      let cache_dir = tempfile::tempdir().unwrap();
      let cache_path = cache_dir.path().to_string_lossy().to_string();
      std::mem::forget(cache_dir);

      fast_embed_init(FastEmbedInitOptions {
        model: Some("BAAI/bge-small-en-v1.5".to_string()),
        cache_dir: Some(cache_path),
        max_length: Some(512),
        show_download_progress: Some(false),
        use_coreml: Some(false),
        coreml_ane_only: Some(false),
      })
      .await
      .unwrap();
    })
    .await;
}

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
          id: ThreadId::from_string(uuid).unwrap(),
          forked_from_id: None,
          timestamp: timestamp.clone(),
          cwd: tmp.path().to_path_buf(),
          originator: "test".to_string(),
          cli_version: "0.0.0".to_string(),
          model_provider: Some("test-provider".to_string()),
          source: SessionSource::VSCode,
          base_instructions: None,
          dynamic_tools: None,
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
        local_images: Vec::new(),
        text_elements: Vec::new(),
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
        end_turn: None,
        phase: None,
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
        end_turn: None,
        phase: None,
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
  assert_eq!(
    first.cwd.as_deref(),
    Some(home.path().to_string_lossy().as_ref())
  );
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

#[tokio::test]
async fn test_reverie_search_semantic_matches_context() {
  let (home, _convo) = make_fake_codex_home();
  let path = home.path().to_string_lossy().to_string();

  ensure_fast_embed_initialized().await;

  let options = ReverieSemanticSearchOptions {
    limit: Some(5),
    max_candidates: Some(10),
    project_root: Some(home.path().to_string_lossy().to_string()),
    batch_size: None,
    normalize: Some(true),
    cache: Some(true),
    ..Default::default()
  };

  let results = reverie_search_semantic(path, "auth timeout debugging".to_string(), Some(options))
    .await
    .unwrap();
  assert!(!results.is_empty(), "expected semantic matches");
  assert!(results[0].relevance_score > 0.0);
}

#[tokio::test]
async fn test_reverie_index_semantic_populates_cache() {
  let (home, _convo) = make_fake_codex_home();
  let path = home.path().to_string_lossy().to_string();

  ensure_fast_embed_initialized().await;

  let stats = reverie_index_semantic(
    path,
    Some(ReverieSemanticSearchOptions {
      limit: Some(5),
      max_candidates: Some(5),
      project_root: None,
      batch_size: Some(8),
      normalize: Some(true),
      cache: Some(true),
      ..Default::default()
    }),
  )
  .await
  .unwrap();
  assert!(
    stats.documents_embedded > 0,
    "expected embeddings to be generated"
  );
  assert!(stats.batches >= 1);
}

#[tokio::test]
async fn test_reverie_search_semantic_empty_query_short_circuits() {
  let (home, _convo) = make_fake_codex_home();
  let path = home.path().to_string_lossy().to_string();

  let results = reverie_search_semantic(path, "   ".to_string(), None)
    .await
    .unwrap();
  assert!(
    results.is_empty(),
    "whitespace-only queries should return no matches"
  );
}

#[tokio::test]
async fn test_reverie_search_semantic_filters_project_root() {
  let (home, _convo) = make_fake_codex_home();
  let path = home.path().to_string_lossy().to_string();
  ensure_fast_embed_initialized().await;

  let unrelated_root = tempfile::tempdir().unwrap();
  let options = ReverieSemanticSearchOptions {
    limit: Some(5),
    max_candidates: Some(10),
    project_root: Some(unrelated_root.path().to_string_lossy().to_string()),
    batch_size: None,
    normalize: Some(true),
    cache: Some(true),
    ..Default::default()
  };

  let results = reverie_search_semantic(path, "auth timeout".to_string(), Some(options))
    .await
    .unwrap();
  assert!(
    results.is_empty(),
    "conversations outside project root should be filtered out"
  );
}

#[tokio::test]
async fn test_reverie_search_semantic_respects_reranker_hook() {
  let _lock = RERANK_HOOK_LOCK.lock().await;
  let (home, _convo) = make_fake_codex_home();
  let sessions_dir = home.path().join("sessions/2025/01/01");
  let priority_uuid = "019a0000-0000-0000-0000-000000000002";
  let priority_path = sessions_dir.join(format!(
    "rollout-2025-01-01T12-05-00-{}.jsonl",
    priority_uuid
  ));
  let timestamp = "2025-01-01T12:05:00Z".to_string();
  let priority_items = vec![
    RolloutLine {
      timestamp: timestamp.clone(),
      item: RolloutItem::SessionMeta(SessionMetaLine {
        meta: SessionMeta {
          id: ThreadId::from_string(priority_uuid).unwrap(),
          forked_from_id: None,
          timestamp: timestamp.clone(),
          cwd: home.path().to_path_buf(),
          originator: "test".to_string(),
          cli_version: "0.0.0".to_string(),
          model_provider: Some("test-provider".to_string()),
          source: SessionSource::VSCode,
          base_instructions: None,
          dynamic_tools: None,
        },
        git: None,
      }),
    },
    RolloutLine {
      timestamp: "2025-01-01T12:05:01Z".to_string(),
      item: RolloutItem::EventMsg(EventMsg::UserMessage(UserMessageEvent {
        message: "Need reverie priority hints for critical migration blockers with schema drift".to_string(),
        images: None,
        local_images: Vec::new(),
        text_elements: Vec::new(),
      })),
    },
    RolloutLine {
      timestamp: "2025-01-01T12:05:02Z".to_string(),
      item: RolloutItem::ResponseItem(ResponseItem::Message {
        id: None,
        role: "assistant".to_string(),
        content: vec![ContentItem::OutputText {
          text: "Root-caused the reverie priority migration issue by replaying the hints about rollback order"
            .to_string(),
        }],
        end_turn: None,
        phase: None,
      }),
    },
  ];
  write_rollout_file(&priority_path, &priority_items);

  ensure_fast_embed_initialized().await;

  struct HookGuard;
  impl Drop for HookGuard {
    fn drop(&mut self) {
      clear_fast_embed_rerank_hook();
    }
  }
  let _guard = HookGuard;

  set_fast_embed_rerank_hook(|_, _, documents, _, top_k| {
    let mut results: Vec<RerankResult> = documents
      .into_iter()
      .enumerate()
      .map(|(index, doc)| {
        let score = if doc.contains("reverie priority migration issue") {
          0.99
        } else {
          0.1 + (index as f32 * 0.01)
        };
        RerankResult {
          document: None,
          score,
          index,
        }
      })
      .collect();
    results.sort_by(|a, b| b.score.total_cmp(&a.score));
    if let Some(top_k) = top_k {
      results.truncate(top_k.min(results.len()));
    }
    Ok(results)
  })
  .unwrap();

  let path = home.path().to_string_lossy().to_string();
  let options = ReverieSemanticSearchOptions {
    limit: Some(3),
    max_candidates: Some(10),
    project_root: Some(home.path().to_string_lossy().to_string()),
    batch_size: None,
    normalize: Some(true),
    cache: Some(true),
    reranker_model: Some("rozgo/bge-reranker-v2-m3".to_string()),
    reranker_batch_size: Some(4),
    reranker_top_k: Some(1),
    ..Default::default()
  };

  let results = reverie_search_semantic(
    path,
    "critical reverie priority migration hints".to_string(),
    Some(options),
  )
  .await
  .unwrap();

  assert!(
    !results.is_empty(),
    "expected matches with reranker enabled"
  );
  let top = &results[0];
  assert!(
    top.conversation.id.contains(priority_uuid),
    "expected priority conversation to rank first"
  );
  assert!(
    results.iter().any(|entry| entry.reranker_score.is_some()),
    "expected reranker score to be propagated"
  );
}

#[tokio::test]
async fn test_reverie_search_semantic_reranker_failure_falls_back() {
  let _lock = RERANK_HOOK_LOCK.lock().await;
  let (home, _convo) = make_fake_codex_home();
  let path = home.path().to_string_lossy().to_string();

  ensure_fast_embed_initialized().await;

  struct HookGuard;
  impl Drop for HookGuard {
    fn drop(&mut self) {
      clear_fast_embed_rerank_hook();
    }
  }
  let _guard = HookGuard;

  set_fast_embed_rerank_hook(|_, _, _documents, _, _top_k| {
    Err(napi::Error::from_reason("test reranker failure"))
  })
  .unwrap();

  let options = ReverieSemanticSearchOptions {
    limit: Some(5),
    max_candidates: Some(10),
    project_root: Some(home.path().to_string_lossy().to_string()),
    batch_size: None,
    normalize: Some(true),
    cache: Some(true),
    reranker_model: Some("rozgo/bge-reranker-v2-m3".to_string()),
    reranker_batch_size: Some(4),
    reranker_top_k: Some(2),
    ..Default::default()
  };

  let results = reverie_search_semantic(path, "auth timeout debugging".to_string(), Some(options))
    .await
    .unwrap();

  assert!(
    !results.is_empty(),
    "semantic search should still succeed when reranker fails"
  );
  assert!(
    results.iter().all(|entry| entry.reranker_score.is_none()),
    "results should not include reranker scores when reranker fails"
  );
}
