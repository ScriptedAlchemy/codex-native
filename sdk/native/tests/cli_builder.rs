use codex_common::SandboxModeCliArg;
use codex_exec::Command;
use codex_native::*;
use pretty_assertions::assert_eq;
use std::path::PathBuf;

#[test]
fn test_build_cli_new_conversation() {
  let options = InternalRunRequest {
    prompt: "hello".to_string(),
    thread_id: None,
    images: vec![PathBuf::from("/test/image.png")],
    model: Some("gpt-5-codex".to_string()),
    oss: false,
    sandbox_mode: Some(SandboxModeCliArg::WorkspaceWrite),
    approval_mode: None,
    workspace_write_options: None,
    model: Some("gpt-4".to_string()),
    sandbox_mode: Some(SandboxModeCliArg::WorkspaceWrite),
    working_directory: Some(PathBuf::from("/workspace")),
    skip_git_repo_check: true,
    output_schema: None,
    base_url: None,
    api_key: None,
    linux_sandbox_path: None,
    full_auto: true,
    review_request: None,
  };

  let cli = build_cli(&options, None, false);
  assert!(cli.command.is_none());
  assert_eq!(cli.prompt, Some("hello".to_string()));
  assert_eq!(cli.images.len(), 1);
  assert_eq!(cli.model, Some("gpt-5-codex".to_string()));
  assert_eq!(cli.sandbox_mode, Some(SandboxModeCliArg::WorkspaceWrite));
  assert!(cli.full_auto);
  assert!(cli.skip_git_repo_check);
  assert!(!cli.oss);
  let cli = build_cli(&options, None);
  assert!(cli.command.is_none());
  assert_eq!(cli.prompt, Some("hello".to_string()));
  assert_eq!(cli.images.len(), 1);
  assert_eq!(cli.model, Some("gpt-4".to_string()));
  assert_eq!(cli.sandbox_mode, Some(SandboxModeCliArg::WorkspaceWrite));
  assert!(cli.full_auto);
  assert!(cli.skip_git_repo_check);
}

#[test]
fn test_build_cli_resume_conversation() {
  let options = InternalRunRequest {
    prompt: "continue".to_string(),
    thread_id: Some("thread-123".to_string()),
    images: vec![],
    model: None,
    oss: false,
    sandbox_mode: None,
    approval_mode: None,
    workspace_write_options: None,
    sandbox_mode: None,
    working_directory: None,
    skip_git_repo_check: false,
    output_schema: None,
    base_url: None,
    api_key: None,
    linux_sandbox_path: None,
    full_auto: false,
    review_request: None,
  };

  let cli = build_cli(&options, None, false);
  let cli = build_cli(&options, None);
  assert!(cli.command.is_some());
  assert_eq!(cli.prompt, None);

  if let Some(Command::Resume(resume_args)) = cli.command {
    assert_eq!(resume_args.session_id, Some("thread-123".to_string()));
    assert_eq!(resume_args.prompt, Some("continue".to_string()));
    assert!(!resume_args.last);
  } else {
    panic!("Expected Resume command");
  }
}

#[test]
fn test_build_cli_with_schema_path() {
  let schema_path = PathBuf::from("/tmp/schema.json");
  let options = InternalRunRequest {
    prompt: "test".to_string(),
    thread_id: None,
    images: vec![],
    model: None,
    oss: false,
    sandbox_mode: None,
    approval_mode: None,
    workspace_write_options: None,
    sandbox_mode: None,
    working_directory: None,
    skip_git_repo_check: false,
    output_schema: None,
    base_url: None,
    api_key: None,
    linux_sandbox_path: None,
    full_auto: false,
    review_request: None,
  };

  let cli = build_cli(&options, Some(schema_path.clone()), false);
  let cli = build_cli(&options, Some(schema_path.clone()));
  assert_eq!(cli.output_schema, Some(schema_path));
}

#[test]
fn test_build_cli_minimal() {
  let options = InternalRunRequest {
    prompt: "minimal".to_string(),
    thread_id: None,
    images: vec![],
    model: None,
    oss: false,
    sandbox_mode: None,
    approval_mode: None,
    workspace_write_options: None,
    sandbox_mode: None,
    working_directory: None,
    skip_git_repo_check: false,
    output_schema: None,
    base_url: None,
    api_key: None,
    linux_sandbox_path: None,
    full_auto: false,
    review_request: None,
  };

  let cli = build_cli(&options, None, false);
  let cli = build_cli(&options, None);
  assert!(cli.command.is_none());
  assert_eq!(cli.prompt, Some("minimal".to_string()));
  assert!(cli.images.is_empty());
  assert!(cli.model.is_none());
  assert!(!cli.full_auto);
  assert!(!cli.skip_git_repo_check);
}

#[test]
fn test_build_cli_with_oss() {
  let options = InternalRunRequest {
    prompt: "oss run".to_string(),
    thread_id: None,
    images: vec![],
    model: Some("gpt-oss:20b".to_string()),
    oss: true,
    sandbox_mode: None,
    approval_mode: None,
    workspace_write_options: None,
    working_directory: None,
    skip_git_repo_check: true,
    output_schema: None,
    base_url: None,
    api_key: None,
    linux_sandbox_path: None,
    full_auto: true,
    review_request: None,
  };
  let cli = build_cli(&options, None, false);
  assert!(cli.command.is_none());
  assert_eq!(cli.model, Some("gpt-oss:20b".to_string()));
  assert!(cli.oss, "cli.oss should be true when options.oss is true");
}
