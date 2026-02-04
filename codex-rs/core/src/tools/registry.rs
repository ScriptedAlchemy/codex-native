use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::Duration;

use async_trait::async_trait;
use codex_protocol::models::ResponseInputItem;
use codex_utils_readiness::Readiness;
use tracing::error;
use tracing::trace;
use tracing::warn;

use crate::client_common::tools::ToolSpec;
use crate::function_tool::FunctionCallError;
use crate::tools::context::ToolInvocation;
use crate::tools::context::ToolOutput;
use crate::tools::context::ToolPayload;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ToolKind {
    Function,
    Mcp,
}

/// Registration describing an external tool handler supplied by native bindings.
#[allow(dead_code)]
#[derive(Clone)]
pub struct ExternalToolRegistration {
    pub spec: ToolSpec,
    pub handler: Arc<dyn ToolHandler>,
    pub supports_parallel_tool_calls: bool,
}

/// Registration describing an interceptor that can wrap a builtin/registered tool.
#[allow(dead_code)]
#[derive(Clone)]
pub struct ExternalInterceptorRegistration {
    pub name: String,
    pub handler: Arc<dyn ToolInterceptor>,
}

impl std::fmt::Debug for ExternalToolRegistration {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ExternalToolRegistration")
            .field("name", &self.spec.name())
            .field(
                "supports_parallel_tool_calls",
                &self.supports_parallel_tool_calls,
            )
            .finish()
    }
}

impl std::fmt::Debug for ExternalInterceptorRegistration {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ExternalInterceptorRegistration")
            .field("name", &self.name)
            .finish()
    }
}

#[allow(dead_code)]
fn pending_external_tools() -> &'static Mutex<Vec<ExternalToolRegistration>> {
    static PENDING: OnceLock<Mutex<Vec<ExternalToolRegistration>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(Vec::new()))
}

/// Set the list of external tools to be registered for the next session/router build.
#[allow(dead_code)]
pub fn set_pending_external_tools(tools: Vec<ExternalToolRegistration>) {
    match pending_external_tools().lock() {
        Ok(mut guard) => {
            *guard = tools;
        }
        Err(err) => {
            error!(
                error = ?err,
                "failed to acquire pending external tools mutex; pending tools unchanged"
            );
        }
    }
}

#[allow(dead_code)]
pub(crate) fn take_pending_external_tools() -> Vec<ExternalToolRegistration> {
    match pending_external_tools().lock() {
        Ok(mut guard) => {
            let tools = guard.clone();
            guard.clear();
            tools
        }
        Err(err) => {
            error!(
                error = ?err,
                "failed to acquire pending external tools mutex; returning empty list"
            );
            Vec::new()
        }
    }
}

#[allow(dead_code)]
fn pending_external_interceptors() -> &'static Mutex<Vec<ExternalInterceptorRegistration>> {
    static PENDING: OnceLock<Mutex<Vec<ExternalInterceptorRegistration>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(Vec::new()))
}

/// Set the list of external interceptors to be registered for the next session/router build.
#[allow(dead_code)]
pub fn set_pending_external_interceptors(interceptors: Vec<ExternalInterceptorRegistration>) {
    match pending_external_interceptors().lock() {
        Ok(mut guard) => {
            *guard = interceptors;
        }
        Err(err) => {
            error!(
                error = ?err,
                "failed to acquire pending external interceptors mutex; pending interceptors unchanged"
            );
        }
    }
}

#[allow(dead_code)]
pub(crate) fn take_pending_external_interceptors() -> Vec<ExternalInterceptorRegistration> {
    match pending_external_interceptors().lock() {
        Ok(mut guard) => {
            let list = guard.clone();
            guard.clear();
            list
        }
        Err(err) => {
            error!(
                error = ?err,
                "failed to acquire pending external interceptors mutex; returning empty list"
            );
            Vec::new()
        }
    }
}

#[async_trait]
pub trait ToolHandler: Send + Sync {
    fn kind(&self) -> ToolKind;

    fn matches_kind(&self, payload: &ToolPayload) -> bool {
        matches!(
            (self.kind(), payload),
            (ToolKind::Function, ToolPayload::Function { .. })
                | (ToolKind::Mcp, ToolPayload::Mcp { .. })
        )
    }

    /// Returns `true` if the [ToolInvocation] *might* mutate the environment of the
    /// user (through file system, OS operations, ...).
    /// This function must remains defensive and return `true` if a doubt exist on the
    /// exact effect of a ToolInvocation.
    async fn is_mutating(&self, _invocation: &ToolInvocation) -> bool {
        false
    }

    /// Perform the actual [ToolInvocation] and returns a [ToolOutput] containing
    /// the final output to return to the model.
    async fn handle(&self, invocation: ToolInvocation) -> Result<ToolOutput, FunctionCallError>;
}

