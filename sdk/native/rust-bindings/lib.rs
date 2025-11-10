#![deny(clippy::all)]

use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::OnceLock;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use codex_cloud_tasks_client as cloud;
use codex_common::{ApprovalModeCliArg, CliConfigOverrides, SandboxModeCliArg};
use codex_core::default_client;
use codex_core::{
  ExternalInterceptorRegistration, ExternalToolRegistration, FunctionCallError, ToolHandler,
  ToolInterceptor, ToolInvocation, ToolKind, ToolOutput, ToolPayload,
  create_function_tool_spec_from_schema, set_pending_external_interceptors,
  set_pending_external_tools,
};
use codex_exec::exec_events::ThreadEvent as ExecThreadEvent;
use codex_exec::run_with_thread_event_callback;
use codex_exec::{Cli, Color, Command, ResumeArgs};
use napi::bindgen_prelude::{Env, Function, Status};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use serde_json::Map as JsonMap;
use serde_json::Value as JsonValue;
use serde_json::json;
use tempfile::NamedTempFile;
use uuid::Uuid;

// Avoid clashes with the `json!` macro imported above when returning data.
use serde_json::json as serde_json_json;

#[cfg(target_os = "linux")]
use std::io::Write;

#[cfg(target_os = "linux")]
fn io_to_napi(err: std::io::Error) -> napi::Error {
  napi::Error::from_reason(err.to_string())
}

#[cfg(target_os = "linux")]
fn ensure_embedded_linux_sandbox() -> napi::Result<PathBuf> {
  use std::fs;
  use std::os::unix::fs::PermissionsExt;

  // Simplified: just create the sandbox each time if it doesn't exist
  // The filesystem acts as our "cache" - if the file exists, we don't recreate it
  let root = std::env::temp_dir().join("codex-native");
  fs::create_dir_all(&root).map_err(io_to_napi)?;
  let target_path = root.join("codex-linux-sandbox");

  // Only create if it doesn't exist
  if !target_path.exists() {
    let mut tmp = NamedTempFile::new_in(&root).map_err(io_to_napi)?;
    tmp
      .write_all(EMBEDDED_LINUX_SANDBOX_BYTES)
      .map_err(io_to_napi)?;
    tmp.flush().map_err(io_to_napi)?;

    let temp_path = tmp.into_temp_path();
    temp_path
      .persist(&target_path)
      .map_err(|err| io_to_napi(err.error))?;

    let mut perms = fs::metadata(&target_path)
      .map_err(io_to_napi)?
      .permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&target_path, perms).map_err(io_to_napi)?;
  }

  Ok(target_path)
}

#[cfg(target_os = "linux")]
fn default_linux_sandbox_path() -> napi::Result<Option<PathBuf>> {
  ensure_embedded_linux_sandbox().map(Some)
}

#[cfg(not(target_os = "linux"))]
fn default_linux_sandbox_path() -> napi::Result<Option<PathBuf>> {
  Ok(None)
}

#[cfg(target_os = "linux")]
const EMBEDDED_LINUX_SANDBOX_BYTES: &[u8] = include_bytes!(env!("CODEX_LINUX_SANDBOX_BIN"));

const ORIGINATOR_ENV: &str = "CODEX_INTERNAL_ORIGINATOR_OVERRIDE";
const NATIVE_ORIGINATOR: &str = "codex_sdk_native";

fn registered_native_tools() -> &'static Mutex<Vec<ExternalToolRegistration>> {
  static TOOLS: OnceLock<Mutex<Vec<ExternalToolRegistration>>> = OnceLock::new();
  TOOLS.get_or_init(|| Mutex::new(Vec::new()))
}

#[derive(Clone)]
#[allow(dead_code)]
struct NativeToolInterceptor {
  tool_name: String,
  handler: Arc<dyn ToolInterceptor>,
}

fn registered_native_interceptors() -> &'static Mutex<Vec<NativeToolInterceptor>> {
  static INTERCEPTORS: OnceLock<Mutex<Vec<NativeToolInterceptor>>> = OnceLock::new();
  INTERCEPTORS.get_or_init(|| Mutex::new(Vec::new()))
}

type InterceptorFuture =
  Pin<Box<dyn Future<Output = Result<ToolOutput, FunctionCallError>> + Send>>;

trait NextCaller: Send {
  fn call(self: Box<Self>, invocation: ToolInvocation) -> InterceptorFuture;
}

impl<F> NextCaller for F
where
  F: FnOnce(ToolInvocation) -> InterceptorFuture + Send + 'static,
{
  fn call(self: Box<Self>, invocation: ToolInvocation) -> InterceptorFuture {
    (*self)(invocation)
  }
}

struct PendingBuiltinCall {
  invocation: ToolInvocation,
  next: Option<Box<dyn NextCaller>>,
}

