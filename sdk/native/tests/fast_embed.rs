use codex_native::{
  FastEmbedEmbedRequest, FastEmbedInitOptions, fast_embed_embed, fast_embed_init,
};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fast_embed_small_model_produces_normalized_vectors() {
  let codex_home = tempfile::tempdir().expect("failed to create codex home");
  // SAFETY: tests run single-threaded and need a scoped CODEX_HOME override.
  unsafe {
    std::env::set_var("CODEX_HOME", codex_home.path());
  }

  let cache_dir = tempfile::tempdir().expect("failed to create model cache");
  fast_embed_init(FastEmbedInitOptions {
    model: Some("BAAI/bge-small-en-v1.5".to_string()),
    cache_dir: Some(cache_dir.path().to_string_lossy().into_owned()),
    max_length: Some(512),
    show_download_progress: Some(false),
  })
  .await
  .expect("fast_embed_init failed");

  let project_dir = tempfile::tempdir().expect("failed to create project dir");
  let project_path = project_dir.path().to_string_lossy().into_owned();
  let request = FastEmbedEmbedRequest {
    inputs: vec![
      "passage: resolve thread fork channel errors".to_string(),
      "query: channel closes prematurely".to_string(),
    ],
    batch_size: Some(2),
    normalize: Some(true),
    project_root: Some(project_path),
    cache: Some(true),
  };

  let embeddings = fast_embed_embed(request)
    .await
    .expect("fast_embed_embed failed");
  assert_eq!(embeddings.len(), 2);

  for vector in embeddings {
    assert!(vector.len() > 0, "expected non-empty embedding vector");
    let norm: f64 = vector
      .iter()
      .map(|value| (*value as f64) * (*value as f64))
      .sum::<f64>()
      .sqrt();
    assert!(
      (norm - 1.0).abs() < 1e-3,
      "expected normalized vector, got norm {norm}"
    );
  }

  // Keep directories alive until the end of the test
  drop(project_dir);
}