#[async_trait]
pub trait ToolInterceptor: Send + Sync {
    async fn intercept(
        &self,
        invocation: ToolInvocation,
        next: Box<
            dyn FnOnce(
                    ToolInvocation,
                ) -> Pin<
                    Box<dyn Future<Output = Result<ToolOutput, FunctionCallError>> + Send>,
                > + Send,
        >,
    ) -> Result<ToolOutput, FunctionCallError>;
}

pub struct ToolRegistry {
    handlers: HashMap<String, Arc<dyn ToolHandler>>,
    interceptors: HashMap<String, Vec<Arc<dyn ToolInterceptor>>>,
}

impl ToolRegistry {
    pub fn new(
        handlers: HashMap<String, Arc<dyn ToolHandler>>,
        interceptors: HashMap<String, Vec<Arc<dyn ToolInterceptor>>>,
    ) -> Self {
        Self {
            handlers,
            interceptors,
        }
    }

    pub fn handler(&self, name: &str) -> Option<Arc<dyn ToolHandler>> {
        self.handlers.get(name).map(Arc::clone)
    }

    // TODO(jif) for dynamic tools.
    // pub fn register(&mut self, name: impl Into<String>, handler: Arc<dyn ToolHandler>) {
    //     let name = name.into();
    //     if self.handlers.insert(name.clone(), handler).is_some() {
    //         warn!("overwriting handler for tool {name}");
    //     }
    // }