fn pending_builtin_calls() -> &'static Mutex<HashMap<String, PendingBuiltinCall>> {
  static CALLS: OnceLock<Mutex<HashMap<String, PendingBuiltinCall>>> = OnceLock::new();
  CALLS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn native_response_to_tool_output(
  response: NativeToolResponse,
) -> Result<ToolOutput, FunctionCallError> {
  if let Some(error) = response.error {
    return Err(FunctionCallError::RespondToModel(error));
  }
  let output = response.output.unwrap_or_default();
  Ok(ToolOutput::Function {
    content: output,
    content_items: None,
    success: response.success,
  })
}

fn tool_output_to_native_response(output: ToolOutput) -> Result<NativeToolResponse, String> {
  match output {
    ToolOutput::Function {
      content,
      content_items: _,
      success,
    } => Ok(NativeToolResponse {
      output: Some(content),
      success,
      error: None,
    }),
    _ => Err("callBuiltin received unsupported output type".to_string()),
  }
}

#[napi(object)]
pub struct NativeToolInfo {
  pub name: String,
  pub description: Option<String>,
  pub parameters: Option<JsonValue>,
  pub strict: Option<bool>,
  pub supports_parallel: Option<bool>,
}

#[derive(Clone)]
#[napi(object)]
pub struct NativeToolResponse {
  pub output: Option<String>,
  pub success: Option<bool>,
  pub error: Option<String>,
}

#[napi]
pub fn clear_registered_tools() -> napi::Result<()> {
  registered_native_tools()
    .lock()
    .map_err(|e| napi::Error::from_reason(format!("tools mutex poisoned: {e}")))?
    .clear();
  registered_native_interceptors()
    .lock()
    .map_err(|e| napi::Error::from_reason(format!("interceptors mutex poisoned: {e}")))?
    .clear();
  pending_builtin_calls()
    .lock()
    .map_err(|e| napi::Error::from_reason(format!("pending builtin mutex poisoned: {e}")))?
    .clear();
  Ok(())
}

#[napi]
pub fn register_approval_callback(
  env: Env,
  #[napi(ts_arg_type = "(request: JsApprovalRequest) => boolean | Promise<boolean>")]
  handler: Function<JsApprovalRequest, bool>,
) -> napi::Result<()> {
  let sensitive_tools = ["local_shell", "exec_command", "apply_patch"];

  for tool_name in sensitive_tools {
    let mut tsfn = handler
      .build_threadsafe_function::<JsApprovalRequest>()
      .callee_handled::<true>()
      .build()?;
    #[allow(deprecated)]
    let _ = tsfn.unref(&env);

    let interceptor = NativeToolInterceptor {
      tool_name: tool_name.to_string(),
      handler: Arc::new(JsApprovalInterceptor { callback: tsfn }),
    };

    registered_native_interceptors()
      .lock()
      .map_err(|e| napi::Error::from_reason(format!("interceptors mutex poisoned: {e}")))?
      .push(interceptor);
  }

  Ok(())
}

#[napi]
pub fn register_tool(
  env: Env,
  info: NativeToolInfo,
  #[napi(
    ts_arg_type = "(call: JsToolInvocation) => NativeToolResponse | Promise<NativeToolResponse>"
  )]
  handler: Function<JsToolInvocation, NativeToolResponse>,
) -> napi::Result<()> {
  let schema = info.parameters.unwrap_or_else(|| {
    json!({
        "type": "object",
        "properties": {}
    })
  });
  let spec = create_function_tool_spec_from_schema(
    info.name.clone(),
    info.description.clone(),
    schema,
    info.strict.unwrap_or(false),
  )
  .map_err(|err| napi::Error::from_reason(format!("invalid tool schema: {err}")))?;

  let mut tsfn = handler
    .build_threadsafe_function::<JsToolInvocation>()
    .callee_handled::<true>()
    .build()?;
  #[allow(deprecated)]
  let _ = tsfn.unref(&env);

  let registration = ExternalToolRegistration {
    spec,
    handler: Arc::new(JsToolHandler { callback: tsfn }),
    supports_parallel_tool_calls: info.supports_parallel.unwrap_or(true),
  };

  registered_native_tools()
    .lock()
    .map_err(|e| napi::Error::from_reason(format!("tools mutex poisoned: {e}")))?
    .push(registration);

  Ok(())
}

#[napi]
pub fn register_tool_interceptor(
  env: Env,
  tool_name: String,
  #[napi(
    ts_arg_type = "(context: JsToolInterceptorContext) => NativeToolResponse | Promise<NativeToolResponse>"
  )]
  handler: Function<JsToolInterceptorContext, NativeToolResponse>,
) -> napi::Result<()> {
  let mut tsfn = handler
    .build_threadsafe_function::<JsToolInterceptorContext>()
    .callee_handled::<true>()
    .build()?;
  #[allow(deprecated)]
  let _ = tsfn.unref(&env);

  let interceptor = NativeToolInterceptor {
    tool_name: tool_name.clone(),
    handler: Arc::new(JsToolInterceptor { callback: tsfn }),
  };

  registered_native_interceptors()
    .lock()
    .map_err(|e| napi::Error::from_reason(format!("interceptors mutex poisoned: {e}")))?
    .push(interceptor);

  Ok(())
}

