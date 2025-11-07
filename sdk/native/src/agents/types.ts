/**
 * Type definitions for OpenAI Agents JS framework compatibility
 * Based on @openai/agents-core package
 */

// ============================================================================
// Core Provider Interfaces
// ============================================================================

export interface ModelProvider {
  /**
   * Get a model by name
   * @param modelName - The name of the model to get.
   */
  getModel(modelName?: string): Promise<Model> | Model;
}

export interface Model {
  /**
   * Get a response from the model (buffered)
   */
  getResponse(request: ModelRequest): Promise<ModelResponse>;

  /**
   * Get a streamed response from the model
   */
  getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent>;
}

// ============================================================================
// Request Types
// ============================================================================

export interface ModelRequest {
  systemInstructions?: string;
  input: string | AgentInputItem[];
  previousResponseId?: string;
  conversationId?: string;
  modelSettings: ModelSettings;
  tools: SerializedTool[];
  outputType: SerializedOutputType;
  handoffs: SerializedHandoff[];
  tracing: ModelTracing;
  signal?: AbortSignal;
  prompt?: Prompt;
  overridePromptModel?: boolean;
}

export interface ModelSettings {
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  toolChoice?: ModelSettingsToolChoice;
  parallelToolCalls?: boolean;
  truncation?: "auto" | "disabled";
  maxTokens?: number;
  store?: boolean;
  reasoning?: ModelSettingsReasoning;
  text?: ModelSettingsText;
  providerData?: Record<string, unknown>;
}

export interface ModelSettingsToolChoice {
  type: "auto" | "required" | "none" | "function";
  functionName?: string;
}

export interface ModelSettingsReasoning {
  type: "internal" | "explicit";
  maxTokens?: number;
}

export interface ModelSettingsText {
  format?: {
    type: string;
    schema?: Record<string, unknown>;
  };
}

// ============================================================================
// Input Types
// ============================================================================

export type AgentInputItem =
  | InputText
  | InputImage
  | InputFile
  | InputAudio
  | InputFunctionCallResult
  | InputRefusal;

export interface InputText {
  type: "input_text";
  text: string;
}

export interface InputImage {
  type: "input_image";
  image: string | { url: string } | { fileId: string };
  detail?: "auto" | "low" | "high";
}

export interface InputFile {
  type: "input_file";
  file: { fileId: string };
}

export interface InputAudio {
  type: "input_audio";
  audio: string | { data: string; format: string };
  transcript?: string;
}

export interface InputFunctionCallResult {
  type: "function_call_result";
  callId: string;
  name: string;
  result: string;
}

export interface InputRefusal {
  type: "input_refusal";
  refusal: string;
}

// ============================================================================
// Response Types
// ============================================================================

export interface ModelResponse {
  usage: Usage;
  output: AgentOutputItem[];
  responseId?: string;
  providerData?: Record<string, unknown>;
}

export interface Usage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputTokensDetails?: Array<Record<string, number>>;
  outputTokensDetails?: Array<Record<string, number>>;
}

// ============================================================================
// Output Types
// ============================================================================

export type AgentOutputItem =
  | AssistantMessageItem
  | FunctionCallItem
  | Refusal
  | AudioContent
  | ImageContent
  | Reasoning;

export interface AssistantMessageItem {
  type?: "message" | "assistant_message";
  role: "assistant";
  status: "in_progress" | "completed" | "incomplete";
  content: OutputContent[];
}

export interface FunctionCallItem {
  type: "function_call";
  callId: string;
  name: string;
  arguments: string;
}

export interface Refusal {
  type: "refusal";
  refusal: string;
}

export interface AudioContent {
  type: "audio";
  audio: string;
  transcript?: string;
}

export interface ImageContent {
  type: "image";
  image: string;
}

export interface Reasoning {
  type: "reasoning";
  reasoning: string;
}

export type OutputContent = OutputText | OutputImage | OutputAudio | OutputRefusal;

export interface OutputText {
  type: "output_text";
  text: string;
}

export interface OutputImage {
  type: "output_image";
  image: string;
}

export interface OutputAudio {
  type: "output_audio";
  audio: string;
  transcript?: string;
}

export interface OutputRefusal {
  type: "output_refusal";
  refusal: string;
}

// ============================================================================
// Stream Event Types
// ============================================================================

export type StreamEvent =
  | ResponseStartedEvent
  | OutputTextDeltaEvent
  | OutputTextDoneEvent
  | OutputAudioDeltaEvent
  | OutputAudioDoneEvent
  | FunctionCallArgumentsDeltaEvent
  | FunctionCallArgumentsDoneEvent
  | ReasoningDeltaEvent
  | ReasoningDoneEvent
  | ResponseDoneEvent
  | ErrorEvent;

export interface ResponseStartedEvent {
  type: "response_started";
}

export interface OutputTextDeltaEvent {
  type: "output_text_delta";
  delta: string;
}

export interface OutputTextDoneEvent {
  type: "output_text_done";
  text: string;
}

export interface OutputAudioDeltaEvent {
  type: "output_audio_delta";
  delta: string;
}

export interface OutputAudioDoneEvent {
  type: "output_audio_done";
  audio: string;
  transcript?: string;
}

export interface FunctionCallArgumentsDeltaEvent {
  type: "function_call_arguments_delta";
  callId: string;
  name: string;
  delta: string;
}

export interface FunctionCallArgumentsDoneEvent {
  type: "function_call_arguments_done";
  callId: string;
  name: string;
  arguments: string;
}

export interface ReasoningDeltaEvent {
  type: "reasoning_delta";
  delta: string;
}

export interface ReasoningDoneEvent {
  type: "reasoning_done";
  reasoning: string;
}

export interface ResponseDoneEvent {
  type: "response_done";
  response: ModelResponse;
}

export interface ErrorEvent {
  type: "error";
  error: {
    message: string;
    code?: string;
  };
}

// ============================================================================
// Tool and Handoff Types
// ============================================================================

export interface SerializedTool {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface SerializedOutputType {
  type: "json_schema";
  schema: Record<string, unknown>;
}

export interface SerializedHandoff {
  name: string;
  description?: string;
}

// ============================================================================
// Tracing and Prompt Types
// ============================================================================

export interface ModelTracing {
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

export interface Prompt {
  model?: string;
  template?: string;
}
