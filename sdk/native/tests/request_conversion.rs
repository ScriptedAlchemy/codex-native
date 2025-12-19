use codex_common::SandboxModeCliArg;
use codex_native::*;
use pretty_assertions::assert_eq;
use serde_json::json;
use std::path::PathBuf;

fn base_run_request(prompt: &str) -> RunRequest {
  RunRequest {
    prompt: prompt.to_string(),
    input_items: None,
    thread_id: None,
    images: None,
    model: None,
    model_provider: None,
    approval_mode: None,
    workspace_write_options: None,
    oss: None,
    sandbox_mode: None,
    working_directory: None,
    skip_git_repo_check: None,
    output_schema: None,
    base_url: None,
    api_key: None,
    linux_sandbox_path: None,
    reasoning_effort: None,
    reasoning_summary: None,
    full_auto: None,
    review_mode: None,
    review_hint: None,
  }
}

#[test]
fn test_run_request_into_internal_default_values() {
  let req = base_run_request("test prompt");
  let internal = req.into_internal().unwrap();
  assert_eq!(internal.prompt, "test prompt");
  assert!(internal.input_items.is_none());
  assert!(internal.thread_id.is_none());
  assert!(internal.images.is_empty());
  assert!(!internal.skip_git_repo_check);
  assert!(internal.full_auto);
  assert!(internal.review_request.is_none());
  assert!(internal.reasoning_effort.is_none());
  assert!(internal.reasoning_summary.is_none());
}

#[test]
fn test_run_request_with_images() {
  let mut req = base_run_request("test");
  req.images = Some(vec![
    "/path/to/image1.png".to_string(),
    "/path/to/image2.jpg".to_string(),
  ]);

  let internal = req.into_internal().unwrap();
  assert_eq!(internal.images.len(), 2);
  assert_eq!(internal.images[0], PathBuf::from("/path/to/image1.png"));
  assert_eq!(internal.images[1], PathBuf::from("/path/to/image2.jpg"));
}

#[test]
fn test_run_request_sandbox_mode_conversions() {
  let modes = vec![
    ("read-only", SandboxModeCliArg::ReadOnly),
    ("workspace-write", SandboxModeCliArg::WorkspaceWrite),
    ("danger-full-access", SandboxModeCliArg::DangerFullAccess),
  ];

  for (mode_str, expected) in modes {
    let mut req = base_run_request("test");
    req.sandbox_mode = Some(mode_str.to_string());

    let internal = req.into_internal().unwrap();
    assert_eq!(internal.sandbox_mode, Some(expected));
  }
}

#[test]
fn test_run_request_invalid_sandbox_mode() {
  let mut req = base_run_request("test");
  req.sandbox_mode = Some("invalid-mode".to_string());

  let err = req.into_internal().unwrap_err();
  #[cfg(feature = "napi-bindings")]
  {
    assert!(err.reason.contains("Unsupported sandbox mode"));
  }
  #[cfg(not(feature = "napi-bindings"))]
  {
    assert!(err.contains("Unsupported sandbox mode"));
  }
}

#[test]
fn test_run_request_review_mode_with_empty_prompt() {
  let mut req = base_run_request("   ");
  req.review_mode = Some(true);

  let err = req.into_internal().unwrap_err();
  #[cfg(feature = "napi-bindings")]
  {
    assert!(
      err
        .reason
        .contains("Review mode requires a non-empty prompt"),
    );
  }
  #[cfg(not(feature = "napi-bindings"))]
  {
    assert!(err.contains("Review mode requires a non-empty prompt"));
  }
}

#[test]
fn test_run_request_review_mode_with_prompt() {
  let mut req = base_run_request("review this code");
  req.review_mode = Some(true);
  req.review_hint = Some("security review".to_string());

  let internal = req.into_internal().unwrap();
  let review = internal.review_request.expect("expected review request");
  assert_eq!(review.prompt, "review this code");
  assert_eq!(review.user_facing_hint, "security review");
}

#[test]
fn test_run_request_review_mode_default_hint() {
  let mut req = base_run_request("review this");
  req.review_mode = Some(true);

  let internal = req.into_internal().unwrap();
  let review = internal.review_request.expect("expected review request");
  assert_eq!(review.user_facing_hint, "code review");
}

#[test]
fn test_run_request_with_output_schema() {
  let schema = json!({
    "type": "object",
    "properties": {
      "result": {"type": "string"}
    }
  });

  let mut req = base_run_request("test");
  req.output_schema = Some(schema.clone());

  let internal = req.into_internal().unwrap();
  assert_eq!(internal.output_schema, Some(schema));
}
