use codex_exec::exec_events::{ThreadEvent, ThreadStartedEvent};
use codex_native::*;
use pretty_assertions::assert_eq;

#[test]
fn test_event_to_json_thread_started() {
  let event = ThreadEvent::ThreadStarted(ThreadStartedEvent {
    thread_id: "thread-123".to_string(),
  });

  let json = event_to_json(&event).unwrap();
  assert!(json.is_object());
  assert!(json.get("ThreadStarted").is_some());

  let thread_started = json.get("ThreadStarted").unwrap();
  assert_eq!(
    thread_started.get("thread_id").unwrap().as_str().unwrap(),
    "thread-123"
  );
}

#[test]
fn test_event_to_json_turn_started() {
  let event = ThreadEvent::TurnStarted(codex_exec::exec_events::TurnStartedEvent {});

  let json = event_to_json(&event).unwrap();
  assert!(json.is_object());
  assert!(json.get("TurnStarted").is_some());
}

#[test]
fn test_event_to_json_error() {
  let event = ThreadEvent::Error(codex_exec::exec_events::ThreadErrorEvent {
    message: "Something went wrong".to_string(),
  });

  let json = event_to_json(&event).unwrap();
  assert!(json.is_object());
  assert!(json.get("Error").is_some());

  let error = json.get("Error").unwrap();
  assert_eq!(
    error.get("message").unwrap().as_str().unwrap(),
    "Something went wrong"
  );
}
