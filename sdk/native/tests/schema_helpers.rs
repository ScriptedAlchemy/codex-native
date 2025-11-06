use codex_native::*;
use pretty_assertions::assert_eq;
use serde_json::json;

#[test]
fn test_prepare_schema_none() {
  let result = prepare_schema(None);
  assert!(result.is_ok());
  assert!(result.unwrap().is_none());
}

#[test]
fn test_prepare_schema_with_value() {
  let schema = json!({
    "type": "object",
    "properties": {
      "name": {"type": "string"}
    }
  });
  let result = prepare_schema(Some(schema.clone()));
  assert!(result.is_ok());
  let temp_file = result.unwrap();
  assert!(temp_file.is_some());

  let temp_file = temp_file.unwrap();
  assert!(temp_file.path.exists());

  let content = std::fs::read_to_string(&temp_file.path).unwrap();
  let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
  assert_eq!(parsed, schema);
}

#[test]
fn test_prepare_schema_with_complex_schema() {
  let schema = json!({
    "type": "object",
    "properties": {
      "result": {"type": "string"},
      "confidence": {"type": "number"},
      "tags": {
        "type": "array",
        "items": {"type": "string"}
      },
      "metadata": {
        "type": "object",
        "properties": {
          "timestamp": {"type": "string"},
          "version": {"type": "integer"}
        }
      }
    },
    "required": ["result"]
  });

  let result = prepare_schema(Some(schema.clone()));
  assert!(result.is_ok());
  let temp_file = result.unwrap().unwrap();

  let content = std::fs::read_to_string(&temp_file.path).unwrap();
  let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
  assert_eq!(parsed, schema);
}
