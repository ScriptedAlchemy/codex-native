#[napi(object)]
pub struct RunRequest {
  pub prompt: String,
  #[napi(js_name = "inputItems")]
  pub input_items: Option<JsonValue>,
  #[napi(js_name = "threadId")]
  pub thread_id: Option<String>,
  pub images: Option<Vec<String>>,
  pub model: Option<String>,
  #[napi(js_name = "modelProvider")]
  pub model_provider: Option<String>,
  #[napi(js_name = "oss")]
  pub oss: Option<bool>,
  #[napi(js_name = "sandboxMode")]
  pub sandbox_mode: Option<String>,
  #[napi(js_name = "approvalMode")]
  pub approval_mode: Option<String>,
  #[napi(js_name = "workspaceWriteOptions")]
  pub workspace_write_options: Option<WorkspaceWriteOptions>,
  #[napi(js_name = "reviewMode")]
  pub review_mode: Option<bool>,
  #[napi(js_name = "reviewHint")]
  pub review_hint: Option<String>,
  #[napi(js_name = "workingDirectory")]
  pub working_directory: Option<String>,
  #[napi(js_name = "skipGitRepoCheck")]
  pub skip_git_repo_check: Option<bool>,
  #[napi(js_name = "outputSchema")]
  pub output_schema: Option<JsonValue>,
  #[napi(js_name = "toolChoice")]
  pub tool_choice: Option<JsonValue>,
  #[napi(js_name = "baseUrl")]
  pub base_url: Option<String>,
  #[napi(js_name = "apiKey")]
  pub api_key: Option<String>,
  #[napi(js_name = "linuxSandboxPath")]
  pub linux_sandbox_path: Option<String>,
  #[napi(js_name = "reasoningEffort")]
  pub reasoning_effort: Option<String>,
  #[napi(js_name = "reasoningSummary")]
  pub reasoning_summary: Option<String>,
  #[napi(js_name = "fullAuto")]
  pub full_auto: Option<bool>,
  /// MCP servers to register, keyed by server name. Passed as JSON value.
  pub mcp: Option<JsonValue>,
  /// When false, ignores globally registered MCP servers from config.toml.
  #[napi(js_name = "inheritMcp")]
  pub inherit_mcp: Option<bool>,
}

#[napi(object)]
pub struct ForkRequest {
  #[napi(js_name = "threadId")]
  pub thread_id: String,
  #[napi(js_name = "nthUserMessage")]
  pub nth_user_message: Option<u32>,
  #[napi(js_name = "model")]
  pub model: Option<String>,
  #[napi(js_name = "modelProvider")]
  pub model_provider: Option<String>,
  #[napi(js_name = "oss")]
  pub oss: Option<bool>,
  #[napi(js_name = "sandboxMode")]
  pub sandbox_mode: Option<String>,
  #[napi(js_name = "approvalMode")]
  pub approval_mode: Option<String>,
  #[napi(js_name = "workspaceWriteOptions")]
  pub workspace_write_options: Option<WorkspaceWriteOptions>,
  #[napi(js_name = "workingDirectory")]
  pub working_directory: Option<String>,
  #[napi(js_name = "skipGitRepoCheck")]
  pub skip_git_repo_check: Option<bool>,
  #[napi(js_name = "baseUrl")]
  pub base_url: Option<String>,
  #[napi(js_name = "apiKey")]
  pub api_key: Option<String>,
  #[napi(js_name = "linuxSandboxPath")]
  pub linux_sandbox_path: Option<String>,
  #[napi(js_name = "reasoningEffort")]
  pub reasoning_effort: Option<String>,
  #[napi(js_name = "reasoningSummary")]
  pub reasoning_summary: Option<String>,
  #[napi(js_name = "fullAuto")]
  pub full_auto: Option<bool>,
}

#[derive(Debug)]
pub struct InternalForkRequest {
  pub thread_id: String,
  pub nth_user_message: usize,
  pub run_options: InternalRunRequest,
}

