// Section 7: FastEmbed Integration
// ============================================================================

#[napi(object)]
pub struct FastEmbedInitOptions {
  pub model: Option<String>,
  pub cache_dir: Option<String>,
  pub max_length: Option<u32>,
  pub show_download_progress: Option<bool>,
}

#[napi(object)]
pub struct FastEmbedEmbedRequest {
  pub inputs: Vec<String>,
  pub batch_size: Option<u32>,
  pub normalize: Option<bool>,
  pub project_root: Option<String>,
  pub cache: Option<bool>,
}

struct FastEmbedState {
  namespace: String,
  embedder: Mutex<TextEmbedding>,
}

static FAST_EMBED_STATE: OnceLock<Arc<FastEmbedState>> = OnceLock::new();

#[napi(js_name = "fastEmbedInit")]
pub async fn fast_embed_init(opts: FastEmbedInitOptions) -> napi::Result<()> {
  if FAST_EMBED_STATE.get().is_some() {
    return Ok(());
  }

  let model = resolve_fastembed_model(opts.model)?;
  let mut init_options = TextInitOptions::new(model.clone());
  if let Some(max_length) = opts.max_length {
    init_options = init_options.with_max_length(max_length as usize);
  }
  if let Some(cache_dir) = opts.cache_dir.as_deref() {
    init_options = init_options.with_cache_dir(PathBuf::from(cache_dir));
  }
  if let Some(show_download_progress) = opts.show_download_progress {
    init_options = init_options.with_show_download_progress(show_download_progress);
  }

  let namespace = derive_fastembed_namespace(&init_options);
  let options_clone = init_options.clone();
  let embedder = tokio::task::spawn_blocking(move || TextEmbedding::try_new(options_clone))
    .await
    .map_err(|err| napi::Error::from_reason(format!("Failed to join FastEmbed init task: {err}")))?
    .map_err(|err| napi::Error::from_reason(format!("Failed to initialise FastEmbed: {err}")))?;

  let state = FastEmbedState {
    namespace,
    embedder: Mutex::new(embedder),
  };

  FAST_EMBED_STATE
    .set(Arc::new(state))
    .map_err(|_| napi::Error::from_reason("FastEmbed already initialised"))?;

  Ok(())
}

#[napi(js_name = "fastEmbedEmbed")]
pub async fn fast_embed_embed(req: FastEmbedEmbedRequest) -> napi::Result<Vec<Vec<f32>>> {
  let state = FAST_EMBED_STATE
    .get()
    .ok_or_else(|| napi::Error::from_reason("FastEmbed not initialised"))?
    .clone();

  if req.inputs.is_empty() {
    return Ok(Vec::new());
  }

  let use_cache = req.cache.unwrap_or(true);
  let cache = if use_cache {
    EmbeddingCache::new(&state.namespace, req.project_root.as_deref()).await?
  } else {
    None
  };

  let mut raw_vectors: Vec<Option<Vec<f32>>> = vec![None; req.inputs.len()];
  let mut missing_indices = Vec::new();
  let mut missing_texts = Vec::new();

  if let Some(cache_ref) = cache.as_ref() {
    for (idx, text) in req.inputs.iter().enumerate() {
      if let Some(vector) = cache_ref.read(text).await {
        raw_vectors[idx] = Some(vector);
      } else {
        missing_indices.push(idx);
        missing_texts.push(text.clone());
      }
    }
  } else {
    missing_indices.extend(0..req.inputs.len());
    missing_texts = req.inputs.clone();
  }

  if !missing_texts.is_empty() {
    let batch_size = req.batch_size.map(|value| value as usize);
    let embeddings = tokio::task::spawn_blocking({
      let state = state.clone();
      move || {
        let mut embedder = state.embedder.lock().expect("FastEmbed mutex poisoned");
        embedder
          .embed(missing_texts, batch_size)
          .map_err(|err| napi::Error::from_reason(format!("FastEmbed embed failed: {err}")))
      }
    })
    .await
    .map_err(|err| napi::Error::from_reason(format!("FastEmbed task join error: {err}")))??;

    for (offset, vector) in embeddings.into_iter().enumerate() {
      let idx = missing_indices[offset];
      if let Some(cache_ref) = cache.as_ref() {
        cache_ref.write(&req.inputs[idx], &vector).await;
      }
      raw_vectors[idx] = Some(vector);
    }
  }

  let mut outputs = Vec::with_capacity(req.inputs.len());
  for maybe_vector in raw_vectors.into_iter() {
    let mut vector = maybe_vector
      .ok_or_else(|| napi::Error::from_reason("Missing embedding after FastEmbed inference"))?;
    if req.normalize.unwrap_or(false) {
      normalize_vector(&mut vector);
    }
    outputs.push(vector);
  }

  Ok(outputs)
}

fn resolve_fastembed_model(model: Option<String>) -> napi::Result<EmbeddingModel> {
  match model {
    None => Ok(EmbeddingModel::default()),
    Some(name) => {
      let trimmed = name.trim();
      let sanitized = sanitize_model_identifier(trimmed);
      if let Ok(parsed) = sanitized.parse::<EmbeddingModel>() {
        return Ok(parsed);
      }
      if let Some(matched) = match_supported_model(&sanitized) {
        return Ok(matched);
      }
      Err(napi::Error::from_reason(format!(
        "Unknown FastEmbed model '{trimmed}'. Run fastembed::TextEmbedding::list_supported_models() to inspect supported identifiers."
      )))
    }
  }
}

