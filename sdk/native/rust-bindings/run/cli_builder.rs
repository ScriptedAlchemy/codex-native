/// Convert a camelCase string to snake_case
fn camel_to_snake(s: &str) -> String {
  let mut result = String::with_capacity(s.len() + 4);
  for (i, ch) in s.chars().enumerate() {
    if ch.is_uppercase() {
      if i > 0 {
        result.push('_');
      }
      result.push(ch.to_ascii_lowercase());
    } else {
      result.push(ch);
    }
  }
  result
}

/// Convert a JSON value to TOML inline format string, converting camelCase keys to snake_case
fn json_to_toml_inline(value: &JsonValue) -> String {
  match value {
    JsonValue::Null => "null".to_string(),
    JsonValue::Bool(b) => b.to_string(),
    JsonValue::Number(n) => n.to_string(),
    JsonValue::String(s) => format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"")),
    JsonValue::Array(arr) => {
      let items: Vec<String> = arr.iter().map(json_to_toml_inline).collect();
      format!("[{}]", items.join(", "))
    }
    JsonValue::Object(obj) => {
      let pairs: Vec<String> = obj
        .iter()
        .map(|(k, v)| format!("{} = {}", camel_to_snake(k), json_to_toml_inline(v)))
        .collect();
      format!("{{ {} }}", pairs.join(", "))
    }
  }
}

pub fn build_cli(
  options: &InternalRunRequest,
  schema_path: Option<PathBuf>,
  force_compact: bool,
) -> Cli {
  let sandbox_mode = options.sandbox_mode;
  let wants_danger = matches!(sandbox_mode, Some(SandboxModeCliArg::DangerFullAccess));
  let cli_full_auto = options.full_auto && !wants_danger;
  let add_dir: Vec<PathBuf> = options
    .workspace_write_options
    .as_ref()
    .and_then(|opts| opts.writable_roots.clone())
    .unwrap_or_default()
    .into_iter()
    .map(PathBuf::from)
    .collect();

  let command = options.thread_id.as_ref().map(|id| {
    Command::Resume(ResumeArgs {
      session_id: Some(id.clone()),
      last: false,
      images: options.images.clone(),
      prompt: Some(options.prompt.clone()),
    })
  });

  let mut raw_overrides = Vec::new();
  if force_compact {
    raw_overrides.push("native.force_compact=true".to_string());
  }

  if let Some(approval_mode) = options.approval_mode {
    let approval_str = match approval_mode {
      ApprovalModeCliArg::Never => "never",
      ApprovalModeCliArg::OnRequest => "on-request",
      ApprovalModeCliArg::OnFailure => "on-failure",
      ApprovalModeCliArg::Untrusted => "untrusted",
    };
    raw_overrides.push(format!("approval_policy={approval_str}"));
  }

  // Forward model provider selection for non-OSS runs via config overrides.
  //
  // `codex-rs/exec` currently only populates `ConfigOverrides.model_provider` in OSS mode.
  // For remote providers, the provider is resolved from the layered config (including CLI -c
  // overrides). Without this, `modelProvider` supplied by the JS SDK can be ignored and
  // codex falls back to ~/.codex/config.toml, which is surprising and can hit the wrong backend.
  if !options.oss {
    if let Some(provider) = options.model_provider.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
      raw_overrides.push(format!("model_provider={provider}"));
    }
  }

  if let Some(ws_opts) = &options.workspace_write_options {
    if let Some(network_access) = ws_opts.network_access {
      raw_overrides.push(format!(
        "sandbox_workspace_write.network_access={network_access}"
      ));
    }
    if let Some(writable_roots) = &ws_opts.writable_roots
      && !writable_roots.is_empty()
      && let Ok(roots_json) = serde_json::to_string(writable_roots)
    {
      raw_overrides.push(format!(
        "sandbox_workspace_write.writable_roots={roots_json}"
      ));
    }
    if let Some(exclude_tmpdir) = ws_opts.exclude_tmpdir_env_var {
      raw_overrides.push(format!(
        "sandbox_workspace_write.exclude_tmpdir_env_var={exclude_tmpdir}"
      ));
    }
    if let Some(exclude_slash_tmp) = ws_opts.exclude_slash_tmp {
      raw_overrides.push(format!(
        "sandbox_workspace_write.exclude_slash_tmp={exclude_slash_tmp}"
      ));
    }
  }

  // Handle MCP server configuration
  // If inherit_mcp is false, clear all globally registered MCP servers first
  if !options.inherit_mcp {
    raw_overrides.push("mcp_servers={}".to_string());
  }

  // Add each MCP server from the options
  if let Some(mcp) = &options.mcp {
    if let JsonValue::Object(servers) = mcp {
      for (server_name, server_config) in servers {
        let toml_value = json_to_toml_inline(server_config);
        raw_overrides.push(format!("mcp_servers.{server_name}={toml_value}"));
      }
    }
  }

	  Cli {
	    command,
	    images: options.images.clone(),
	    model: options.model.clone(),
	    oss: options.oss,
	    oss_provider: options.model_provider.clone(),
	    sandbox_mode,
	    config_profile: None,
	    full_auto: cli_full_auto,
	    dangerously_bypass_approvals_and_sandbox: wants_danger,
	    cwd: options.working_directory.clone(),
	    skip_git_repo_check: options.skip_git_repo_check,
	    add_dir,
	    output_schema: schema_path,
	    config_overrides: CliConfigOverrides { raw_overrides },
	    input_items: options.input_items.clone(),
	    color: Color::Never,
	    json: false,
	    last_message_file: None,
	    prompt: if options.thread_id.is_some() {
	      None
    } else {
      Some(options.prompt.clone())
    },
  }
}
