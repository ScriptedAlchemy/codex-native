// Common test utilities shared across test files
use serde_json::json;

pub fn sample_output_schema() -> serde_json::Value {
  json!({
    "type": "object",
    "properties": {
      "result": {"type": "string"},
      "confidence": {"type": "number"}
    },
    "required": ["result"]
  })
}

pub fn sample_tool_parameters() -> serde_json::Value {
  json!({
    "type": "object",
    "properties": {
      "input": {"type": "string"},
      "options": {
        "type": "object",
        "properties": {
          "verbose": {"type": "boolean"}
        }
      }
    },
    "required": ["input"]
  })
}

