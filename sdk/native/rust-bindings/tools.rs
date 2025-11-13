// Section 2: Tool Registration and Interceptors
// ============================================================================
//
// This section provides functionality for registering custom tools and
// interceptors from JavaScript/TypeScript code. Tools can replace or augment
// built-in Codex tools, and interceptors can modify tool invocations.
//
// Key exports:
//   - clear_registered_tools()
//   - register_tool()
//   - register_tool_interceptor()
//   - register_approval_callback()
//
// ============================================================================

fn registered_native_tools() -> &'static Mutex<Vec<ExternalToolRegistration>> {
  static TOOLS: OnceLock<Mutex<Vec<ExternalToolRegistration>>> = OnceLock::new();
  TOOLS.get_or_init(|| Mutex::new(Vec::new()))
}

fn pending_plan_updates()
-> &'static Mutex<HashMap<String, codex_protocol::plan_tool::UpdatePlanArgs>> {
  static UPDATES: OnceLock<Mutex<HashMap<String, codex_protocol::plan_tool::UpdatePlanArgs>>> =
    OnceLock::new();
  UPDATES.get_or_init(|| Mutex::new(HashMap::new()))
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

type ThreadEventHandler = Arc<Mutex<Box<dyn FnMut(ExecThreadEvent) + Send>>>;

fn active_thread_handlers() -> &'static Mutex<HashMap<String, ThreadEventHandler>> {
  static HANDLERS: OnceLock<Mutex<HashMap<String, ThreadEventHandler>>> = OnceLock::new();
  HANDLERS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_thread_handler(thread_id: &str, handler: &ThreadEventHandler) {
  if let Ok(mut map) = active_thread_handlers().lock() {
    map.insert(thread_id.to_string(), Arc::clone(handler));
  }
}

fn unregister_thread_handler(thread_id: &str) {
  if let Ok(mut map) = active_thread_handlers().lock() {
    map.remove(thread_id);
  }
}

fn dispatch_thread_event(handler: &ThreadEventHandler, event: ExecThreadEvent) -> napi::Result<()> {
  let mut guard = handler
    .lock()
    .map_err(|e| napi::Error::from_reason(format!("thread handler mutex poisoned: {e}")))?;
  (*guard)(event);
  Ok(())
}