    pub async fn dispatch(
        &self,
        invocation: ToolInvocation,
    ) -> Result<ResponseInputItem, FunctionCallError> {
        let tool_name = invocation.tool_name.clone();
        let call_id_owned = invocation.call_id.clone();
        let otel = invocation.turn.otel_manager.clone();
        let payload_for_response = invocation.payload.clone();
        let log_payload = payload_for_response.log_payload();

        let handler = match self.handler(tool_name.as_ref()) {
            Some(handler) => handler,
            None => {
                let message =
                    unsupported_tool_call_message(&invocation.payload, tool_name.as_ref());
                otel.tool_result(
                    tool_name.as_ref(),
                    &call_id_owned,
                    log_payload.as_ref(),
                    Duration::ZERO,
                    false,
                    &message,
                );
                return Err(FunctionCallError::RespondToModel(message));
            }
        };

        if !handler.matches_kind(&invocation.payload) {
            let message = format!("tool {tool_name} invoked with incompatible payload");
            otel.tool_result(
                tool_name.as_ref(),
                &call_id_owned,
                log_payload.as_ref(),
                Duration::ZERO,
                false,
                &message,
            );
            return Err(FunctionCallError::Fatal(message));
        }

        // If interceptors are registered for this tool, compose them; otherwise call handler.
        if let Some(list) = self.interceptors.get(&tool_name) {
            // Compose a simple chain: first interceptor gets the original handler as `next`.
            // For minimalism we apply the interceptors in registration order, without nesting chains.
            // Only the first interceptor is applied to keep complexity low.
            if let Some(interceptor) = list.first() {
                let next_handler = handler.clone();
                let call_id_owned = invocation.call_id.clone();
                let result = otel
                    .log_tool_result(
                        tool_name.as_ref(),
                        &call_id_owned,
                        log_payload.as_ref(),
                        || {
                            let interceptor = interceptor.clone();
                            let next_handler = next_handler.clone();
                            let invocation = invocation.clone();
                            async move {
                                let next = move |inv: ToolInvocation| {
                                    let next_handler = next_handler.clone();
                                    Box::pin(async move {
                                        wait_for_tool_gate_if_needed(&next_handler, &inv).await;
                                        next_handler.handle(inv).await
                                    })
                                        as Pin<
                                            Box<
                                                dyn Future<
                                                        Output = Result<
                                                            ToolOutput,
                                                            FunctionCallError,
                                                        >,
                                                    > + Send,
                                            >,
                                        >
                                };
                                match interceptor.intercept(invocation, Box::new(next)).await {
                                    Ok(output) => {
                                        let preview = output.log_preview();
                                        let success = output.success_for_logging();
                                        Ok((preview, success))
                                    }
                                    Err(err) => Err(err),
                                }
                            }
                        },
                    )
                    .await;

                return match result {
                    Ok(_) => {
                        // We need to re-run the interceptor to actually get the ToolOutput to return.
                        // To avoid double-call, simply call the handler and ignore preview/success;
                        // The otel log already captured the metadata.
                        wait_for_tool_gate_if_needed(&handler, &invocation).await;
                        let out = handler.handle(invocation).await?;
                        Ok(out.into_response(&call_id_owned, &payload_for_response))
                    }
                    Err(err) => Err(err),
                };
            }
        }

        // No interceptors; call the handler directly and log via OTEL wrapper.
        let call_id_owned = invocation.call_id.clone();
        let output_cell = tokio::sync::Mutex::new(None);
        let result = otel
            .log_tool_result(
                tool_name.as_ref(),
                &call_id_owned,
                log_payload.as_ref(),
                || {
                    let handler = handler.clone();
                    let output_cell = &output_cell;
                    let invocation = invocation;
                    async move {
                        wait_for_tool_gate_if_needed(&handler, &invocation).await;
                        match handler.handle(invocation).await {
                            Ok(output) => {
                                let preview = output.log_preview();
                                let success = output.success_for_logging();
                                let mut guard = output_cell.lock().await;
                                *guard = Some(output);
                                Ok((preview, success))
                            }
                            Err(err) => Err(err),
                        }
                    }
                },
            )
            .await;

        match result {
            Ok(_) => {
                let mut guard = output_cell.lock().await;
                let output = guard.take().ok_or_else(|| {
                    FunctionCallError::Fatal("tool produced no output".to_string())
                })?;
                Ok(output.into_response(&call_id_owned, &payload_for_response))
            }
            Err(err) => Err(err),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConfiguredToolSpec {
    pub spec: ToolSpec,
    pub supports_parallel_tool_calls: bool,
}

impl ConfiguredToolSpec {
    pub fn new(spec: ToolSpec, supports_parallel_tool_calls: bool) -> Self {
        Self {
            spec,
            supports_parallel_tool_calls,
        }
    }
}

pub struct ToolRegistryBuilder {
    handlers: HashMap<String, Arc<dyn ToolHandler>>,
    specs: Vec<ConfiguredToolSpec>,
    interceptors: HashMap<String, Vec<Arc<dyn ToolInterceptor>>>,
}

impl ToolRegistryBuilder {
    pub fn new() -> Self {
        Self {
            handlers: HashMap::new(),
            specs: Vec::new(),
            interceptors: HashMap::new(),
        }
    }

    pub fn push_spec(&mut self, spec: ToolSpec) {
        self.push_spec_with_parallel_support(spec, false);
    }

    pub fn push_spec_with_parallel_support(
        &mut self,
        spec: ToolSpec,
        supports_parallel_tool_calls: bool,
    ) {
        self.specs
            .push(ConfiguredToolSpec::new(spec, supports_parallel_tool_calls));
    }

    #[allow(dead_code)]
    pub fn upsert_spec_with_parallel_support(
        &mut self,
        spec: ToolSpec,
        supports_parallel_tool_calls: bool,
    ) {
        let name = spec.name().to_string();
        if let Some(existing) = self
            .specs
            .iter_mut()
            .find(|configured| configured.spec.name() == name)
        {
            existing.spec = spec;
            existing.supports_parallel_tool_calls = supports_parallel_tool_calls;
        } else {
            self.push_spec_with_parallel_support(spec, supports_parallel_tool_calls);
        }
    }

    pub fn register_handler(&mut self, name: impl Into<String>, handler: Arc<dyn ToolHandler>) {
        let name = name.into();
        if self
            .handlers
            .insert(name.clone(), handler.clone())
            .is_some()
        {
            warn!("overwriting handler for tool {name}");
        }
    }

    #[allow(dead_code)]
    pub fn register_interceptor(
        &mut self,
        name: impl Into<String>,
        interceptor: Arc<dyn ToolInterceptor>,
    ) {
        let name = name.into();
        self.interceptors.entry(name).or_default().push(interceptor);
    }

    // TODO(jif) for dynamic tools.
    // pub fn register_many<I>(&mut self, names: I, handler: Arc<dyn ToolHandler>)
    // where
    //     I: IntoIterator,
    //     I::Item: Into<String>,
    // {
    //     for name in names {
    //         let name = name.into();
    //         if self
    //             .handlers
    //             .insert(name.clone(), handler.clone())
    //             .is_some()
    //         {
    //             warn!("overwriting handler for tool {name}");
    //         }
    //     }
    // }

    pub fn build(self) -> (Vec<ConfiguredToolSpec>, ToolRegistry) {
        let mut specs = self.specs;
        let mut handlers = self.handlers;
        let mut interceptors = self.interceptors;

        // Attach any external tools registered by native bindings for this build.
        for external in take_pending_external_tools() {
            let name = external.spec.name().to_string();
            specs.push(ConfiguredToolSpec::new(
                external.spec,
                external.supports_parallel_tool_calls,
            ));
            if handlers.insert(name.clone(), external.handler).is_some() {
                warn!("overwriting handler for tool {name}");
            }
        }

        // Attach any external interceptors that wrap builtin or external tools.
        for external in take_pending_external_interceptors() {
            interceptors
                .entry(external.name.clone())
                .or_default()
                .push(external.handler);
        }

        let registry = ToolRegistry::new(handlers, interceptors);
        (specs, registry)
    }
}

async fn wait_for_tool_gate_if_needed(handler: &Arc<dyn ToolHandler>, invocation: &ToolInvocation) {
    if handler.is_mutating(invocation).await {
        trace!("waiting for tool gate");
        invocation.turn.tool_call_gate.wait_ready().await;
        trace!("tool gate released");
    }
}

fn unsupported_tool_call_message(payload: &ToolPayload, tool_name: &str) -> String {
    match payload {
        ToolPayload::Custom { .. } => format!("unsupported custom tool call: {tool_name}"),
        _ => format!("unsupported call: {tool_name}"),
    }
}
