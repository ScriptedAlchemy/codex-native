use codex_common::SandboxModeCliArg;
use codex_exec::Command;
use codex_native::*;
use pretty_assertions::assert_eq;
use std::path::PathBuf;

fn base_internal_request() -> InternalRunRequest {
  InternalRunRequest {
    prompt: "placeholder".to_string(),
    input_items: None,
    thread_id: None,
    images: Vec::new(),
    model: None,
    model_provider: None,
    oss: false,
    sandbox_mode: None,
    approval_mode: None,
    workspace_write_options: None,
    review_request: None,
    working_directory: None,
    skip_git_repo_check: false,
    output_schema: None,
    base_url: None,
    api_key: None,
    linux_sandbox_path: None,
    reasoning_effort: None,
    reasoning_summary: None,
    full_auto: true,
  }
}

#[test]
fn test_build_cli_new_conversation() {
  let mut options = base_internal_request();
  options.prompt = "hello".to_string();
  options.images = vec![PathBuf::from("/test/image.png")];
  options.model = Some("gpt-5-codex".to_string());
  options.sandbox_mode = Some(SandboxModeCliArg::WorkspaceWrite);
  options.working_directory = Some(PathBuf::from("/workspace"));
  options.skip_git_repo_check = true;

  let cli = build_cli(&options, None, false);
  assert!(cli.command.is_none());
  assert_eq!(cli.prompt, Some("hello".to_string()));
  assert_eq!(cli.images.len(), 1);
  assert_eq!(cli.model, Some("gpt-5-codex".to_string()));
  assert_eq!(cli.sandbox_mode, Some(SandboxModeCliArg::WorkspaceWrite));
  assert!(cli.full_auto);
  assert!(cli.skip_git_repo_check);
  assert!(!cli.oss);
}

#[test]
fn test_build_cli_resume_conversation() {
  let mut options = base_internal_request();
  options.prompt = "continue".to_string();
  options.thread_id = Some("thread-123".to_string());

  let cli = build_cli(&options, None, false);
  assert!(cli.command.is_some());
  assert!(cli.prompt.is_none());

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
  let options = base_internal_request();

  let cli = build_cli(&options, Some(schema_path.clone()), false);
  assert_eq!(cli.output_schema, Some(schema_path));
}

#[test]
fn test_build_cli_minimal_options() {
  let mut options = base_internal_request();
  options.prompt = "minimal".to_string();
  options.full_auto = false;

  let cli = build_cli(&options, None, false);
  assert!(cli.command.is_none());
  assert_eq!(cli.prompt, Some("minimal".to_string()));
  assert!(cli.images.is_empty());
  assert!(cli.model.is_none());
  assert!(!cli.full_auto);
  assert!(!cli.skip_git_repo_check);
}

#[test]
fn test_build_cli_with_oss_model() {
  let mut options = base_internal_request();
  options.prompt = "oss run".to_string();
  options.oss = true;
  options.model = Some("gpt-oss:20b".to_string());

  let cli = build_cli(&options, None, false);
  assert!(cli.command.is_none());
  assert_eq!(cli.model, Some("gpt-oss:20b".to_string()));
  assert!(cli.oss);
}

#[test]
fn test_build_cli_workspace_write_overrides() {
  let mut options = base_internal_request();
  options.workspace_write_options = Some(WorkspaceWriteOptions {
    network_access: Some(true),
    writable_roots: Some(vec!["/data".to_string()]),
    exclude_tmpdir_env_var: Some(true),
    exclude_slash_tmp: Some(false),
  });

  let cli = build_cli(&options, None, false);
  let overrides = cli.config_overrides.raw_overrides;
  assert!(
    overrides
      .iter()
      .any(|o| o == "sandbox_workspace_write.network_access=true")
  );
  assert!(
    overrides
      .iter()
      .any(|o| o.contains("sandbox_workspace_write.writable_roots"))
  );
  assert!(
    overrides
      .iter()
      .any(|o| o == "sandbox_workspace_write.exclude_tmpdir_env_var=true")
  );
  assert!(
    overrides
      .iter()
      .any(|o| o == "sandbox_workspace_write.exclude_slash_tmp=false")
  );
}

#[test]
fn test_build_cli_force_compact_override() {
  let options = base_internal_request();
  let cli = build_cli(&options, None, true);
  assert!(
    cli
      .config_overrides
      .raw_overrides
      .contains(&"native.force_compact=true".to_string())
  );
}
