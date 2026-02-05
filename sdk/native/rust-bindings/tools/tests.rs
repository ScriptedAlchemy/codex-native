#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::{Arc, Mutex};

  #[test]
  fn list_registered_tools_returns_cloned_snapshot() {
    // seed registry mirrors
    {
      let mut infos = registered_tool_infos().lock().unwrap();
      infos.clear();
      infos.push(NativeToolInfo {
        name: "echo".to_string(),
        description: Some("Echo input".to_string()),
        parameters: Some(json!({ "type": "object" })),
        strict: Some(true),
        supports_parallel: Some(false),
      });
    }

    let listed = list_registered_tools().expect("should list tools");
    assert_eq!(listed.len(), 1);
    let echo = &listed[0];
    assert_eq!(echo.name, "echo");
    assert_eq!(echo.description.as_deref(), Some("Echo input"));
    assert_eq!(echo.strict, Some(true));
    assert_eq!(echo.supports_parallel, Some(false));

    // Ensure the returned vec is a snapshot (mutating does not affect registry)
    let mut listed_mut = listed;
    listed_mut[0].name = "mutated".to_string();
    let fresh = list_registered_tools().expect("should still list original");
    assert_eq!(fresh[0].name, "echo");
  }

  #[test]
  fn clear_registered_tools_clears_mirrors() {
    #[derive(Clone)]
    struct DummyHandler;

    #[async_trait::async_trait]
    impl ToolHandler for DummyHandler {
      fn kind(&self) -> ToolKind {
        ToolKind::Function
      }

      async fn handle(&self, invocation: ToolInvocation) -> Result<ToolOutput, FunctionCallError> {
        Ok(ToolOutput::Function {
          body: codex_protocol::models::FunctionCallOutputBody::Text(
            format!("ok:{}", invocation.tool_name),
          ),
          success: Some(true),
        })
      }
    }

    {
      registered_native_tools().lock().unwrap().push(ExternalToolRegistration {
        spec: create_function_tool_spec_from_schema(
          "echo".to_string(),
          Some("Echo".to_string()),
          json!({ "type": "object" }),
          false,
        )
        .unwrap(),
        handler: Arc::new(DummyHandler),
        supports_parallel_tool_calls: true,
      });
      registered_tool_infos().lock().unwrap().push(NativeToolInfo {
        name: "echo".to_string(),
        description: None,
        parameters: None,
        strict: None,
        supports_parallel: Some(true),
      });
    }

    clear_registered_tools().expect("clear should succeed");

    assert!(registered_native_tools().lock().unwrap().is_empty());
    assert!(registered_tool_infos().lock().unwrap().is_empty());
  }

  #[test]
  fn emit_background_event_notifies_registered_handler() {
    let thread_id = "test-thread";
    let received: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let collector = Arc::clone(&received);
    let handler: ThreadEventHandler = Arc::new(Mutex::new(Box::new(move |event| {
      if let ExecThreadEvent::BackgroundEvent(payload) = event {
        collector.lock().unwrap().push(payload.message);
      }
    })));
    register_thread_handler(thread_id, &handler);

    emit_background_event(JsEmitBackgroundEventRequest {
      thread_id: thread_id.to_string(),
      message: "LSP diagnostics ready".to_string(),
    })
    .expect("background event should dispatch");

    unregister_thread_handler(thread_id);

    let messages = received.lock().unwrap();
    assert_eq!(messages.as_slice(), &["LSP diagnostics ready"]);
  }
}