fn sanitize_model_identifier(input: &str) -> String {
  let lowercase = input.trim();
  if lowercase
    .to_ascii_lowercase()
    .starts_with("baai/bge-")
  {
    let suffix = lowercase
      .split_once('/')
      .map(|(_, right)| right)
      .unwrap_or(lowercase);
    format!("Xenova/{suffix}")
  } else {
    lowercase.to_string()
  }
}

fn match_supported_model(identifier: &str) -> Option<EmbeddingModel> {
  let id_lower = identifier.to_ascii_lowercase();
  let supported = TextEmbedding::list_supported_models();
  for info in supported {
    let code = info.model_code.to_ascii_lowercase();
    if code == id_lower || code.ends_with(&id_lower) || id_lower.ends_with(&code) {
      return Some(info.model);
    }
  }
  None
}

struct EmbeddingCache {
  directory: PathBuf,
}

impl EmbeddingCache {
  async fn new(namespace: &str, project_root: Option<&str>) -> napi::Result<Option<Self>> {
    let Some(codex_home) = resolve_codex_home_for_cache() else {
      return Ok(None);
    };
    let Some(project_key_source) = resolve_project_root_string(project_root) else {
      return Ok(None);
    };
    let project_hash = hash_string(&project_key_source);
    let directory = codex_home
      .join("embeddings")
      .join(project_hash)
      .join(namespace);
    tokio::fs::create_dir_all(&directory).await.map_err(|err| {
      napi::Error::from_reason(format!(
        "Failed to prepare embedding cache directory {}: {err}",
        directory.display()
      ))
    })?;
    Ok(Some(Self { directory }))
  }

  async fn read(&self, text: &str) -> Option<Vec<f32>> {
    let key = hash_string(text);
    let path = self.directory.join(format!("{key}.json"));
    match tokio::fs::read(&path).await {
      Ok(bytes) => match serde_json::from_slice::<Vec<f32>>(&bytes) {
        Ok(vector) => Some(vector),
        Err(err) => {
          eprintln!(
            "codex-native: failed to parse embedding cache {}: {err}",
            path.display()
          );
          None
        }
      },
      Err(err) if err.kind() == io::ErrorKind::NotFound => None,
      Err(err) => {
        eprintln!(
          "codex-native: failed to read embedding cache {}: {err}",
          path.display()
        );
        None
      }
    }
  }

  async fn write(&self, text: &str, vector: &[f32]) {
    let key = hash_string(text);
    let file_name = format!("{key}.json");
    let path = self.directory.join(&file_name);
    let temp_name = format!("{file_name}.tmp-{}", Uuid::new_v4());
    let temp_path = self.directory.join(temp_name);
    let payload = match serde_json::to_vec(vector) {
      Ok(bytes) => bytes,
      Err(err) => {
        eprintln!("codex-native: failed to serialize embedding cache entry: {err}");
        return;
      }
    };
    if let Err(err) = tokio::fs::write(&temp_path, payload).await {
      eprintln!(
        "codex-native: failed to write temporary embedding cache file {}: {err}",
        temp_path.display()
      );
      return;
    }
    if let Err(err) = tokio::fs::rename(&temp_path, &path).await {
      let _ = tokio::fs::remove_file(&temp_path).await;
      eprintln!(
        "codex-native: failed to finalise embedding cache file {}: {err}",
        path.display()
      );
    }
  }
}

fn resolve_codex_home_for_cache() -> Option<PathBuf> {
  if let Ok(path) = find_codex_home() {
    return Some(path);
  }
  if let Ok(home) = std::env::var("HOME") {
    return Some(PathBuf::from(home).join(".codex"));
  }
  None
}

fn resolve_project_root_string(project_root: Option<&str>) -> Option<String> {
  if let Some(root) = project_root {
    return Some(canonicalize_to_string(Path::new(root)));
  }
  let cwd = std::env::current_dir().ok()?;
  Some(canonicalize_to_string(&cwd))
}

fn canonicalize_to_string(path: &Path) -> String {
  match std::fs::canonicalize(path) {
    Ok(canonical) => canonical.to_string_lossy().into_owned(),
    Err(_) => path.to_string_lossy().into_owned(),
  }
}

fn hash_string(value: &str) -> String {
  let mut hasher = Sha1::new();
  hasher.update(value.as_bytes());
  format!("{:x}", hasher.finalize())
}

fn derive_fastembed_namespace(opts: &TextInitOptions) -> String {
  let descriptor = format!(
    "fastembed|{}|{}|{}|{}",
    opts.model_name,
    opts.max_length,
    opts.cache_dir.display(),
    opts.show_download_progress
  );
  hash_string(&descriptor)
}

fn normalize_vector(vec: &mut [f32]) {
  let norm = vec
    .iter()
    .fold(0f64, |sum, value| sum + (*value as f64) * (*value as f64))
    .sqrt();
  if norm > 0.0 {
    for value in vec {
      *value = (*value as f64 / norm) as f32;
    }
  }
}

// ============================================================================
