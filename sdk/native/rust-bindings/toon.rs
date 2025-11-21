use napi::Error;

pub(crate) fn encode_json_value_to_toon(value: &JsonValue) -> Option<String> {
  toon_rust::encode(value, None).ok()
}

#[napi]
pub fn toon_encode(value: JsonValue) -> napi::Result<String> {
  toon_rust::encode(&value, None).map_err(|err| Error::from_reason(format!(
    "Failed to encode value to TOON: {err}",
  )))
}