#[napi(ts_args_type = "token: string, invocation?: JsToolInvocation")]
pub async fn call_tool_builtin(
  token: String,
  invocation_override: Option<JsToolInvocation>,
) -> napi::Result<NativeToolResponse> {
  let mut entry = pending_builtin_calls()
    .lock()
    .map_err(|e| napi::Error::from_reason(format!("pending builtin mutex poisoned: {e}")))?
    .remove(&token)
    .ok_or_else(|| {
      napi::Error::from_reason(format!("No pending builtin call for token {token}"))
    })?;

  let next = entry
    .next
    .take()
    .ok_or_else(|| napi::Error::from_reason("callBuiltin already invoked for this token"))?;

  let mut invocation = entry.invocation.clone();
  if let Some(override_invocation) = invocation_override {
    if override_invocation.tool_name != invocation.tool_name {
      return Err(napi::Error::from_reason(
        "callBuiltin invocation tool mismatch with original tool",
      ));
    }
    if !override_invocation.call_id.is_empty() {
      invocation.call_id = override_invocation.call_id;
    }
    match (override_invocation.arguments, override_invocation.input) {
      (Some(arguments), _) => {
        invocation.payload = ToolPayload::Function { arguments };
      }
      (None, Some(input)) => {
        invocation.payload = ToolPayload::Custom { input };
      }
      (None, None) => {}
    }
  }

  match next.call(invocation).await {
    Ok(output) => tool_output_to_native_response(output).map_err(napi::Error::from_reason),
    Err(FunctionCallError::RespondToModel(message)) | Err(FunctionCallError::Denied(message)) => {
      Ok(NativeToolResponse {
        output: None,
        success: Some(false),
        error: Some(message),
      })
    }
    Err(FunctionCallError::MissingLocalShellCallId) => Err(napi::Error::from_reason(
      "callBuiltin failed: missing local shell call id",
    )),
    Err(FunctionCallError::Fatal(message)) => Err(napi::Error::from_reason(message)),
  }
}

#[derive(Clone)]
#[napi(object)]
pub struct JsToolInterceptorContext {
  pub invocation: JsToolInvocation,
  pub token: String,
}

#[derive(Clone)]
#[napi(object)]
pub struct JsApprovalRequest {
  #[napi(js_name = "type")]
  pub type_: String,
  pub details: Option<JsonValue>,
}

#[derive(Clone)]
#[napi(object)]
pub struct JsToolInvocation {
  #[napi(js_name = "callId")]
  pub call_id: String,
  #[napi(js_name = "toolName")]
  pub tool_name: String,
  #[napi(js_name = "arguments")]
  pub arguments: Option<String>,
  pub input: Option<String>,
}

struct JsToolHandler {
  callback:
    ThreadsafeFunction<JsToolInvocation, NativeToolResponse, JsToolInvocation, napi::Status, true>,
}

struct JsApprovalInterceptor {
  callback: ThreadsafeFunction<JsApprovalRequest, bool, JsApprovalRequest, Status, true>,
}

#[allow(dead_code)]
struct JsToolInterceptor {
  callback: ThreadsafeFunction<
    JsToolInterceptorContext,
    NativeToolResponse,
    JsToolInterceptorContext,
    napi::Status,
    true,
  >,
}

#[async_trait]
impl ToolInterceptor for JsApprovalInterceptor {
  async fn intercept(
    &self,
    invocation: ToolInvocation,
    next: Box<
      dyn FnOnce(
          ToolInvocation,
        ) -> std::pin::Pin<
          Box<dyn std::future::Future<Output = Result<ToolOutput, FunctionCallError>> + Send>,
        > + Send,
    >,
  ) -> Result<ToolOutput, FunctionCallError> {
    let req_type = match invocation.tool_name.as_str() {
      "apply_patch" => "file_write",
      "local_shell" | "exec_command" => "shell",
      _ => "network_access",
    }
    .to_string();

    let details = match &invocation.payload {
      ToolPayload::LocalShell { params } => json!({
        "command": params.command,
        "workdir": params.workdir,
        "timeoutMs": params.timeout_ms,
      }),
      _ => json!({
        "payload": invocation.payload.log_payload(),
      }),
    };

    let approved = match self
      .callback
      .call_async(Ok(JsApprovalRequest {
        type_: req_type,
        details: Some(details),
      }))
      .await
    {
      Ok(value) => value,
      Err(err) => return Err(FunctionCallError::Fatal(err.to_string())),
    };

    if !approved {
      return Err(FunctionCallError::Denied(format!(
        "Approval denied for tool `{}`",
        invocation.tool_name
      )));
    }

    let next_box = move |inv: ToolInvocation| next(inv);
    let caller: Box<dyn NextCaller> = Box::new(next_box);
    caller.call(invocation).await
  }
}

