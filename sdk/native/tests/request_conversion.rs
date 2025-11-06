use codex_common::SandboxModeCliArg;
use codex_native::*;
use pretty_assertions::assert_eq;
use serde_json::json;
use std::path::PathBuf;

#[test]
fn test_run_request_into_internal_default_values() {
  let req = RunRequest {
    prompt: "test prompt".to_string(),
    thread_id: None,
    images: None,
    model: None,
    sandbox_mode: None,
    working_directory: None,
    skip_git_repo_check: None,
    output_schema: None,
    base_url: None,
    api_key: None,
    linux_sandbox_path: None,
    full_auto: None,
    review_mode: None,
    review_hint: None,
  };

  let internal = req.into_internal().unwrap();
  assert_eq!(internal.prompt, "test prompt");
  assert!(internal.thread_id.is_none());
  assert_eq!(internal.images.len(), 0);
  assert!(!internal.skip_git_repo_check);
  assert!(!internal.full_auto);
  assert!(internal.review_request.is_none());
}

#[test]
fn test_run_request_with_images() {
  let req = RunRequest {
    prompt: "test".to_string(),
    thread_id: None,
    images: Some(vec![
      "/path/to/image1.png".to_string(),
      "/path/to/image2.jpg".to_string(),
    ]),
    model: None,
    sandbox_mode: None,
    working_directory: None,
    skip_git_repo_check: None,
    output_schema: None,
    base_url: None,
    api_key: None,
    linux_sandbox_path: None,
    full_auto: None,
    review_mode: None,
    review_hint: None,
  };

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
    let req = RunRequest {
      prompt: "test".to_string(),
      thread_id: None,
      images: None,
      model: None,
      sandbox_mode: Some(mode_str.to_string()),
      working_directory: None,
      skip_git_repo_check: None,
      output_schema: None,
      base_url: None,
      api_key: None,
      linux_sandbox_path: None,
      full_auto: None,
      review_mode: None,
      review_hint: None,
    };

    let internal = req.into_internal().unwrap();
    assert_eq!(internal.sandbox_mode, Some(expected));
  }
}

#[test]
fn test_run_request_invalid_sandbox_mode() {
  let req = RunRequest {
    prompt: "test".to_string(),
    thread_id: None,
    images: None,
    model: None,
    sandbox_mode: Some("invalid-mode".to_string()),
    working_directory: None,
    skip_git_repo_check: None,
    output_schema: None,
    base_url: None,
    api_key: None,
    linux_sandbox_path: None,
    full_auto: None,
    review_mode: None,
    review_hint: None,
  };

  let result = req.into_internal();
  assert!(result.is_err());
  let err = result.unwrap_err();
  assert!(err.reason.contains("Unsupported sandbox mode"));
}

#[test]
fn test_run_request_review_mode_with_empty_prompt() {
  let req = RunRequest {
    prompt: "   ".to_string(),
    thread_id: None,
    images: None,
    model: None,
    sandbox_mode: None,
    working_directory: None,
    skip_git_repo_check: None,
    output_schema: None,
    base_url: None,
    api_key: None,
    linux_sandbox_path: None,
    full_auto: None,
    review_mode: Some(true),
    review_hint: None,
  };

  let result = req.into_internal();
  assert!(result.is_err());
  let err = result.unwrap_err();
  assert!(
    err
      .reason
      .contains("Review mode requires a non-empty prompt")
  );
}

#[test]
fn test_run_request_review_mode_with_prompt() {
  let req = RunRequest {
    prompt: "review this code".to_string(),
    thread_id: None,
    images: None,
    model: None,
    sandbox_mode: None,
    working_directory: None,
    skip_git_repo_check: None,
    output_schema: None,
    base_url: None,
    api_key: None,
    linux_sandbox_path: None,
    full_auto: None,
    review_mode: Some(true),
    review_hint: Some("security review".to_string()),
  };

  let internal = req.into_internal().unwrap();
  assert!(internal.review_request.is_some());
  let review = internal.review_request.unwrap();
  assert_eq!(review.prompt, "review this code");
  assert_eq!(review.user_facing_hint, "security review");
}

#[test]
fn test_run_request_review_mode_default_hint() {
  let req = RunRequest {
    prompt: "review this".to_string(),
    thread_id: None,
    images: None,
    model: None,
    sandbox_mode: None,
    working_directory: None,
    skip_git_repo_check: None,
    output_schema: None,
    base_url: None,
    api_key: None,
    linux_sandbox_path: None,
    full_auto: None,
    review_mode: Some(true),
    review_hint: None,
  };

  let internal = req.into_internal().unwrap();
  assert!(internal.review_request.is_some());
  let review = internal.review_request.unwrap();
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

  let req = RunRequest {
    prompt: "test".to_string(),
    thread_id: None,
    images: None,
    model: None,
    sandbox_mode: None,
    working_directory: None,
    skip_git_repo_check: None,
    output_schema: Some(schema.clone()),
    base_url: None,
    api_key: None,
    linux_sandbox_path: None,
    full_auto: None,
    review_mode: None,
    review_hint: None,
  };

  let internal = req.into_internal().unwrap();
  assert_eq!(internal.output_schema, Some(schema));
}
