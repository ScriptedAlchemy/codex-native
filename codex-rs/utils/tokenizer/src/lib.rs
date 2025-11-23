use std::fmt;
use std::num::NonZeroUsize;
use std::sync::OnceLock;

use anyhow::Error as AnyhowError;
use codex_utils_cache::BlockingLruCache;
use thiserror::Error;
use tiktoken_rs::CoreBPE;

/// Supported local encodings.
#[derive(Debug, Clone, Copy)]
pub enum EncodingKind {
    O200kBase,
    Cl100kBase,
}

impl fmt::Display for EncodingKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = match self {
            EncodingKind::O200kBase => "o200k_base",
            EncodingKind::Cl100kBase => "cl100k_base",
        };
        write!(f, "{name}")
    }
}

#[derive(Debug, Error)]
pub enum TokenizerError {
    #[error("unknown encoding: {0}")]
    UnknownEncoding(String),
    #[error(transparent)]
    Other(#[from] AnyhowError),
}

/// Thin wrapper around tiktoken with caching to avoid repeated model loads.
pub struct Tokenizer {
    encoding: CoreBPE,
}

static ENCODING_CACHE: OnceLock<BlockingLruCache<String, CoreBPE>> = OnceLock::new();

impl Tokenizer {
    pub fn new(kind: EncodingKind) -> Result<Self, TokenizerError> {
        let name = kind.to_string();
        let encoding = Self::get_or_init_encoding(&name)?;
        Ok(Self { encoding })
    }

    pub fn for_model(model: &str) -> Result<Self, TokenizerError> {
        let encoding = tiktoken_rs::get_bpe_from_model(model)
            .map_err(|e| TokenizerError::Other(e.into()))?;
        Ok(Self { encoding })
    }

    pub fn try_default() -> Result<Self, TokenizerError> {
        Self::new(EncodingKind::Cl100kBase)
    }

    pub fn count(&self, text: &str) -> i64 {
        self.encoding.encode_with_special_tokens(text).len() as i64
    }

    pub fn encode(&self, text: &str, with_special_tokens: bool) -> Vec<i32> {
        if with_special_tokens {
            self.encoding.encode_with_special_tokens(text)
        } else {
            self.encoding.encode_ordinary(text)
        }
        .into_iter()
        .map(|t| t as i32)
        .collect()
    }

    pub fn decode(&self, tokens: &[i32]) -> Result<String, TokenizerError> {
        self.encoding
            .decode(tokens.iter().map(|t| *t as u32).collect())
            .map_err(|e| TokenizerError::Other(e.into()))
    }

    fn get_or_init_encoding(name: &str) -> Result<CoreBPE, TokenizerError> {
        let cache = ENCODING_CACHE.get_or_init(|| BlockingLruCache::new(NonZeroUsize::new(4).unwrap()));
        if let Some(enc) = cache.get(name) {
            return Ok(enc.clone());
        }

        let encoding = match name {
            "o200k_base" => tiktoken_rs::get_bpe_from_tokenizer(tiktoken_rs::cl100k_base().0.clone(), "o200k_base"),
            "cl100k_base" => tiktoken_rs::get_bpe_from_tokenizer(tiktoken_rs::cl100k_base().0.clone(), "cl100k_base"),
            other => return Err(TokenizerError::UnknownEncoding(other.to_string())),
        }
        .map_err(|e| TokenizerError::Other(e.into()))?;

        cache.insert(name.to_string(), encoding.clone());
        Ok(encoding)
    }
}
