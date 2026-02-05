use std::collections::HashSet;
use std::collections::VecDeque;
use std::fs::File;
use std::io::{BufRead, BufReader};
use chrono::{DateTime, Utc};
use codex_core::OLLAMA_OSS_PROVIDER_ID;


#[derive(Clone)]
#[napi(object)]
pub struct ReverieConversation {
  pub id: String,
  pub path: String,
  pub cwd: Option<String>,
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
