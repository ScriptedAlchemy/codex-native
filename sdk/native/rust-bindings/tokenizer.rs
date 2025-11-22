// ============================================================================
// Section 7: Tokenizer Helpers
// ============================================================================

// OnceLock is already imported in lib.rs
use tiktoken_rs::get_bpe_from_model;

// Cache tokenizers to avoid recreating them
static CL100K_BASE: OnceLock<CoreBPE> = OnceLock::new();
static O200K_BASE: OnceLock<CoreBPE> = OnceLock::new();

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

fn get_tokenizer(model: Option<&str>, encoding: Option<&str>) -> napi::Result<&'static CoreBPE> {
  // If encoding is specified, use that
  if let Some(enc_name) = encoding {
    let normalized = enc_name.replace('-', "_").to_ascii_lowercase();
    match normalized.as_str() {
      "o200k_base" => {
        Ok(O200K_BASE.get_or_init(|| {
          tiktoken_rs::o200k_base().expect("Failed to initialize o200k_base tokenizer")
        }))
      }
      "cl100k_base" => {
        Ok(CL100K_BASE.get_or_init(|| {
          tiktoken_rs::cl100k_base().expect("Failed to initialize cl100k_base tokenizer")
        }))
      }
      _ => Err(napi::Error::from_reason(format!(
        "Unknown tokenizer encoding: {enc_name}"
      )))
    }
  } else if let Some(model_name) = model {
    // Try to get tokenizer for the specified model
    match get_bpe_from_model(model_name) {
      Ok(bpe) => {
        // Cache the model's tokenizer based on its type
        // For simplicity, we'll detect if it's cl100k or o200k based on model name
        if model_name.contains("gpt-4") || model_name.contains("gpt-3.5") {
          Ok(CL100K_BASE.get_or_init(|| bpe))
        } else if model_name.contains("gpt-5") || model_name.contains("o200k") {
          Ok(O200K_BASE.get_or_init(|| bpe))
        } else {
          // Default to cl100k_base for unknown models
          Ok(CL100K_BASE.get_or_init(|| bpe))
        }
      }
      Err(e) => Err(napi::Error::from_reason(format!(
        "Failed to get tokenizer for model {}: {}",
        model_name, e
      )))
    }
  } else {
    // Default to cl100k_base (GPT-4 compatible)
    Ok(CL100K_BASE.get_or_init(|| {
      tiktoken_rs::cl100k_base().expect("Failed to initialize cl100k_base tokenizer")
    }))
  }
}

#[napi]
pub fn tokenizer_count(text: String, options: Option<TokenizerBaseOptions>) -> napi::Result<i64> {
  let tokenizer = get_tokenizer(
    options.as_ref().and_then(|o| o.model.as_deref()),
    options.as_ref().and_then(|o| o.encoding.as_deref()),
  )?;

  // tiktoken-rs encode returns a Vec<usize>, we need to count tokens
  let tokens = tokenizer.encode_ordinary(&text);
  Ok(tokens.len() as i64)
}

#[napi]
pub fn tokenizer_encode(
  text: String,
  options: Option<TokenizerEncodeOptions>,
) -> napi::Result<Vec<i32>> {
  let tokenizer = get_tokenizer(
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

  // Convert usize tokens to i32 for JavaScript compatibility
  Ok(tokens.into_iter().map(|t| t as i32).collect())
}

#[napi]
pub fn tokenizer_decode(
  tokens: Vec<i32>,
  options: Option<TokenizerBaseOptions>,
) -> napi::Result<String> {
  let tokenizer = get_tokenizer(
    options.as_ref().and_then(|o| o.model.as_deref()),
    options.as_ref().and_then(|o| o.encoding.as_deref()),
  )?;

  // Convert i32 tokens back to usize for tiktoken-rs
  let tokens_usize: Vec<usize> = tokens.into_iter().map(|t| t as usize).collect();

  match tokenizer.decode(tokens_usize) {
    Ok(text) => Ok(text),
    Err(e) => Err(napi::Error::from_reason(format!(
      "Failed to decode tokens: {}",
      e
    )))
  }
}

