use codex_protocol::models::FunctionCallOutputContentItem;
use codex_utils_string::{take_bytes_at_char_boundary, take_last_bytes_at_char_boundary};
use tracing::warn;

use crate::events::{FunctionCallOutputItem, FunctionCallOutputMetadata};

pub const MODEL_FORMAT_MAX_BYTES: usize = 10 * 1024;
pub const MODEL_FORMAT_HEAD_LINES: usize = 128;
pub const MODEL_FORMAT_TAIL_LINES: usize = 500;
pub const MODEL_FORMAT_MAX_LINES: usize = MODEL_FORMAT_HEAD_LINES + MODEL_FORMAT_TAIL_LINES;

#[allow(clippy::too_many_arguments)]
pub(crate) fn globally_truncate_function_output_items(
    items: &[FunctionCallOutputContentItem],
    max_bytes: usize,
    max_lines: usize,
    stop_text: &str,
    metadata: Option<&FunctionCallOutputMetadata>,
    events: &mut Vec<FunctionCallOutputItem>,
) -> Vec<FunctionCallOutputContentItem> {
    let mut truncated_items: Vec<FunctionCallOutputContentItem> = Vec::with_capacity(items.len());
    let mut total_bytes = 0usize;
    let mut total_lines = 0usize;
    let mut omitted_text_items = 0usize;
    let mut hit_stop_token = false;

    for item in items {
        match item {
            FunctionCallOutputContentItem::InputText { text } => {
                if hit_stop_token {
                    omitted_text_items += 1;
                    continue;
                }

                if let Some(idx) = text.find(stop_text) {
                    let truncated = &text[..idx];
                    if !truncated.is_empty() {
                        let (slice, lines, bytes) =
                            truncate_text(truncated, max_bytes, max_lines, total_bytes, total_lines);
                        if !slice.is_empty() {
                            truncated_items.push(FunctionCallOutputContentItem::InputText {
                                text: slice,
                            });
                            total_bytes += bytes;
                            total_lines += lines;
                        }
                    }
                    hit_stop_token = true;
                    continue;
                }

                if total_bytes >= max_bytes || total_lines >= max_lines {
                    omitted_text_items += 1;
                    continue;
                }

                let (slice, lines, bytes) =
                    truncate_text(text, max_bytes, max_lines, total_bytes, total_lines);
                if slice.is_empty() {
                    omitted_text_items += 1;
                    continue;
                }

                total_bytes += bytes;
                total_lines += lines;
                truncated_items.push(FunctionCallOutputContentItem::InputText { text: slice });
            }
            FunctionCallOutputContentItem::InputImage { image_url } => {
                truncated_items.push(FunctionCallOutputContentItem::InputImage {
                    image_url: image_url.clone(),
                });
            }
        }
    }

    if omitted_text_items > 0 {
        truncated_items.push(FunctionCallOutputContentItem::InputText {
            text: format!("[omitted {omitted_text_items} text items ...]"),
        });
    }

    if hit_stop_token && (metadata.is_none() || !metadata.unwrap().approx_untruncated.is_some()) {
        warn!("FunctionCallOutput truncated at stop token without approx_untruncated metadata");
    }

    events.push(FunctionCallOutputItem {
        metadata: metadata.cloned(),
        content: truncated_items.clone(),
    });

    truncated_items
}

fn truncate_text(
    text: &str,
    max_bytes: usize,
    max_lines: usize,
    total_bytes: usize,
    total_lines: usize,
) -> (String, usize, usize) {
    let mut slice = text;
    let mut slice_lines = slice.lines().count();
    let mut slice_bytes = slice.len();

    if total_bytes + slice_bytes > max_bytes {
        let allowed = max_bytes.saturating_sub(total_bytes);
        let truncated = take_bytes_at_char_boundary(slice, allowed);
        slice = truncated;
        slice_bytes = slice.len();
        slice_lines = slice.lines().count();
    }

    if total_lines + slice_lines > max_lines {
        let allowed = max_lines.saturating_sub(total_lines);
        let lines: Vec<&str> = slice.lines().collect();
        let (head, tail) = split_line_budget(allowed);
        let head_take = head.min(lines.len());
        let tail_take = tail.min(lines.len().saturating_sub(head_take));
        let omitted = lines.len().saturating_sub(head_take + tail_take);

        let head_slice = lines[..head_take].join("\n");
        let tail_slice = if tail_take == 0 {
            String::new()
        } else {
            lines[lines.len() - tail_take..].join("\n")
        };

        let mut truncated = String::new();
        truncated.push_str(&head_slice);
        if omitted > 0 {
            truncated.push_str(&format!(
                "\n[... omitted {omitted} of {} lines ...]\n\n",
                total_lines + slice_lines
            ));
        }
        truncated.push_str(&tail_slice);
        slice = &truncated;
        slice_lines = truncated.lines().count();
        slice_bytes = truncated.len();
        return (truncated, slice_lines, slice_bytes);
    }

    (slice.to_string(), slice_lines, slice_bytes)
}

fn split_line_budget(limit_lines: usize) -> (usize, usize) {
    if limit_lines == 0 {
        return (0, 0);
    }

    let head = ((limit_lines as u128 * MODEL_FORMAT_HEAD_LINES as u128)
        / MODEL_FORMAT_MAX_LINES as u128) as usize;
    let head = head.max(1).min(limit_lines);
    let tail = limit_lines.saturating_sub(head);

    (head, tail)
}
