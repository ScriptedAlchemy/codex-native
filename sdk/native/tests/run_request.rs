use codex_native::*;
use pretty_assertions::assert_eq;
use serde_json::json;

#[test]
fn test_run_request_default_values() {
  let req = RunRequest {
    prompt: "test prompt".to_string(),
    thread_id: None,
    images: None,
    model: None,
    sandbox_mode: None,
    working_directory: None,
    skip_git_repo_check: None,
    output_schema: None,
    base_url: None,
    api_key: None,
    linux_sandbox_path: None,
    full_auto: None,
    review_mode: None,
    review_hint: None,
  };

  // Verify struct construction works
  assert_eq!(req.prompt, "test prompt");
  assert!(req.thread_id.is_none());
  assert!(req.images.is_none());
  assert!(req.full_auto.is_none());
}

#[test]
fn test_run_request_with_all_fields() {
  let schema = json!({
    "type": "object",
    "properties": {
      "name": {"type": "string"}
    }
  });

  let req = RunRequest {
    prompt: "complex request".to_string(),
    thread_id: Some("thread-123".to_string()),
    images: Some(vec!["/path/to/image.png".to_string()]),
    model: Some("gpt-4".to_string()),
    sandbox_mode: Some("workspace-write".to_string()),
    working_directory: Some("/workspace".to_string()),
    skip_git_repo_check: Some(true),
    output_schema: Some(schema.clone()),
    base_url: Some("https://api.example.com".to_string()),
    api_key: Some("sk-test-key".to_string()),
    linux_sandbox_path: Some("/path/to/sandbox".to_string()),
    full_auto: Some(true),
    review_mode: Some(false),
    review_hint: None,
  };

  assert_eq!(req.prompt, "complex request");
  assert_eq!(req.thread_id, Some("thread-123".to_string()));
  assert_eq!(req.images, Some(vec!["/path/to/image.png".to_string()]));
  assert_eq!(req.model, Some("gpt-4".to_string()));
  assert_eq!(req.sandbox_mode, Some("workspace-write".to_string()));
  assert_eq!(req.full_auto, Some(true));
  assert_eq!(req.output_schema, Some(schema));
}

#[test]
fn test_run_request_review_mode() {
  let req = RunRequest {
    prompt: "review this code".to_string(),
    thread_id: None,
    images: None,
    model: None,
    sandbox_mode: None,
    working_directory: None,
    skip_git_repo_check: None,
    output_schema: None,
    base_url: None,
    api_key: None,
    linux_sandbox_path: None,
    full_auto: None,
    review_mode: Some(true),
    review_hint: Some("security review".to_string()),
  };

  assert_eq!(req.review_mode, Some(true));
  assert_eq!(req.review_hint, Some("security review".to_string()));
}

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

#[test]
fn test_clear_registered_tools() {
  let result = clear_registered_tools();
  assert!(result.is_ok());
}

#[test]
fn test_sandbox_mode_values() {
  let modes = vec!["read-only", "workspace-write", "danger-full-access"];

  for mode in modes {
    let req = RunRequest {
      prompt: "test".to_string(),
      thread_id: None,
      images: None,
      model: None,
      sandbox_mode: Some(mode.to_string()),
      working_directory: None,
      skip_git_repo_check: None,
      output_schema: None,
      base_url: None,
      api_key: None,
      linux_sandbox_path: None,
      full_auto: None,
      review_mode: None,
      review_hint: None,
    };

    assert_eq!(req.sandbox_mode, Some(mode.to_string()));
  }
}
