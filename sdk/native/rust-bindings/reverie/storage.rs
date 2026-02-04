async fn load_reverie_conversations(
  codex_home: &Path,
  limit: usize,
  offset: usize,
) -> std::io::Result<Vec<ReverieConversation>> {
  if limit == 0 {
    return Ok(Vec::new());
  }

  let page_size = limit.saturating_add(offset).max(1);
  let page = RolloutRecorder::list_threads(
    codex_home,
    page_size,
    None,
    codex_core::ThreadSortKey::UpdatedAt,
    &[],
    None,
    OLLAMA_OSS_PROVIDER_ID,
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

fn conversation_item_to_reverie(item: codex_core::ThreadItem) -> ReverieConversation {
  let id = item
    .path
    .file_stem()
    .and_then(|s| s.to_str())
    .unwrap_or("unknown")
    .to_string();

  const TAIL_RECORD_LIMIT: usize = 10;
  let (head_records, head_records_toon) = serialize_records(&item.head);
  let tail_values = read_tail_records(&item.path, TAIL_RECORD_LIMIT);
  let (tail_records, tail_records_toon) = serialize_records(&tail_values);

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

fn read_tail_records(path: &Path, limit: usize) -> Vec<serde_json::Value> {
  let file = match File::open(path) {
    Ok(file) => file,
    Err(_) => return Vec::new(),
  };

  let reader = BufReader::new(file);
  let mut deque: VecDeque<serde_json::Value> = VecDeque::with_capacity(limit);

  for line in reader.lines().map_while(Result::ok) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
      continue;
    }

    let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) else {
      continue;
    };

    let record_val = val.get("item").cloned().unwrap_or(val);
    deque.push_back(record_val);
    if deque.len() > limit {
      deque.pop_front();
    }
  }

  deque.into_iter().collect()
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