#[async_trait]
impl ToolInterceptor for JsToolInterceptor {
  async fn intercept(
    &self,
    invocation: ToolInvocation,
    next: Box<
      dyn FnOnce(
          ToolInvocation,
        ) -> std::pin::Pin<
          Box<dyn std::future::Future<Output = Result<ToolOutput, FunctionCallError>> + Send>,
        > + Send,
    >,
  ) -> Result<ToolOutput, FunctionCallError> {
    let js_invocation = match invocation.payload.clone() {
      ToolPayload::Function { arguments } => JsToolInvocation {
        call_id: invocation.call_id.clone(),
        tool_name: invocation.tool_name.clone(),
        arguments: Some(arguments),
        input: None,
      },
      ToolPayload::Custom { input } => JsToolInvocation {
        call_id: invocation.call_id.clone(),
        tool_name: invocation.tool_name.clone(),
        arguments: None,
        input: Some(input),
      },
      _ => {
        return Err(FunctionCallError::Fatal(format!(
          "interceptor for tool `{}` received unsupported payload",
          invocation.tool_name
        )));
      }
    };

    let token = Uuid::new_v4().to_string();
    {
      let mut guard = pending_builtin_calls()
        .lock()
        .map_err(|e| FunctionCallError::Fatal(format!("pending builtin mutex poisoned: {e}")))?;
      let stored_invocation = invocation.clone();
      let next_box = move |inv: ToolInvocation| next(inv);
      guard.insert(
        token.clone(),
        PendingBuiltinCall {
          invocation: stored_invocation,
          next: Some(Box::new(next_box) as Box<dyn NextCaller>),
        },
      );
    }

    let response = match self
      .callback
      .call_async(Ok(JsToolInterceptorContext {
        invocation: js_invocation,
        token: token.clone(),
      }))
      .await
    {
      Ok(res) => res,
      Err(err) => {
        pending_builtin_calls()
          .lock()
          .map_err(|e| FunctionCallError::Fatal(format!("pending builtin mutex poisoned: {e}")))?
          .remove(&token);
        return Err(FunctionCallError::Fatal(err.to_string()));
      }
    };

    pending_builtin_calls()
      .lock()
      .map_err(|e| FunctionCallError::Fatal(format!("pending builtin mutex poisoned: {e}")))?
      .remove(&token);

    native_response_to_tool_output(response)
  }
}

#[async_trait]
impl ToolHandler for JsToolHandler {
  fn kind(&self) -> ToolKind {
    ToolKind::Function
  }

