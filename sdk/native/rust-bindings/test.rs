#[cfg(test)]
mod tests {
  use crate::{InternalRunRequest, run_internal_sync};
  use codex_core::protocol::ReviewRequest;
  use codex_exec::exec_events::{ThreadEvent, ThreadItemDetails};
  use std::sync::{Arc, Mutex};

  #[tokio::test]
  async fn test_review_flow() {
    // Create a temporary directory with sample code
    let temp_dir = tempfile::tempdir().expect("failed to create temp dir");
    let sample_file = temp_dir.path().join("sample.js");
    std::fs::write(
      &sample_file,
      r#"
// Sample code with issues
function calculateTotal(items) {
  var total = 0;
  for (var i = 0; i < items.length; i++) {
    total = total + items[i].price;
  }
  return total;
}
"#,
    )
    .expect("failed to write sample file");

    let events: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let events_clone = Arc::clone(&events);

    let options = InternalRunRequest {
      prompt:
        "Review the JavaScript code in sample.js. Look for outdated patterns and potential bugs."
          .to_string(),
      thread_id: None,
      images: Vec::new(),
      model: Some("gpt-5-codex".to_string()),
      sandbox_mode: None,
      working_directory: Some(temp_dir.path().to_path_buf()),
      skip_git_repo_check: true,
      output_schema: None,
      base_url: None,
      api_key: None,
      linux_sandbox_path: None,
      full_auto: true,
      review_request: Some(ReviewRequest {
        prompt:
          "Review the JavaScript code in sample.js. Look for outdated patterns and potential bugs."
            .to_string(),
        user_facing_hint: "JavaScript code review".to_string(),
      }),
    };

    let result = run_internal_sync(options, move |event| {
      let event_type = match &event {
        ThreadEvent::ThreadStarted(_) => "ThreadStarted",
        ThreadEvent::TurnStarted(_) => "TurnStarted",
        ThreadEvent::ItemStarted(_) => "ItemStarted",
        ThreadEvent::ItemUpdated(_) => "ItemUpdated",
        ThreadEvent::ItemCompleted(_) => "ItemCompleted",
        ThreadEvent::TurnCompleted(_) => "TurnCompleted",
        ThreadEvent::TurnFailed(_) => "TurnFailed",
        ThreadEvent::ExitedReviewMode(_) => "ExitedReviewMode",
        ThreadEvent::Error(_) => "Error",
      };

      if let Ok(mut guard) = events_clone.lock() {
        guard.push(event_type.to_string());
      }
    });

    match result {
      Ok(_) => {
        let captured = events.lock().unwrap();
        println!("Events captured: {:?}", *captured);

        // Check we got expected events
        assert!(
          captured.contains(&"ThreadStarted".to_string()),
          "Missing ThreadStarted event"
        );
        assert!(
          captured.contains(&"TurnStarted".to_string()),
          "Missing TurnStarted event"
        );
        assert!(
          captured.contains(&"TurnCompleted".to_string())
            || captured.contains(&"TurnFailed".to_string()),
          "Missing completion event"
        );
      }
      Err(e) => {
        panic!("Review flow failed: {}", e);
      }
    }
  }

  #[tokio::test]
  async fn test_basic_run_request() {
    let temp_dir = tempfile::tempdir().expect("failed to create temp dir");

    let options = InternalRunRequest {
      prompt: "What is 2+2? Answer with just the number.".to_string(),
      thread_id: None,
      images: Vec::new(),
      model: Some("gpt-5-codex".to_string()),
      sandbox_mode: None,
      working_directory: Some(temp_dir.path().to_path_buf()),
      skip_git_repo_check: true,
      output_schema: None,
      base_url: None,
      api_key: None,
      linux_sandbox_path: None,
      full_auto: true,
      review_request: None,
    };

    let events: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let events_clone = Arc::clone(&events);

    let result = run_internal_sync(options, move |event| {
      let event_type = match &event {
        ThreadEvent::ThreadStarted(_) => "ThreadStarted",
        ThreadEvent::TurnStarted(_) => "TurnStarted",
        ThreadEvent::ItemCompleted(ev) => {
          if let ThreadItemDetails::AgentMessage(msg) = &ev.item.details {
            println!("Agent message: {}", msg.text);
          }
          "ItemCompleted"
        }
        ThreadEvent::TurnCompleted(_) => "TurnCompleted",
        ThreadEvent::TurnFailed(_) => "TurnFailed",
        ThreadEvent::Error(_) => "Error",
        _ => "Other",
      };

      if let Ok(mut guard) = events_clone.lock() {
        guard.push(event_type.to_string());
      }
    });

    match result {
      Ok(_) => {
        let captured = events.lock().unwrap();
        println!("Events captured: {:?}", *captured);

        assert!(
          captured.contains(&"ThreadStarted".to_string()),
          "Missing ThreadStarted event"
        );
        assert!(
          captured.contains(&"ItemCompleted".to_string()),
          "Missing ItemCompleted event"
        );
      }
      Err(e) => {
        panic!("Basic run failed: {}", e);
      }
    }
  }
}
