use codex_native::*;
use pretty_assertions::assert_eq;
use serde_json::json;

fn base_run_request(prompt: &str) -> RunRequest {
  RunRequest {
    prompt: prompt.to_string(),
    thread_id: None,
    images: None,
    model: None,
    model_provider: None,
    oss: None,
    sandbox_mode: None,
    approval_mode: None,
    workspace_write_options: None,
    review_mode: None,
    review_hint: None,
    working_directory: None,
    skip_git_repo_check: None,
    output_schema: None,
    base_url: None,
    api_key: None,
    linux_sandbox_path: None,
    reasoning_effort: None,
    reasoning_summary: None,
    full_auto: None,
  }
}

#[test]
fn test_run_request_default_values() {
  let req = base_run_request("test prompt");

  assert_eq!(req.prompt, "test prompt");
  assert!(req.thread_id.is_none());
  assert!(req.images.is_none());
  assert!(req.full_auto.is_none());
  assert!(req.reasoning_effort.is_none());
  assert!(req.reasoning_summary.is_none());
}

#[test]
fn test_run_request_with_all_fields() {
  let schema = json!({
    "type": "object",
    "properties": {
      "name": {"type": "string"}
    }
  });

  let mut req = base_run_request("complex request");
  req.thread_id = Some("thread-123".to_string());
  req.images = Some(vec!["/path/to/image.png".to_string()]);
  req.model = Some("gpt-5-codex".to_string());
  req.oss = Some(true);
  req.sandbox_mode = Some("workspace-write".to_string());
  req.approval_mode = Some("never".to_string());
  req.working_directory = Some("/workspace".to_string());
  req.skip_git_repo_check = Some(true);
  req.output_schema = Some(schema.clone());
  req.base_url = Some("https://api.example.com".to_string());
  req.api_key = Some("sk-test-key".to_string());
  req.linux_sandbox_path = Some("/path/to/sandbox".to_string());
  req.full_auto = Some(true);
  req.review_mode = Some(false);
  req.reasoning_effort = Some("medium".to_string());
  req.reasoning_summary = Some("concise".to_string());

  assert_eq!(req.prompt, "complex request");
  assert_eq!(req.thread_id, Some("thread-123".to_string()));
  assert_eq!(req.images, Some(vec!["/path/to/image.png".to_string()]));
  assert_eq!(req.model, Some("gpt-5-codex".to_string()));
  assert_eq!(req.sandbox_mode, Some("workspace-write".to_string()));
  assert_eq!(req.oss, Some(true));
  assert_eq!(req.approval_mode, Some("never".to_string()));
  assert_eq!(req.full_auto, Some(true));
  assert_eq!(req.output_schema, Some(schema));
  assert_eq!(req.reasoning_effort, Some("medium".to_string()));
  assert_eq!(req.reasoning_summary, Some("concise".to_string()));
}

#[test]
fn test_run_request_review_mode_fields() {
  let mut req = base_run_request("review this code");
  req.review_mode = Some(true);
  req.review_hint = Some("security review".to_string());

  assert_eq!(req.review_mode, Some(true));
  assert_eq!(req.review_hint, Some("security review".to_string()));
}

#[cfg(feature = "napi-bindings")]
#[test]
fn test_native_tool_info_construction() {
  let tool_info = NativeToolInfo {
    name: "test_tool".to_string(),
    description: Some("A test tool".to_string()),
    parameters: Some(json!({
      "type": "object",
      "properties": {
        "input": {"type": "string"}
      }
    })),
    strict: Some(true),
    supports_parallel: Some(false),
  };

  assert_eq!(tool_info.name, "test_tool");
  assert_eq!(tool_info.description, Some("A test tool".to_string()));
  assert_eq!(tool_info.strict, Some(true));
  assert_eq!(tool_info.supports_parallel, Some(false));
}

#[cfg(feature = "napi-bindings")]
#[test]
fn test_native_tool_response_construction() {
  let response = NativeToolResponse {
    output: Some("tool output".to_string()),
    success: Some(true),
    error: None,
  };

  assert_eq!(response.output, Some("tool output".to_string()));
  assert_eq!(response.success, Some(true));
  assert!(response.error.is_none());
}

#[cfg(feature = "napi-bindings")]
#[test]
fn test_native_tool_response_with_error() {
  let response = NativeToolResponse {
    output: None,
    success: Some(false),
    error: Some("Tool failed".to_string()),
  };

  assert!(response.output.is_none());
  assert_eq!(response.success, Some(false));
  assert_eq!(response.error, Some("Tool failed".to_string()));
}

#[cfg(feature = "napi-bindings")]
#[test]
fn test_js_tool_invocation_function_payload() {
  let invocation = JsToolInvocation {
    call_id: "call-123".to_string(),
    tool_name: "my_tool".to_string(),
    arguments: Some(r#"{"key": "value"}"#.to_string()),
    input: None,
  };

  assert_eq!(invocation.call_id, "call-123");
  assert_eq!(invocation.tool_name, "my_tool");
  assert!(invocation.arguments.is_some());
  assert!(invocation.input.is_none());
}

#[cfg(feature = "napi-bindings")]
#[test]
fn test_js_tool_invocation_custom_payload() {
  let invocation = JsToolInvocation {
    call_id: "call-456".to_string(),
    tool_name: "custom_tool".to_string(),
    arguments: None,
    input: Some("raw input".to_string()),
  };

  assert_eq!(invocation.call_id, "call-456");
  assert_eq!(invocation.tool_name, "custom_tool");
  assert!(invocation.arguments.is_none());
  assert_eq!(invocation.input, Some("raw input".to_string()));
}

#[cfg(feature = "napi-bindings")]
#[test]
fn test_clear_registered_tools() {
  let result = clear_registered_tools();
  assert!(result.is_ok());
}

#[test]
fn test_sandbox_mode_values() {
  let modes = vec!["read-only", "workspace-write", "danger-full-access"];

  for mode in modes {
    let mut req = base_run_request("test");
    req.sandbox_mode = Some(mode.to_string());
    assert_eq!(req.sandbox_mode, Some(mode.to_string()));
  }
}
