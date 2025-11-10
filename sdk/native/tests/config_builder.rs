use codex_common::SandboxModeCliArg;
use codex_core::protocol::AskForApproval;
use codex_native::*;
use codex_protocol::config_types::SandboxMode;
use pretty_assertions::assert_eq;
use std::path::PathBuf;

#[test]
fn test_build_config_overrides_full_auto() {
  let options = InternalRunRequest {
    prompt: "test".to_string(),
    thread_id: None,
    images: vec![],
    model: Some("gpt-4".to_string()),
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
    full_auto: true,
    review_request: None,
  };

  let overrides = build_config_overrides(&options, None);
  assert_eq!(overrides.sandbox_mode, Some(SandboxMode::WorkspaceWrite));
  assert_eq!(overrides.model, Some("gpt-4".to_string()));
  assert_eq!(overrides.approval_policy, Some(AskForApproval::Never));
}

#[test]
fn test_build_config_overrides_with_sandbox_mode() {
  let options = InternalRunRequest {
    prompt: "test".to_string(),
    thread_id: None,
    images: vec![],
    model: None,
    oss: false,
    sandbox_mode: Some(SandboxModeCliArg::ReadOnly),
    approval_mode: None,
    workspace_write_options: None,
    sandbox_mode: Some(SandboxModeCliArg::ReadOnly),
    working_directory: None,
    skip_git_repo_check: false,
    output_schema: None,
    base_url: None,
    api_key: None,
    linux_sandbox_path: None,
    full_auto: false,
    review_request: None,
  };

  let overrides = build_config_overrides(&options, None);
  assert_eq!(overrides.sandbox_mode, Some(SandboxMode::ReadOnly));
}

#[test]
fn test_build_config_overrides_with_working_directory() {
  let working_dir = std::env::current_dir().unwrap();
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
    working_directory: Some(working_dir.clone()),
    skip_git_repo_check: false,
    output_schema: None,
    base_url: None,
    api_key: None,
    linux_sandbox_path: None,
    full_auto: false,
    review_request: None,
  };

  let overrides = build_config_overrides(&options, None);
  assert_eq!(overrides.cwd, Some(working_dir));
}

#[test]
fn test_build_config_overrides_with_sandbox_path() {
  let sandbox_path = PathBuf::from("/path/to/sandbox");
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

  let overrides = build_config_overrides(&options, Some(sandbox_path.clone()));
  assert_eq!(overrides.codex_linux_sandbox_exe, Some(sandbox_path));
}
