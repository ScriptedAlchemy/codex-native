// based on event types from codex-rs/exec/src/exec_events.rs

import type { ThreadItem } from "./items";

/** Details identifying a code range referenced in a review finding. */
export type ReviewLineRange = {
  start: number;
  end: number;
};

/** Absolute file path and range for a review finding. */
export type ReviewCodeLocation = {
  absolute_file_path: string;
  line_range: ReviewLineRange;
};

/** Structured finding emitted when exiting review mode. */
export type ReviewFinding = {
  title: string;
  body: string;
  confidence_score: number;
  priority: number;
  code_location: ReviewCodeLocation;
};

/** Summary payload that accompanies an exited review mode event. */
export type ReviewOutputEvent = {
  findings: ReviewFinding[];
  overall_correctness: string;
  overall_explanation: string;
  overall_confidence_score: number;
};

/** Emitted when Codex leaves review mode. */
export type ExitedReviewModeEvent = {
  type: "exited_review_mode";
  review_output?: ReviewOutputEvent;
};

/** Raw protocol event payload forwarded for consumers that need full fidelity. */
export type RawEvent = {
  type: "raw_event";
  raw: unknown;
};

/** Emitted when a new thread is started as the first event. */
export type ThreadStartedEvent = {
  type: "thread.started";
  /** The identifier of the new thread. Can be used to resume the thread later. */
  thread_id: string;
};

/**
 * Emitted when a turn is started by sending a new prompt to the model.
 * A turn encompasses all events that happen while the agent is processing the prompt.
 */
export type TurnStartedEvent = {
  type: "turn.started";
};

/** Describes the usage of tokens during a turn. */
export type Usage = {
  /** The number of input tokens used during the turn. */
  input_tokens: number;
  /** The number of cached input tokens used during the turn. */
  cached_input_tokens: number;
  /** The number of output tokens used during the turn. */
  output_tokens: number;
};

/** Emitted when a turn is completed. Typically right after the assistant's response. */
export type TurnCompletedEvent = {
  type: "turn.completed";
  usage: Usage;
};

/** Indicates that a turn failed with an error. */
export type TurnFailedEvent = {
  type: "turn.failed";
  error: ThreadError;
};

/** Emitted when a new item is added to the thread. Typically the item is initially "in progress". */
export type ItemStartedEvent = {
  type: "item.started";
  item: ThreadItem;
};

/** Emitted when an item is updated. */
export type ItemUpdatedEvent = {
  type: "item.updated";
  item: ThreadItem;
};

/** Signals that an item has reached a terminal state—either success or failure. */
export type ItemCompletedEvent = {
  type: "item.completed";
  item: ThreadItem;
};

/** Fatal error emitted by the stream. */
export type ThreadError = {
  message: string;
};

/** Represents an unrecoverable error emitted directly by the event stream. */
export type ThreadErrorEvent = {
  type: "error";
  message: string;
};

/** Top-level JSONL events emitted by codex exec. */
export type ThreadEvent =
  | ThreadStartedEvent
  | TurnStartedEvent
  | TurnCompletedEvent
  | TurnFailedEvent
  | ItemStartedEvent
  | ItemUpdatedEvent
  | ItemCompletedEvent
  | ThreadErrorEvent
  | ExitedReviewModeEvent
  | RawEvent;
