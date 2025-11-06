use codex_core::protocol::{Event, EventMsg, TokenUsage};
use codex_exec::exec_events::{ThreadEvent, ThreadItemDetails};
use codex_native::*;
use pretty_assertions::assert_eq;

#[test]
fn test_review_event_collector_next_item_id() {
  let mut collector = ReviewEventCollector::new();
  assert_eq!(collector.next_item_id(), "item_0");
  assert_eq!(collector.next_item_id(), "item_1");
  assert_eq!(collector.next_item_id(), "item_2");
}

#[test]
fn test_review_event_collector_next_item_id_sequence() {
  let mut collector = ReviewEventCollector::new();
  assert_eq!(collector.next_item_id, 0);
  let _id = collector.next_item_id();
  assert_eq!(collector.next_item_id, 1);
}

#[test]
fn test_review_event_collector_task_started() {
  let mut collector = ReviewEventCollector::new();
  let event = Event {
    id: "1".to_string(),
    msg: EventMsg::TaskStarted(codex_core::protocol::TaskStartedEvent { task_id: 1 }),
  };

  let events = collector.handle(&event);
  assert_eq!(events.len(), 1);
  assert!(matches!(events[0], ThreadEvent::TurnStarted(_)));
}

#[test]
fn test_review_event_collector_agent_reasoning() {
  let mut collector = ReviewEventCollector::new();
  let event = Event {
    id: "1".to_string(),
    msg: EventMsg::AgentReasoning(codex_core::protocol::AgentReasoningEvent {
      text: "thinking...".to_string(),
    }),
  };

  let events = collector.handle(&event);
  assert_eq!(events.len(), 1);

  if let ThreadEvent::ItemCompleted(item_event) = &events[0] {
    assert_eq!(item_event.item.id, "item_0");
    if let ThreadItemDetails::Reasoning(reasoning) = &item_event.item.details {
      assert_eq!(reasoning.text, "thinking...");
    } else {
      panic!("Expected Reasoning item");
    }
  } else {
    panic!("Expected ItemCompleted event");
  }
}

#[test]
fn test_review_event_collector_agent_message() {
  let mut collector = ReviewEventCollector::new();
  let event = Event {
    id: "1".to_string(),
    msg: EventMsg::AgentMessage(codex_core::protocol::AgentMessageEvent {
      message: "Hello!".to_string(),
    }),
  };

  let events = collector.handle(&event);
  assert_eq!(events.len(), 1);

  if let ThreadEvent::ItemCompleted(item_event) = &events[0] {
    if let ThreadItemDetails::AgentMessage(msg) = &item_event.item.details {
      assert_eq!(msg.text, "Hello!");
    } else {
      panic!("Expected AgentMessage item");
    }
  } else {
    panic!("Expected ItemCompleted event");
  }
}

#[test]
fn test_review_event_collector_warning() {
  let mut collector = ReviewEventCollector::new();
  let event = Event {
    id: "1".to_string(),
    msg: EventMsg::Warning(codex_core::protocol::WarningEvent {
      message: "Warning message".to_string(),
    }),
  };

  let events = collector.handle(&event);
  assert_eq!(events.len(), 1);

  if let ThreadEvent::ItemCompleted(item_event) = &events[0] {
    if let ThreadItemDetails::Error(error) = &item_event.item.details {
      assert_eq!(error.message, "Warning message");
    } else {
      panic!("Expected Error item");
    }
  } else {
    panic!("Expected ItemCompleted event");
  }
}

#[test]
fn test_review_event_collector_error() {
  let mut collector = ReviewEventCollector::new();
  let event = Event {
    id: "1".to_string(),
    msg: EventMsg::Error(codex_core::protocol::ErrorEvent {
      message: "Error occurred".to_string(),
    }),
  };

  let events = collector.handle(&event);
  assert_eq!(events.len(), 1);

  if let ThreadEvent::Error(error_event) = &events[0] {
    assert_eq!(error_event.message, "Error occurred");
  } else {
    panic!("Expected Error event");
  }

  assert!(collector.last_error.is_some());
  assert_eq!(
    collector.last_error.as_ref().unwrap().message,
    "Error occurred"
  );
}

#[test]
fn test_review_event_collector_token_count() {
  let mut collector = ReviewEventCollector::new();
  let event = Event {
    id: "1".to_string(),
    msg: EventMsg::TokenCount(codex_core::protocol::TokenCountEvent {
      info: Some(codex_core::protocol::TokenCountInfoEvent {
        total_token_usage: TokenUsage {
          input_tokens: 100,
          cached_input_tokens: 50,
          output_tokens: 25,
          reasoning_output_tokens: 0,
          total_tokens: 175,
        },
        this_turn_token_usage: TokenUsage {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
          total_tokens: 0,
        },
        estimated_cost: None,
      }),
    }),
  };

  let events = collector.handle(&event);
  assert_eq!(events.len(), 0);

  assert!(collector.last_usage.is_some());
  let usage = collector.last_usage.as_ref().unwrap();
  assert_eq!(usage.input_tokens, 100);
  assert_eq!(usage.cached_input_tokens, 50);
  assert_eq!(usage.output_tokens, 25);
}

#[test]
fn test_review_event_collector_parse_review_output_valid_json() {
  let collector = ReviewEventCollector::new();
  let json_text = r#"{"overall_explanation":"Good code","findings":[]}"#;

  let output = collector.parse_review_output(json_text);
  assert_eq!(output.overall_explanation, "Good code");
  assert_eq!(output.findings.len(), 0);
}

#[test]
fn test_review_event_collector_parse_review_output_embedded_json() {
  let collector = ReviewEventCollector::new();
  let text = r#"Some text {"overall_explanation":"Found issues","findings":[]} after"#;

  let output = collector.parse_review_output(text);
  assert_eq!(output.overall_explanation, "Found issues");
}

#[test]
fn test_review_event_collector_parse_review_output_invalid_json() {
  let collector = ReviewEventCollector::new();
  let text = "This is not JSON at all";

  let output = collector.parse_review_output(text);
  assert_eq!(output.overall_explanation, "This is not JSON at all");
  assert_eq!(output.findings.len(), 0);
}