  async fn handle(&self, invocation: ToolInvocation) -> Result<ToolOutput, FunctionCallError> {
    let payload = match invocation.payload {
      ToolPayload::Function { arguments } => JsToolInvocation {
        call_id: invocation.call_id.clone(),
        tool_name: invocation.tool_name.clone(),
        arguments: Some(arguments),
        input: None,
      },
      ToolPayload::Custom { input } => JsToolInvocation {
        call_id: invocation.call_id.clone(),
        tool_name: invocation.tool_name.clone(),
        arguments: None,
        input: Some(input),
      },
      _ => {
        return Err(FunctionCallError::Fatal(format!(
          "native tool `{}` received unsupported payload",
          invocation.tool_name
        )));
      }
    };

    let response = self
      .callback
      .call_async(Ok(payload))
      .await
      .map_err(|e| FunctionCallError::Fatal(e.to_string()))?;
    native_response_to_tool_output(response)
  }
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct WorkspaceWriteOptions {
  #[napi(js_name = "networkAccess")]
  pub network_access: Option<bool>,
  #[napi(js_name = "writableRoots")]
  pub writable_roots: Option<Vec<String>>,
  #[napi(js_name = "excludeTmpdirEnvVar")]
  pub exclude_tmpdir_env_var: Option<bool>,
  #[napi(js_name = "excludeSlashTmp")]
  pub exclude_slash_tmp: Option<bool>,
}

#[napi(object)]
pub struct RunRequest {
  pub prompt: String,
  #[napi(js_name = "threadId")]
  pub thread_id: Option<String>,
  pub images: Option<Vec<String>>,
  pub model: Option<String>,
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
  #[napi(js_name = "baseUrl")]
  pub base_url: Option<String>,
  #[napi(js_name = "apiKey")]
  pub api_key: Option<String>,
  #[napi(js_name = "linuxSandboxPath")]
  pub linux_sandbox_path: Option<String>,
  #[napi(js_name = "fullAuto")]
  pub full_auto: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct ReviewRequest {
  pub prompt: String,
  pub user_facing_hint: String,
}

#[derive(Debug)]
pub struct InternalRunRequest {
  pub prompt: String,
  pub thread_id: Option<String>,
  pub images: Vec<PathBuf>,
  pub model: Option<String>,
  pub oss: bool,
  pub sandbox_mode: Option<SandboxModeCliArg>,
  pub approval_mode: Option<ApprovalModeCliArg>,
  pub workspace_write_options: Option<WorkspaceWriteOptions>,
  pub review_request: Option<ReviewRequest>,
  pub working_directory: Option<PathBuf>,
  pub skip_git_repo_check: bool,
  pub output_schema: Option<JsonValue>,
  pub base_url: Option<String>,
  pub api_key: Option<String>,
  pub linux_sandbox_path: Option<PathBuf>,
  pub full_auto: bool,
}

impl RunRequest {
  pub fn into_internal(self) -> napi::Result<InternalRunRequest> {
    let sandbox_mode = match self.sandbox_mode.as_deref() {
      None => None,
      Some("read-only") => Some(SandboxModeCliArg::ReadOnly),
      Some("workspace-write") => Some(SandboxModeCliArg::WorkspaceWrite),
      Some("danger-full-access") => Some(SandboxModeCliArg::DangerFullAccess),
      Some(other) => {
        return Err(napi::Error::from_reason(format!(
          "Unsupported sandbox mode: {other}",
        )));
      }
    };

    let approval_mode = match self.approval_mode.as_deref() {
      None => None,
      Some("never") => Some(ApprovalModeCliArg::Never),
      Some("on-request") => Some(ApprovalModeCliArg::OnRequest),
      Some("on-failure") => Some(ApprovalModeCliArg::OnFailure),
      Some("untrusted") => Some(ApprovalModeCliArg::Untrusted),
      Some(other) => {
        return Err(napi::Error::from_reason(format!(
          "Unsupported approval mode: {other}",
        )));
      }
    };

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

    if let Some(model_name) = self.model.as_deref() {
      let trimmed = model_name.trim();
      if self.oss.unwrap_or(false) {
        if !trimmed.starts_with("gpt-oss:") {
          return Err(napi::Error::from_reason(format!(
            "Invalid model \"{trimmed}\" for OSS mode. Use models prefixed with \"gpt-oss:\", e.g. \"gpt-oss:20b\"."
          )));
        }
      } else if trimmed != "gpt-5" && trimmed != "gpt-5-codex" {
        return Err(napi::Error::from_reason(format!(
          "Invalid model \"{trimmed}\". Supported models are \"gpt-5\" or \"gpt-5-codex\"."
        )));
      }
    }

    Ok(InternalRunRequest {
      prompt: self.prompt,
      thread_id: self.thread_id,
      images,
      model: self.model,
      oss: self.oss.unwrap_or(false),
      sandbox_mode,
      approval_mode,
      workspace_write_options: self.workspace_write_options,
      review_request,
      working_directory,
      skip_git_repo_check: self.skip_git_repo_check.unwrap_or(false),
      output_schema: self.output_schema,
      base_url: self.base_url,
      api_key: self.api_key,
      linux_sandbox_path: self.linux_sandbox_path.map(PathBuf::from),
      full_auto: self.full_auto.unwrap_or(true),
    })
  }
}

struct TempSchemaFile {
  path: PathBuf,
  _guard: tempfile::TempPath,
}

fn prepare_schema(schema: Option<JsonValue>) -> napi::Result<Option<TempSchemaFile>> {
  if let Some(schema_value) = schema {
    let mut file = NamedTempFile::new().map_err(|e| napi::Error::from_reason(e.to_string()))?;
    serde_json::to_writer(&mut file, &schema_value)
      .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let path = file.path().to_path_buf();
    let temp_path = file.into_temp_path();
    Ok(Some(TempSchemaFile {
      path,
      _guard: temp_path,
    }))
  } else {
    Ok(None)
  }
}

struct EnvOverride {
  key: &'static str,
  previous: Option<String>,
}

struct EnvOverrides {
  entries: Vec<EnvOverride>,
}

impl EnvOverrides {
  fn apply(pairs: Vec<(&'static str, Option<String>, bool)>) -> Self {
    let mut entries = Vec::new();
    for (key, value, force) in pairs {
      if !force && value.is_none() {
        continue;
      }
      let previous = std::env::var(key).ok();
      match value {
        Some(val) => unsafe { std::env::set_var(key, val) },
        None if force => unsafe { std::env::remove_var(key) },
        None => {}
      }
      entries.push(EnvOverride { key, previous });
    }
    Self { entries }
  }
}

impl Drop for EnvOverrides {
  fn drop(&mut self) {
    for entry in self.entries.iter().rev() {
      if let Some(prev) = &entry.previous {
        unsafe { std::env::set_var(entry.key, prev) };
      } else {
        unsafe { std::env::remove_var(entry.key) };
      }
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

  let command = options.thread_id.as_ref().map(|id| {
    Command::Resume(ResumeArgs {
      session_id: Some(id.clone()),
      last: false,
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

  Cli {
    command,
    images: options.images.clone(),
    model: options.model.clone(),
    oss: options.oss,
    sandbox_mode,
    config_profile: None,
    full_auto: cli_full_auto,
    dangerously_bypass_approvals_and_sandbox: wants_danger,
    cwd: options.working_directory.clone(),
    skip_git_repo_check: options.skip_git_repo_check,
    output_schema: schema_path,
    config_overrides: CliConfigOverrides { raw_overrides },
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

fn event_to_json(event: &ExecThreadEvent) -> napi::Result<JsonValue> {
  match event {
    ExecThreadEvent::ExitedReviewMode(inner) => {
      let review_output = match &inner.review_output {
        Some(output) => {
          serde_json::to_value(output).map_err(|e| napi::Error::from_reason(e.to_string()))?
        }
        None => JsonValue::Null,
      };
      let mut map = JsonMap::new();
      map.insert(
        "type".to_string(),
        JsonValue::String("exited_review_mode".to_string()),
      );
      map.insert("review_output".to_string(), review_output);
      Ok(JsonValue::Object(map))
    }
    ExecThreadEvent::Raw(_) => Ok(JsonValue::Null),
    _ => serde_json::to_value(event).map_err(|e| napi::Error::from_reason(e.to_string())),
  }
}

fn run_internal_sync<F>(options: InternalRunRequest, handler: F) -> napi::Result<()>
where
  F: FnMut(ExecThreadEvent) + Send + 'static,
{
  let schema_file = prepare_schema(options.output_schema.clone())?;
  let schema_path = schema_file.as_ref().map(|file| file.path.clone());
  let cli = build_cli(&options, schema_path, false);

  let pending_tools = {
    let guard = registered_native_tools()
      .lock()
      .map_err(|e| napi::Error::from_reason(format!("tools mutex poisoned: {e}")))?;
    guard.clone()
  };
  set_pending_external_tools(pending_tools);
  let pending_interceptors = {
    let guard = registered_native_interceptors()
      .lock()
      .map_err(|e| napi::Error::from_reason(format!("interceptors mutex poisoned: {e}")))?;
    guard
      .iter()
      .map(|n| ExternalInterceptorRegistration {
        name: n.tool_name.clone(),
        handler: Arc::clone(&n.handler),
      })
      .collect::<Vec<_>>()
  };
  set_pending_external_interceptors(pending_interceptors);

  let mut env_pairs: Vec<(&'static str, Option<String>, bool)> = Vec::new();
  if std::env::var(ORIGINATOR_ENV).is_err() {
    env_pairs.push((ORIGINATOR_ENV, Some(NATIVE_ORIGINATOR.to_string()), true));
  }
  if let Some(base_url) = options.base_url.clone() {
    env_pairs.push(("OPENAI_BASE_URL", Some(base_url), true));
  }
  if let Some(api_key) = options.api_key.clone() {
    env_pairs.push(("CODEX_API_KEY", Some(api_key), true));
  }

  let linux_sandbox_path = if let Some(path) = options.linux_sandbox_path.clone() {
    Some(path)
  } else if let Ok(path) = std::env::var("CODEX_LINUX_SANDBOX_EXE") {
    Some(PathBuf::from(path))
  } else {
    default_linux_sandbox_path()?
  };

  if let Some(path) = linux_sandbox_path.as_ref() {
    env_pairs.push((
      "CODEX_LINUX_SANDBOX_EXE",
      Some(path.to_string_lossy().to_string()),
      false,
    ));
  }

  let _env_guard = EnvOverrides::apply(env_pairs);

  let handler_arc = Arc::new(Mutex::new(handler));
  let handler_for_callback = Arc::clone(&handler_arc);

  let runtime = tokio::runtime::Runtime::new()
    .map_err(|e| napi::Error::from_reason(format!("Failed to create runtime: {e}")))?;

  runtime.block_on(async {
    run_with_thread_event_callback(cli, linux_sandbox_path, move |event| {
      if let Ok(mut guard) = handler_for_callback.lock() {
        (*guard)(event);
      }
    })
    .await
    .map_err(|e| napi::Error::from_reason(e.to_string()))
  })
}

#[napi]
pub async fn run_thread(req: RunRequest) -> napi::Result<Vec<String>> {
  let options = req.into_internal()?;
  let events: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
  let error_holder: Arc<Mutex<Option<napi::Error>>> = Arc::new(Mutex::new(None));

  let events_clone = Arc::clone(&events);
  let error_clone = Arc::clone(&error_holder);

  tokio::task::spawn_blocking(move || {
    run_internal_sync(options, move |event| match event_to_json(&event) {
      Ok(value) => {
        if let Ok(mut guard) = events_clone.lock() {
          match serde_json::to_string(&value) {
            Ok(text) => guard.push(text),
            Err(err) => {
              if let Ok(mut error_guard) = error_clone.lock() {
                *error_guard = Some(napi::Error::from_reason(err.to_string()));
              }
            }
          }
        }
      }
      Err(err) => {
        if let Ok(mut guard) = error_clone.lock() {
          *guard = Some(err);
        }
      }
    })
  })
  .await
  .map_err(|e| napi::Error::from_reason(format!("Task join error: {e}")))??;

  if let Some(err) = error_holder.lock().unwrap().take() {
    return Err(err);
  }

  let mut guard = events.lock().unwrap();
  Ok(std::mem::take(&mut *guard))
}

#[napi]
pub async fn compact_thread(req: RunRequest) -> napi::Result<Vec<String>> {
  let options = req.into_internal()?;
  let events: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
  let error_holder: Arc<Mutex<Option<napi::Error>>> = Arc::new(Mutex::new(None));

  let events_clone = Arc::clone(&events);
  let error_clone = Arc::clone(&error_holder);

  tokio::task::spawn_blocking(move || {
    let schema_file = prepare_schema(options.output_schema.clone())?;
    let schema_path = schema_file.as_ref().map(|file| file.path.clone());
    let cli = build_cli(&options, schema_path, true);
    let pending_tools = {
      let guard = registered_native_tools()
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("tools mutex poisoned: {e}")))?;
      guard.clone()
    };
    set_pending_external_tools(pending_tools);
    let pending_interceptors = {
      let guard = registered_native_interceptors()
        .lock()
        .map_err(|e| napi::Error::from_reason(format!("interceptors mutex poisoned: {e}")))?;
      guard
        .iter()
        .map(|n| ExternalInterceptorRegistration {
          name: n.tool_name.clone(),
          handler: Arc::clone(&n.handler),
        })
        .collect::<Vec<_>>()
    };
    set_pending_external_interceptors(pending_interceptors);
    let linux_sandbox_path = if let Some(path) = options.linux_sandbox_path.clone() {
      Some(path)
    } else if let Ok(path) = std::env::var("CODEX_LINUX_SANDBOX_EXE") {
      Some(PathBuf::from(path))
    } else {
      default_linux_sandbox_path()?
    };
    let rt = tokio::runtime::Runtime::new().map_err(|e| napi::Error::from_reason(e.to_string()))?;
    rt.block_on(async move {
      let fut = run_with_thread_event_callback(cli, linux_sandbox_path, move |event| {
        match event_to_json(&event) {
          Ok(value) => {
            if let Ok(mut guard) = events_clone.lock() {
              match serde_json::to_string(&value) {
                Ok(text) => guard.push(text),
                Err(err) => {
                  if let Ok(mut error_guard) = error_clone.lock() {
                    *error_guard = Some(napi::Error::from_reason(err.to_string()));
                  }
                }
              }
            }
          }
          Err(err) => {
            if let Ok(mut guard) = error_clone.lock() {
              *guard = Some(err);
            }
          }
        }
      });
      fut
        .await
        .map_err(|e| napi::Error::from_reason(e.to_string()))
    })
  })
  .await
  .map_err(|e| napi::Error::from_reason(format!("Task join error: {e}")))??;

  if let Some(err) = error_holder.lock().unwrap().take() {
    return Err(err);
  }

  let mut guard = events.lock().unwrap();
  Ok(std::mem::take(&mut *guard))
}

#[napi]
pub async fn run_thread_stream(
  req: RunRequest,
  #[napi(ts_arg_type = "(err: unknown, eventJson?: string) => void")] on_event: ThreadsafeFunction<
    JsonValue,
  >,
) -> napi::Result<()> {
  let options = req.into_internal()?;
  let error_holder: Arc<Mutex<Option<napi::Error>>> = Arc::new(Mutex::new(None));
  let error_clone = Arc::clone(&error_holder);

  tokio::task::spawn_blocking(move || {
    run_internal_sync(options, move |event| match event_to_json(&event) {
      Ok(value) => match serde_json::to_string(&value) {
        Ok(text) => {
          let status = on_event.call(
            Ok(JsonValue::String(text)),
            ThreadsafeFunctionCallMode::NonBlocking,
          );
          if status != Status::Ok
            && let Ok(mut guard) = error_clone.lock()
          {
            *guard = Some(napi::Error::from_status(status));
          }
        }
        Err(err) => {
          if let Ok(mut guard) = error_clone.lock() {
            *guard = Some(napi::Error::from_reason(err.to_string()));
          }
        }
      },
      Err(err) => {
        if let Ok(mut guard) = error_clone.lock() {
          *guard = Some(err);
        }
      }
    })
  })
  .await
  .map_err(|e| napi::Error::from_reason(format!("Task join error: {e}")))??;

  if let Some(err) = error_holder.lock().unwrap().take() {
    return Err(err);
  }

  Ok(())
}

fn build_cloud_client(
  base_url: Option<String>,
  api_key: Option<String>,
) -> anyhow::Result<cloud::HttpClient> {
  let base = base_url.unwrap_or_else(|| "https://chatgpt.com/backend-api".to_string());
  let ua = default_client::get_codex_user_agent();
  let mut client = cloud::HttpClient::new(base.clone())?.with_user_agent(ua);
  if let Some(token) = api_key.or_else(|| std::env::var("CODEX_API_KEY").ok()) {
    client = client.with_bearer_token(token);
  }
  Ok(client)
}

#[napi(js_name = "cloudTasksList")]
pub async fn cloud_tasks_list(
  env_filter: Option<String>,
  base_url: Option<String>,
  api_key: Option<String>,
) -> napi::Result<String> {
  let client =
    build_cloud_client(base_url, api_key).map_err(|e| napi::Error::from_reason(e.to_string()))?;
  let tasks = cloud::CloudBackend::list_tasks(&client, env_filter.as_deref())
    .await
    .map_err(|e| napi::Error::from_reason(e.to_string()))?;
  serde_json::to_string(&tasks).map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi(js_name = "cloudTasksGetDiff")]
pub async fn cloud_tasks_get_diff(
  task_id: String,
  base_url: Option<String>,
  api_key: Option<String>,
) -> napi::Result<String> {
  let client =
    build_cloud_client(base_url, api_key).map_err(|e| napi::Error::from_reason(e.to_string()))?;
  let diff_opt = cloud::CloudBackend::get_task_diff(&client, cloud::TaskId(task_id))
    .await
    .map_err(|e| napi::Error::from_reason(e.to_string()))?;
  let payload = serde_json_json!({ "diff": diff_opt });
  serde_json::to_string(&payload).map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi(js_name = "cloudTasksApplyPreflight")]
pub async fn cloud_tasks_apply_preflight(
  task_id: String,
  diff_override: Option<String>,
  base_url: Option<String>,
  api_key: Option<String>,
) -> napi::Result<String> {
  let client =
    build_cloud_client(base_url, api_key).map_err(|e| napi::Error::from_reason(e.to_string()))?;
  let outcome =
    cloud::CloudBackend::apply_task_preflight(&client, cloud::TaskId(task_id), diff_override)
      .await
      .map_err(|e| napi::Error::from_reason(e.to_string()))?;
  serde_json::to_string(&outcome).map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi(js_name = "cloudTasksApply")]
pub async fn cloud_tasks_apply(
  task_id: String,
  diff_override: Option<String>,
  base_url: Option<String>,
  api_key: Option<String>,
) -> napi::Result<String> {
  let client =
    build_cloud_client(base_url, api_key).map_err(|e| napi::Error::from_reason(e.to_string()))?;
  let outcome = cloud::CloudBackend::apply_task(&client, cloud::TaskId(task_id), diff_override)
    .await
    .map_err(|e| napi::Error::from_reason(e.to_string()))?;
  serde_json::to_string(&outcome).map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi(js_name = "cloudTasksCreate")]
pub async fn cloud_tasks_create(
  env_id: String,
  prompt: String,
  git_ref: Option<String>,
  qa_mode: Option<bool>,
  best_of_n: Option<i32>,
  base_url: Option<String>,
  api_key: Option<String>,
) -> napi::Result<String> {
  let client =
    build_cloud_client(base_url, api_key).map_err(|e| napi::Error::from_reason(e.to_string()))?;
  let resolved_git_ref = if let Some(g) = git_ref {
    g
  } else if let Ok(cwd) = std::env::current_dir() {
    if let Some(branch) = codex_core::git_info::default_branch_name(&cwd).await {
      branch
    } else if let Some(branch) = codex_core::git_info::current_branch_name(&cwd).await {
      branch
    } else {
      "main".to_string()
    }
  } else {
    "main".to_string()
  };
  let created = cloud::CloudBackend::create_task(
    &client,
    &env_id,
    &prompt,
    &resolved_git_ref,
    qa_mode.unwrap_or(false),
    best_of_n.unwrap_or(1).max(1) as usize,
  )
  .await
  .map_err(|e| napi::Error::from_reason(e.to_string()))?;
  let payload = serde_json_json!({ "id": created.id.0 });
  serde_json::to_string(&payload).map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi]
pub fn ev_completed(id: String) -> String {
  let event = json!({
      "type": "response.completed",
      "response": {
          "id": id,
          "usage": {
              "input_tokens": 0,
              "input_tokens_details": null,
              "output_tokens": 0,
              "output_tokens_details": null,
              "total_tokens": 0
          }
      }
  });
  serde_json::to_string(&event).unwrap()
}

#[napi]
pub fn ev_response_created(id: String) -> String {
  let event = json!({
      "type": "response.created",
      "response": {
          "id": id,
      }
  });
  serde_json::to_string(&event).unwrap()
}

#[napi]
pub fn ev_assistant_message(id: String, text: String) -> String {
  let event = json!({
      "type": "response.output_item.done",
      "item": {
          "type": "message",
          "role": "assistant",
          "id": id,
          "content": [{"type": "output_text", "text": text}]
      }
  });
  serde_json::to_string(&event).unwrap()
}

#[napi]
pub fn ev_function_call(call_id: String, name: String, args: String) -> String {
  let event = json!({
      "type": "response.output_item.done",
      "item": {
          "type": "function_call",
          "id": call_id,
          "name": name,
          "call_id": call_id,
          "arguments": args
      }
  });
  serde_json::to_string(&event).unwrap()
}

#[napi]
pub fn sse(events: Vec<String>) -> String {
  events
    .into_iter()
    .map(|event_json| format!("event: response\ndata: {}\n\n", event_json))
    .collect()
}
