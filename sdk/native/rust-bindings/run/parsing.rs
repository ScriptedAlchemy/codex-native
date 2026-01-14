impl ConversationConfigRequest {
  fn into_internal_request(self) -> napi::Result<InternalRunRequest> {
    let sandbox_mode = parse_sandbox_mode(self.sandbox_mode.as_deref())?;
    let approval_mode = parse_approval_mode(self.approval_mode.as_deref())?;
    let reasoning_effort = parse_reasoning_effort(self.reasoning_effort.as_deref())?;
    let reasoning_summary = parse_reasoning_summary(self.reasoning_summary.as_deref())?;

    Ok(InternalRunRequest {
      prompt: String::new(),
      input_items: None,
      thread_id: None,
      images: Vec::new(),
      model: self.model,
      model_provider: self.model_provider,
      oss: self.oss.unwrap_or(false),
      sandbox_mode,
      approval_mode,
      workspace_write_options: self.workspace_write_options,
      review_request: None,
      working_directory: self.working_directory.map(PathBuf::from),
      skip_git_repo_check: self.skip_git_repo_check.unwrap_or(false),
      output_schema: None,
      tool_choice: None,
      base_url: self.base_url,
      api_key: self.api_key,
      linux_sandbox_path: self.linux_sandbox_path.map(PathBuf::from),
      reasoning_effort,
      reasoning_summary,
      full_auto: self.full_auto.unwrap_or(true),
    })
  }
}

impl RunRequest {
  pub fn into_internal(self) -> napi::Result<InternalRunRequest> {
    let sandbox_mode = parse_sandbox_mode(self.sandbox_mode.as_deref())?;
    let approval_mode = parse_approval_mode(self.approval_mode.as_deref())?;
    let reasoning_effort = parse_reasoning_effort(self.reasoning_effort.as_deref())?;
    let reasoning_summary = parse_reasoning_summary(self.reasoning_summary.as_deref())?;

    let review_request = if self.review_mode.unwrap_or(false) {
      let prompt_trimmed = self.prompt.trim().to_string();
      if prompt_trimmed.is_empty() {
        return Err(napi::Error::from_reason(
          "Review mode requires a non-empty prompt".to_string(),
        ));
      }
      let hint = self
        .review_hint
        .unwrap_or_else(|| "code review".to_string());
      Some(ReviewRequest {
        prompt: prompt_trimmed,
        user_facing_hint: hint,
      })
    } else {
      None
    };

    let images = self
      .images
      .unwrap_or_default()
      .into_iter()
      .map(PathBuf::from)
      .collect();
    let working_directory = self.working_directory.map(PathBuf::from);
    let input_items = match self.input_items {
      Some(value) => Some(serde_json::from_value(value).map_err(|err| {
        napi::Error::from_reason(format!("Invalid inputItems payload: {err}"))
      })?),
      None => None,
    };

    validate_model_name(
      self.model.as_deref(),
      self.oss.unwrap_or(false),
      self.model_provider.as_deref(),
    )?;

    Ok(InternalRunRequest {
      prompt: self.prompt,
      input_items,
      thread_id: self.thread_id,
      images,
      model: self.model,
      model_provider: self.model_provider,
      oss: self.oss.unwrap_or(false),
      sandbox_mode,
      approval_mode,
      workspace_write_options: self.workspace_write_options,
      review_request,
      working_directory,
      skip_git_repo_check: self.skip_git_repo_check.unwrap_or(false),
      output_schema: self.output_schema,
      tool_choice: self.tool_choice,
      base_url: self.base_url,
      api_key: self.api_key,
      linux_sandbox_path: self.linux_sandbox_path.map(PathBuf::from),
      reasoning_effort,
      reasoning_summary,
      full_auto: self.full_auto.unwrap_or(true),
    })
  }
}

