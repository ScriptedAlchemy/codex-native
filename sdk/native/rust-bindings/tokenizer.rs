// Section 7: Tokenizer Helpers
// ============================================================================
// ============================================================================
// Section 7: Tokenizer Helpers
// ============================================================================

#[napi(object)]
pub struct TokenizerBaseOptions {
  pub model: Option<String>,
  #[napi(ts_type = "\"o200k_base\" | \"cl100k_base\"")]
  pub encoding: Option<String>,
}

#[napi(object)]
pub struct TokenizerEncodeOptions {
  pub model: Option<String>,
  #[napi(ts_type = "\"o200k_base\" | \"cl100k_base\"")]
  pub encoding: Option<String>,
  #[napi(js_name = "withSpecialTokens")]
  pub with_special_tokens: Option<bool>,
}

fn map_tokenizer_error(err: TokenizerError) -> napi::Error {
  napi::Error::from_reason(format!("Tokenizer error: {err}"))
}

fn parse_encoding(name: &str) -> Option<EncodingKind> {
  let normalized = name.replace('-', "_").to_ascii_lowercase();
  match normalized.as_str() {
    "o200k_base" => Some(EncodingKind::O200kBase),
    "cl100k_base" => Some(EncodingKind::Cl100kBase),
    _ => None,
  }
}

fn build_tokenizer(model: Option<&str>, encoding: Option<&str>) -> napi::Result<Tokenizer> {
  if let Some(enc_name) = encoding {
    if let Some(kind) = parse_encoding(enc_name) {
      Tokenizer::new(kind).map_err(map_tokenizer_error)
    } else {
      Err(napi::Error::from_reason(format!(
        "Unknown tokenizer encoding: {enc_name}"
      )))
    }
  } else if let Some(model_name) = model {
    Tokenizer::for_model(model_name).map_err(map_tokenizer_error)
  } else {
    Tokenizer::try_default().map_err(map_tokenizer_error)
  }
}

#[napi]
pub fn tokenizer_count(text: String, options: Option<TokenizerBaseOptions>) -> napi::Result<i64> {
  let tokenizer = build_tokenizer(
    options.as_ref().and_then(|o| o.model.as_deref()),
    options.as_ref().and_then(|o| o.encoding.as_deref()),
  )?;
  Ok(tokenizer.count(&text))
}

#[napi]
pub fn tokenizer_encode(
  text: String,
  options: Option<TokenizerEncodeOptions>,
) -> napi::Result<Vec<i32>> {
  let tokenizer = build_tokenizer(
    options.as_ref().and_then(|o| o.model.as_deref()),
    options.as_ref().and_then(|o| o.encoding.as_deref()),
  )?;
  let with_special_tokens = options
    .as_ref()
    .and_then(|o| o.with_special_tokens)
    .unwrap_or(false);
  Ok(tokenizer.encode(&text, with_special_tokens))
}

#[napi]
pub fn tokenizer_decode(
  tokens: Vec<i32>,
  options: Option<TokenizerBaseOptions>,
) -> napi::Result<String> {
  let tokenizer = build_tokenizer(
    options.as_ref().and_then(|o| o.model.as_deref()),
    options.as_ref().and_then(|o| o.encoding.as_deref()),
  )?;
  tokenizer.decode(&tokens).map_err(map_tokenizer_error)
}