fn cleanup_thread_handler(slot: &Arc<Mutex<Option<String>>>) {
  if let Ok(mut guard) = slot.lock()
    && let Some(id) = guard.take() {
      unregister_thread_handler(&id);
  }
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
  let sensitive_tools = ["local_shell", "exec_command", "apply_patch", "web_search"];

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
pub struct JsEmitBackgroundEventRequest {
  #[napi(js_name = "threadId")]
  pub thread_id: String,
  pub message: String,
}

#[derive(Clone)]
#[napi(object)]
pub struct JsEmitPlanUpdateRequest {
  pub thread_id: String,
  pub explanation: Option<String>,
  pub plan: Vec<JsPlanItem>,
}

#[derive(Clone)]
#[napi(object)]
pub struct JsPlanItem {
  pub step: String,
  pub status: Option<String>, // "pending", "in_progress", "completed"
}

#[derive(Clone)]
#[napi(object)]
pub struct JsModifyPlanRequest {
  pub thread_id: String,
  pub operations: Vec<JsPlanOperation>,
}

#[derive(Clone)]
#[napi(object)]
pub struct JsPlanOperation {
  pub type_: String, // "add", "update", "remove", "reorder"
  pub item: Option<JsPlanItem>,
  pub index: Option<i32>,
  pub updates: Option<JsPlanUpdate>,
  pub new_order: Option<Vec<i32>>,
}

#[derive(Clone)]
#[napi(object)]
pub struct JsPlanUpdate {
  pub step: Option<String>,
  pub status: Option<String>,
}

#[napi]
pub fn emit_background_event(req: JsEmitBackgroundEventRequest) -> napi::Result<()> {
  let handler = {
    let map = active_thread_handlers()
      .lock()
      .map_err(|e| napi::Error::from_reason(format!("thread handlers mutex poisoned: {e}")))?;
    map.get(&req.thread_id).cloned()
  };

  let handler = handler.ok_or_else(|| {
    napi::Error::from_reason(format!(
      "No active run for thread {}. Mid-turn notifications require an ongoing runStreamed call.",
      req.thread_id
    ))
  })?;

  dispatch_thread_event(
    &handler,
    ExecThreadEvent::BackgroundEvent(BackgroundEventEvent {
      message: req.message,
    }),
  )
}

#[napi]
pub fn emit_plan_update(req: JsEmitPlanUpdateRequest) -> napi::Result<()> {
  let plan_items = req
    .plan
    .into_iter()
    .map(|item| {
      let status_str = item.status.as_deref().unwrap_or("pending");
      let status = match status_str {
        "pending" => codex_protocol::plan_tool::StepStatus::Pending,
        "in_progress" => codex_protocol::plan_tool::StepStatus::InProgress,
        "completed" => codex_protocol::plan_tool::StepStatus::Completed,
        _ => {
          return Err(napi::Error::from_reason(format!(
            "Invalid status: {}",
            status_str
          )));
        }
      };
      Ok(codex_protocol::plan_tool::PlanItemArg {
        step: item.step,
        status,
      })
    })
    .collect::<Result<Vec<_>, _>>()?;

  let args = codex_protocol::plan_tool::UpdatePlanArgs {
    explanation: req.explanation,
    plan: plan_items,
  };

  pending_plan_updates()
    .lock()
    .map_err(|e| napi::Error::from_reason(format!("plan updates mutex poisoned: {e}")))?
    .insert(req.thread_id, args);

  Ok(())
}

#[napi]
pub fn modify_plan(req: JsModifyPlanRequest) -> napi::Result<()> {
  let mut pending_updates = pending_plan_updates()
    .lock()
    .map_err(|e| napi::Error::from_reason(format!("plan updates mutex poisoned: {e}")))?;

  let current_plan = pending_updates.get(&req.thread_id).cloned();

  let mut plan_items = if let Some(existing) = current_plan {
    existing.plan
  } else {
    Vec::new()
  };

  for op in req.operations {
    match op.type_.as_str() {
      "add" => {
        if let Some(item) = op.item {
          let status_str = item.status.as_deref().unwrap_or("pending");
          let status = match status_str {
            "pending" => codex_protocol::plan_tool::StepStatus::Pending,
            "in_progress" => codex_protocol::plan_tool::StepStatus::InProgress,
            "completed" => codex_protocol::plan_tool::StepStatus::Completed,
            _ => codex_protocol::plan_tool::StepStatus::Pending,
          };
          plan_items.push(codex_protocol::plan_tool::PlanItemArg {
            step: item.step,
            status,
          });
        }
      }
      "update" => {
        if let (Some(index), Some(updates)) = (op.index, op.updates) {
          let idx = index as usize;
          if idx < plan_items.len() {
            let item = &mut plan_items[idx];
            if let Some(new_step) = updates.step.filter(|step| !step.is_empty()) {
              item.step = new_step;
            }
            if let Some(status_str) = updates.status.as_deref() {
              let status = match status_str {
                "pending" => codex_protocol::plan_tool::StepStatus::Pending,
                "in_progress" => codex_protocol::plan_tool::StepStatus::InProgress,
                "completed" => codex_protocol::plan_tool::StepStatus::Completed,
                _ => item.status.clone(),
              };
              item.status = status;
            }
          }
        }
      }
      "remove" => {
        if let Some(index) = op.index {
          let idx = index as usize;
          if idx < plan_items.len() {
            plan_items.remove(idx);
          }
        }
      }
      "reorder" => {
        if let Some(new_order) = op.new_order {
          let mut reordered = Vec::new();
          for &idx in &new_order {
            let idx = idx as usize;
            if idx < plan_items.len() {
              reordered.push(plan_items[idx].clone());
            }
          }
          if reordered.len() == plan_items.len() {
            plan_items = reordered;
          }
        }
      }
      _ => {}
    }
  }

  let args = codex_protocol::plan_tool::UpdatePlanArgs {
    explanation: None, // Could be extended to support per-operation explanations
    plan: plan_items,
  };

  pending_updates.insert(req.thread_id, args);

  Ok(())
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

