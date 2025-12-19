use codex_native::*;
use pretty_assertions::assert_eq;

fn base_run_request(prompt: &str) -> RunRequest {
  RunRequest {
    prompt: prompt.to_string(),
    input_items: None,
    thread_id: None,
    images: None,
    model: None,
    model_provider: None,
    oss: None,
    sandbox_mode: None,
    approval_mode: None,
    workspace_write_options: None,
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

/// Test that WorkspaceWriteOptions struct can be constructed with all fields
#[test]
fn test_workspace_write_options_full() {
  let opts = WorkspaceWriteOptions {
    network_access: Some(true),
    writable_roots: Some(vec!["/data".to_string(), "/tmp/output".to_string()]),
    exclude_tmpdir_env_var: Some(true),
    exclude_slash_tmp: Some(false),
  };

  assert_eq!(opts.network_access, Some(true));
  assert_eq!(
    opts.writable_roots,
    Some(vec!["/data".to_string(), "/tmp/output".to_string()])
  );
  assert_eq!(opts.exclude_tmpdir_env_var, Some(true));
  assert_eq!(opts.exclude_slash_tmp, Some(false));
}

/// Test WorkspaceWriteOptions with all None values
#[test]
fn test_workspace_write_options_empty() {
  let opts = WorkspaceWriteOptions {
    network_access: None,
    writable_roots: None,
    exclude_tmpdir_env_var: None,
    exclude_slash_tmp: None,
  };

  assert!(opts.network_access.is_none());
  assert!(opts.writable_roots.is_none());
  assert!(opts.exclude_tmpdir_env_var.is_none());
  assert!(opts.exclude_slash_tmp.is_none());
}

/// Test WorkspaceWriteOptions clone
#[test]
fn test_workspace_write_options_clone() {
  let opts = WorkspaceWriteOptions {
    network_access: Some(true),
    writable_roots: Some(vec!["/data".to_string()]),
    exclude_tmpdir_env_var: Some(false),
    exclude_slash_tmp: Some(true),
  };

  let cloned = opts.clone();
  assert_eq!(cloned.network_access, Some(true));
  assert_eq!(cloned.writable_roots, Some(vec!["/data".to_string()]));
  assert_eq!(cloned.exclude_tmpdir_env_var, Some(false));
  assert_eq!(cloned.exclude_slash_tmp, Some(true));
}

/// Test RunRequest with approval_mode field
#[test]
fn test_run_request_approval_mode_never() {
  let mut req = base_run_request("test");
  req.sandbox_mode = Some("workspace-write".to_string());
  req.approval_mode = Some("never".to_string());

  assert_eq!(req.approval_mode, Some("never".to_string()));
}

/// Test RunRequest with all approval modes
#[test]
fn test_run_request_all_approval_modes() {
  let modes = vec!["never", "on-request", "on-failure", "untrusted"];

  for mode in modes {
    let mut req = base_run_request("test");
    req.approval_mode = Some(mode.to_string());

    assert_eq!(req.approval_mode, Some(mode.to_string()));
  }
}

/// Test RunRequest with workspace_write_options
#[test]
fn test_run_request_with_workspace_write_options() {
  let opts = WorkspaceWriteOptions {
    network_access: Some(true),
    writable_roots: Some(vec!["/data".to_string()]),
    exclude_tmpdir_env_var: Some(false),
    exclude_slash_tmp: Some(true),
  };

  let mut req = base_run_request("test");
  req.model = Some("gpt-5-codex".to_string());
  req.sandbox_mode = Some("workspace-write".to_string());
  req.approval_mode = Some("on-request".to_string());
  req.workspace_write_options = Some(opts);
  req.working_directory = Some("/workspace".to_string());
  req.skip_git_repo_check = Some(true);
  req.full_auto = Some(false);

  assert_eq!(req.model, Some("gpt-5-codex".to_string()));
  assert_eq!(req.sandbox_mode, Some("workspace-write".to_string()));
  assert_eq!(req.approval_mode, Some("on-request".to_string()));
  assert!(req.workspace_write_options.is_some());
  assert_eq!(req.skip_git_repo_check, Some(true));
}

/// Test RunRequest with combined network and approval configuration
#[test]
fn test_run_request_combined_network_approval() {
  let mut req = base_run_request("test network and approval");
  req.sandbox_mode = Some("workspace-write".to_string());
  req.approval_mode = Some("never".to_string());
  req.workspace_write_options = Some(WorkspaceWriteOptions {
    network_access: Some(true),
    writable_roots: None,
    exclude_tmpdir_env_var: None,
    exclude_slash_tmp: None,
  });

  assert_eq!(req.sandbox_mode, Some("workspace-write".to_string()));
  assert_eq!(req.approval_mode, Some("never".to_string()));
  assert!(req.workspace_write_options.is_some());
  let opts = req.workspace_write_options.as_ref().unwrap();
  assert_eq!(opts.network_access, Some(true));
}

/// Test RunRequest with additional writable roots
#[test]
fn test_run_request_with_writable_roots() {
  let roots = vec!["/data/output".to_string(), "/tmp/cache".to_string()];
  let mut req = base_run_request("test");
  req.sandbox_mode = Some("workspace-write".to_string());
  req.workspace_write_options = Some(WorkspaceWriteOptions {
    network_access: None,
    writable_roots: Some(roots.clone()),
    exclude_tmpdir_env_var: None,
    exclude_slash_tmp: None,
  });

  assert!(req.workspace_write_options.is_some());
  let opts = req.workspace_write_options.as_ref().unwrap();
  assert_eq!(opts.writable_roots, Some(roots));
}

/// Test RunRequest with tmpdir exclusions
#[test]
fn test_run_request_with_tmpdir_exclusions() {
  let mut req = base_run_request("test");
  req.sandbox_mode = Some("workspace-write".to_string());
  req.workspace_write_options = Some(WorkspaceWriteOptions {
    network_access: None,
    writable_roots: None,
    exclude_tmpdir_env_var: Some(true),
    exclude_slash_tmp: Some(true),
  });

  assert!(req.workspace_write_options.is_some());
  let opts = req.workspace_write_options.as_ref().unwrap();
  assert_eq!(opts.exclude_tmpdir_env_var, Some(true));
  assert_eq!(opts.exclude_slash_tmp, Some(true));
}

/// Test RunRequest with read-only sandbox mode and approval policy
#[test]
fn test_run_request_read_only_with_approval() {
  let mut req = base_run_request("test");
  req.sandbox_mode = Some("read-only".to_string());
  req.approval_mode = Some("on-request".to_string());

  assert_eq!(req.sandbox_mode, Some("read-only".to_string()));
  assert_eq!(req.approval_mode, Some("on-request".to_string()));
}

/// Test RunRequest with danger-full-access
#[test]
fn test_run_request_danger_full_access() {
  let mut req = base_run_request("test");
  req.sandbox_mode = Some("danger-full-access".to_string());
  req.approval_mode = Some("never".to_string());

  assert_eq!(req.sandbox_mode, Some("danger-full-access".to_string()));
  assert_eq!(req.approval_mode, Some("never".to_string()));
}
