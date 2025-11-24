// Section 7: Tokenizer Helpers
// ============================================================================
// ============================================================================
// Section 7: Tokenizer Helpers
// ============================================================================

use tiktoken_rs::CoreBPE;
use tiktoken_rs::{cl100k_base, get_bpe_from_model, o200k_base};

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

fn map_tokenizer_error<E: std::fmt::Display>(err: E) -> napi::Error {
  napi::Error::from_reason(format!("Tokenizer error: {err}"))
}

fn encoding_from_name(name: &str) -> Option<CoreBPE> {
  let normalized = name.replace('-', "_").to_ascii_lowercase();
  match normalized.as_str() {
    "o200k_base" => o200k_base().ok(),
    "cl100k_base" => cl100k_base().ok(),
    _ => None,
  }
}

fn build_tokenizer(model: Option<&str>, encoding: Option<&str>) -> napi::Result<CoreBPE> {
  if let Some(enc_name) = encoding {
    encoding_from_name(enc_name)
      .ok_or_else(|| napi::Error::from_reason(format!("Unknown tokenizer encoding: {enc_name}")))
  } else if let Some(model_name) = model {
    get_bpe_from_model(model_name).map_err(map_tokenizer_error)
  } else {
    cl100k_base().map_err(map_tokenizer_error)
  }
}

#[napi]
pub fn tokenizer_count(text: String, options: Option<TokenizerBaseOptions>) -> napi::Result<i64> {
  let tokenizer = build_tokenizer(
    options.as_ref().and_then(|o| o.model.as_deref()),
    options.as_ref().and_then(|o| o.encoding.as_deref()),
  )?;
  Ok(tokenizer.encode_ordinary(&text).len() as i64)
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
  let tokens = if with_special_tokens {
    tokenizer.encode_with_special_tokens(&text)
  } else {
    tokenizer.encode_ordinary(&text)
  };
  Ok(tokens.into_iter().map(|t| t as i32).collect())
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
  let ids: Vec<u32> = tokens
    .iter()
    .map(|t| (*t).try_into().map_err(|_| map_tokenizer_error("token id must be non-negative")))
    .collect::<Result<_, _>>()?;
  tokenizer.decode(ids).map_err(map_tokenizer_error)
}