impl ForkRequest {
  fn into_internal(self) -> napi::Result<InternalForkRequest> {
    let thread_id = self.thread_id.trim().to_string();
    if thread_id.is_empty() {
      return Err(napi::Error::from_reason(
        "threadId must be provided for forkThread requests",
      ));
    }

    let nth_user_message = self
      .nth_user_message
      .ok_or_else(|| napi::Error::from_reason("nthUserMessage must be provided for forkThread"))?
      as usize;

    let run_request = RunRequest {
      prompt: String::new(),
      input_items: None,
      thread_id: Some(thread_id.clone()),
      images: None,
      model: self.model,
      model_provider: self.model_provider,
      oss: self.oss,
      sandbox_mode: self.sandbox_mode,
      approval_mode: self.approval_mode,
      workspace_write_options: self.workspace_write_options,
      working_directory: self.working_directory,
      skip_git_repo_check: self.skip_git_repo_check,
      output_schema: None,
      tool_choice: None,
      base_url: self.base_url,
      api_key: self.api_key,
      linux_sandbox_path: self.linux_sandbox_path,
      reasoning_effort: self.reasoning_effort,
      reasoning_summary: self.reasoning_summary,
      full_auto: self.full_auto,
      review_mode: None,
      review_hint: None,
    };

    let run_options = run_request.into_internal()?;

    Ok(InternalForkRequest {
      thread_id,
      nth_user_message,
      run_options,
    })
  }
}


macro_rules! parse_enum_arg {
  ($input:expr, $name:expr, $( $str:expr => $variant:expr ),+ $(,)?) => {
    match $input {
      None => Ok(None),
      $(
        Some($str) => Ok(Some($variant)),
      )+
      Some(other) => Err(napi::Error::from_reason(format!(
        "Unsupported {}: {}", $name, other
      ))),
    }
  };
}

fn parse_sandbox_mode(input: Option<&str>) -> napi::Result<Option<SandboxModeCliArg>> {
  parse_enum_arg!(input, "sandbox mode",
    "read-only" => SandboxModeCliArg::ReadOnly,
    "workspace-write" => SandboxModeCliArg::WorkspaceWrite,
    "danger-full-access" => SandboxModeCliArg::DangerFullAccess,
  )
}

fn parse_approval_mode(input: Option<&str>) -> napi::Result<Option<ApprovalModeCliArg>> {
  parse_enum_arg!(input, "approval mode",
    "never" => ApprovalModeCliArg::Never,
    "on-request" => ApprovalModeCliArg::OnRequest,
    "on-failure" => ApprovalModeCliArg::OnFailure,
    "untrusted" => ApprovalModeCliArg::Untrusted,
  )
}

fn parse_reasoning_effort(input: Option<&str>) -> napi::Result<Option<ReasoningEffort>> {
  parse_enum_arg!(input, "reasoning effort",
    "minimal" => ReasoningEffort::Minimal,
    "low" => ReasoningEffort::Low,
    "medium" => ReasoningEffort::Medium,
    "high" => ReasoningEffort::High,
    "xhigh" => ReasoningEffort::XHigh,
  )
}

fn parse_reasoning_summary(input: Option<&str>) -> napi::Result<Option<ReasoningSummary>> {
  parse_enum_arg!(input, "reasoning summary",
    "auto" => ReasoningSummary::Auto,
    "concise" => ReasoningSummary::Concise,
    "detailed" => ReasoningSummary::Detailed,
    "none" => ReasoningSummary::None,
  )
}

fn approval_mode_cli_to_policy(mode: Option<ApprovalModeCliArg>) -> Option<AskForApproval> {
  mode.map(|m| match m {
    ApprovalModeCliArg::Never => AskForApproval::Never,
    ApprovalModeCliArg::OnRequest => AskForApproval::OnRequest,
    ApprovalModeCliArg::OnFailure => AskForApproval::OnFailure,
    ApprovalModeCliArg::Untrusted => AskForApproval::UnlessTrusted,
  })
}

fn sandbox_mode_cli_to_config(mode: Option<SandboxModeCliArg>) -> Option<SandboxMode> {
  mode.map(|m| match m {
    SandboxModeCliArg::ReadOnly => SandboxMode::ReadOnly,
    SandboxModeCliArg::WorkspaceWrite => SandboxMode::WorkspaceWrite,
    SandboxModeCliArg::DangerFullAccess => SandboxMode::DangerFullAccess,
  })
}
