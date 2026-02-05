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
    if !conversation_matches_project(
      conversation.cwd.as_deref(),
      &conversation.head_records,
      normalized_project_root.as_deref(),
    ) {
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
    if !conversation_matches_project(
      conversation.cwd.as_deref(),
      &conversation.head_records,
      project_root.as_deref(),
    ) {
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
