// Section 5: Event Helpers and SSE Formatting
// ============================================================================
//
// This section provides utility functions for creating and formatting
// Server-Sent Events (SSE) for streaming agent responses.
//
// Key exports:
//   - ev_completed(): Create completion event
//   - ev_response_created(): Create response creation event
//   - ev_assistant_message(): Create assistant message event
//   - ev_function_call(): Create function call event
//   - sse(): Format events as SSE stream
//
// ============================================================================

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

// ============================================================================