#[derive(Default)]
#[napi(object)]
pub struct ConversationConfigRequest {
  #[napi(js_name = "model")]
  pub model: Option<String>,
  #[napi(js_name = "modelProvider")]
  pub model_provider: Option<String>,
  #[napi(js_name = "oss")]
  pub oss: Option<bool>,
  #[napi(js_name = "sandboxMode")]
  pub sandbox_mode: Option<String>,
  #[napi(js_name = "approvalMode")]
  pub approval_mode: Option<String>,
  #[napi(js_name = "workspaceWriteOptions")]
  pub workspace_write_options: Option<WorkspaceWriteOptions>,
  #[napi(js_name = "workingDirectory")]
  pub working_directory: Option<String>,
  #[napi(js_name = "skipGitRepoCheck")]
  pub skip_git_repo_check: Option<bool>,
  #[napi(js_name = "baseUrl")]
  pub base_url: Option<String>,
  #[napi(js_name = "apiKey")]
  pub api_key: Option<String>,
  #[napi(js_name = "linuxSandboxPath")]
  pub linux_sandbox_path: Option<String>,
  #[napi(js_name = "reasoningEffort")]
  pub reasoning_effort: Option<String>,
  #[napi(js_name = "reasoningSummary")]
  pub reasoning_summary: Option<String>,
  #[napi(js_name = "fullAuto")]
  pub full_auto: Option<bool>,
}

#[napi(object)]
pub struct ListConversationsRequest {
  #[napi(js_name = "config")]
  pub config: Option<ConversationConfigRequest>,
  #[napi(js_name = "pageSize")]
  pub page_size: Option<u32>,
  pub cursor: Option<String>,
  #[napi(js_name = "modelProviders")]
  pub model_providers: Option<Vec<String>>,
}

#[napi(object)]
pub struct ConversationSummary {
  pub id: String,
  pub path: String,
  #[napi(js_name = "createdAt")]
  pub created_at: Option<String>,
  #[napi(js_name = "updatedAt")]
  pub updated_at: Option<String>,
}

#[napi(object)]
pub struct ConversationListPage {
  pub conversations: Vec<ConversationSummary>,
  #[napi(js_name = "nextCursor")]
  pub next_cursor: Option<String>,
  #[napi(js_name = "numScannedFiles")]
  pub num_scanned_files: u32,
  #[napi(js_name = "reachedScanCap")]
  pub reached_scan_cap: bool,
}

#[napi(object)]
pub struct DeleteConversationRequest {
  pub id: String,
  #[napi(js_name = "config")]
  pub config: Option<ConversationConfigRequest>,
}

#[napi(object)]
pub struct DeleteConversationResult {
  pub deleted: bool,
}

#[napi(object)]
pub struct ResumeFromRolloutRequest {
  #[napi(js_name = "rolloutPath")]
  pub rollout_path: String,
  #[napi(js_name = "config")]
  pub config: Option<ConversationConfigRequest>,
}

#[napi(object)]
pub struct ForkResult {
  #[napi(js_name = "threadId")]
  pub thread_id: String,
  #[napi(js_name = "rolloutPath")]
  pub rollout_path: String,
}

#[derive(Debug, Clone)]
pub struct ReviewRequest {
  pub prompt: String,
  pub user_facing_hint: String,
}

#[derive(Debug, Clone)]
pub struct InternalRunRequest {
  pub prompt: String,
  pub input_items: Option<Vec<UserInput>>,
  pub thread_id: Option<String>,
  pub images: Vec<PathBuf>,
  pub model: Option<String>,
  pub model_provider: Option<String>,
  pub oss: bool,
  pub sandbox_mode: Option<SandboxModeCliArg>,
  pub approval_mode: Option<ApprovalModeCliArg>,
  pub workspace_write_options: Option<WorkspaceWriteOptions>,
  pub review_request: Option<ReviewRequest>,
  pub working_directory: Option<PathBuf>,
  pub skip_git_repo_check: bool,
  pub output_schema: Option<JsonValue>,
  pub tool_choice: Option<JsonValue>,
  pub base_url: Option<String>,
  pub api_key: Option<String>,
  pub linux_sandbox_path: Option<PathBuf>,
  pub reasoning_effort: Option<ReasoningEffort>,
  pub reasoning_summary: Option<ReasoningSummary>,
  pub full_auto: bool,
  /// MCP servers to register, keyed by server name. Serialized as JSON for config override.
  pub mcp: Option<JsonValue>,
  /// When false, ignores globally registered MCP servers from config.toml.
  pub inherit_mcp: bool,
}
