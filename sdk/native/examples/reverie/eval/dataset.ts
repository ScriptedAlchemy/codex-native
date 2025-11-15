import fs from "node:fs/promises";

import { reverieListConversations, type ReverieConversation } from "@codex-native/sdk";

export type ReasoningSlice = {
  id: string;
  conversationId: string;
  conversationPath: string;
  timestamp?: string;
  reasoningText: string;
  reasoningSource: "reasoning" | "assistant_fallback";
  userMessage?: string;
  assistantResponse?: string;
  conversationSummary?: string;
  previewToon?: string[];
  chunkIndex?: number;
  chunkSize?: number;
  chunkStartEvent?: number;
  chunkEndEvent?: number;
  eventsPreview?: NormalizedEvent[];
};

export type LoadReasoningSlicesOptions = {
  codexHome: string;
  maxSlices: number;
  conversationLimit?: number;
  minReasoningChars?: number;
  includeAssistantFallback?: boolean;
  chunkSize?: number;
  chunkOverlap?: number;
};

type TranscriptRecord = {
  timestamp?: string;
  type?: string;
  payload?: any;
};

type NormalizedEvent = {
  kind: EventKind;
  text: string;
  timestamp?: string;
  rawType?: string;
};

type ConversationChunk = {
  index: number;
  startEvent: number;
  endEvent: number;
  events: NormalizedEvent[];
};

type EventKind = "user" | "assistant" | "reasoning" | "system" | "tool" | "other";

const DEFAULT_MIN_REASONING_CHARS = 48;
const DEFAULT_CHUNK_SIZE = 8;
const DEFAULT_CHUNK_OVERLAP = 3;
const REASONING_TYPES = new Set(["reasoning", "reasoning_output", "model", "analysis", "internal_monologue"]);
const ASSISTANT_TEXT_TYPES = new Set(["output_text", "message", "assistant_response", "text", "final"]);

export async function loadReasoningSlices(options: LoadReasoningSlicesOptions): Promise<ReasoningSlice[]> {
  const {
    codexHome,
    maxSlices,
    conversationLimit = 20,
    minReasoningChars = DEFAULT_MIN_REASONING_CHARS,
    includeAssistantFallback = true,
    chunkSize = DEFAULT_CHUNK_SIZE,
    chunkOverlap = DEFAULT_CHUNK_OVERLAP,
  } = options;

  const normalizedChunkSize = Math.max(3, chunkSize);
  const normalizedOverlap = Math.max(0, Math.min(chunkOverlap, normalizedChunkSize - 1));

  const conversations = await reverieListConversations(codexHome, conversationLimit, 0);
  const slices: ReasoningSlice[] = [];
  const fallbackCandidates: ReasoningSlice[] = [];

  for (const conversation of conversations) {
    const records = await readConversationRecords(conversation);
    if (!records || records.length === 0) {
      continue;
    }

    const events = flattenConversationRecords(records);
    if (events.length === 0) {
      continue;
    }

    const conversationSummary = summarizeConversation(conversation);
    const chunks = chunkEvents(events, normalizedChunkSize, normalizedOverlap);

    for (const chunk of chunks) {
      const slice = buildSliceFromChunk({
        chunk,
        conversation,
        minReasoningChars,
        includeAssistantFallback,
        conversationSummary,
      });

      if (!slice) {
        continue;
      }

      if (slice.reasoningSource === "reasoning") {
        slices.push(slice);
      } else {
        fallbackCandidates.push(slice);
      }

      if (slices.length >= maxSlices) {
        return slices;
      }
    }
  }

  if (includeAssistantFallback && slices.length < maxSlices) {
    for (const fallback of fallbackCandidates) {
      slices.push(fallback);
      if (slices.length >= maxSlices) {
        break;
      }
    }
  }

  return slices.slice(0, maxSlices);
}

function buildSliceFromChunk(args: {
  chunk: ConversationChunk;
  conversation: ReverieConversation;
  minReasoningChars: number;
  includeAssistantFallback: boolean;
  conversationSummary?: string;
}): ReasoningSlice | null {
  const { chunk, conversation, minReasoningChars, includeAssistantFallback, conversationSummary } = args;
  const reasoningSegments = chunk.events.filter((event) => event.kind === "reasoning").map((event) => event.text);
  const assistantSegments = chunk.events.filter((event) => event.kind === "assistant").map((event) => event.text);
  const userSegments = chunk.events.filter((event) => event.kind === "user").map((event) => event.text);

  const reasoningText = normalizeWhitespace(reasoningSegments.join("\n"));
  const assistantResponse = normalizeWhitespace(assistantSegments.join("\n"));
  const userMessage = normalizeWhitespace(userSegments[userSegments.length - 1] ?? "");

  if (reasoningText.length >= minReasoningChars) {
    return {
      id: `${conversation.id}:chunk-${chunk.index}`,
      conversationId: conversation.id,
      conversationPath: conversation.path,
      timestamp: chunk.events[0]?.timestamp,
      reasoningText,
      reasoningSource: "reasoning",
      userMessage: userMessage || undefined,
      assistantResponse: assistantResponse || undefined,
      conversationSummary,
      previewToon: conversation.headRecordsToon?.slice(0, 3) ?? [],
      chunkIndex: chunk.index,
      chunkSize: chunk.events.length,
      chunkStartEvent: chunk.startEvent,
      chunkEndEvent: chunk.endEvent,
      eventsPreview: chunk.events.slice(0, 6),
    };
  }

  if (assistantResponse && includeAssistantFallback) {
    return {
      id: `${conversation.id}:chunk-${chunk.index}:fallback`,
      conversationId: conversation.id,
      conversationPath: conversation.path,
      timestamp: chunk.events[0]?.timestamp,
      reasoningText: assistantResponse,
      reasoningSource: "assistant_fallback",
      userMessage: userMessage || undefined,
      assistantResponse,
      conversationSummary,
      previewToon: conversation.headRecordsToon?.slice(0, 3) ?? [],
      chunkIndex: chunk.index,
      chunkSize: chunk.events.length,
      chunkStartEvent: chunk.startEvent,
      chunkEndEvent: chunk.endEvent,
      eventsPreview: chunk.events.slice(0, 6),
    };
  }

  return null;
}

function chunkEvents(events: NormalizedEvent[], chunkSize: number, overlap: number): ConversationChunk[] {
  if (events.length === 0) {
    return [];
  }
  if (chunkSize <= 0) {
    return [{ index: 0, startEvent: 0, endEvent: events.length, events: [...events] }];
  }

  const chunks: ConversationChunk[] = [];
  const step = Math.max(1, chunkSize - overlap);
  let start = 0;
  let index = 0;
  while (start < events.length) {
    const end = Math.min(events.length, start + chunkSize);
    const subset = events.slice(start, end);
    chunks.push({
      index,
      startEvent: start,
      endEvent: end,
      events: subset,
    });
    start += step;
    index += 1;
  }
  return chunks;
}

async function readConversationRecords(conversation: ReverieConversation): Promise<TranscriptRecord[] | null> {
  try {
    const raw = await fs.readFile(conversation.path, "utf8");
    const lines = raw.split(/\r?\n/).filter((line) => Boolean(line.trim()));
    return lines
      .map((line) => {
        try {
          return JSON.parse(line) as TranscriptRecord;
        } catch {
          return null;
        }
      })
      .filter((record): record is TranscriptRecord => Boolean(record));
  } catch (error) {
    console.warn(`⚠️  Failed to read conversation ${conversation.path}:`, error);
    return null;
  }
}

function flattenConversationRecords(records: TranscriptRecord[]): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  for (const record of records) {
    events.push(...normalizeRecord(record));
  }
  return events;
}

function normalizeRecord(record: TranscriptRecord): NormalizedEvent[] {
  if (!record) {
    return [];
  }

  if (isUserEvent(record)) {
    const text = extractUserMessage(record);
    if (text) {
      return [makeEvent("user", text, record.timestamp, record.type)];
    }
    return [];
  }

  if (record.type === "response_item") {
    const reasoningSegments = extractReasoningSegments(record.payload);
    const assistantSegments = extractAssistantText(record.payload);
    const events: NormalizedEvent[] = [];
    for (const segment of reasoningSegments) {
      events.push(makeEvent("reasoning", segment, record.timestamp, record.type));
    }
    if (assistantSegments) {
      events.push(makeEvent("assistant", assistantSegments, record.timestamp, record.type));
    }
    return events;
  }

  if (record.type === "session_meta" && typeof record.payload?.instructions === "string") {
    return [makeEvent("system", record.payload.instructions, record.timestamp, record.type)];
  }

  return [];
}

function makeEvent(kind: EventKind, text: string, timestamp?: string, rawType?: string): NormalizedEvent {
  return {
    kind,
    text: normalizeWhitespace(text),
    timestamp,
    rawType,
  };
}

function summarizeConversation(conversation: ReverieConversation): string | undefined {
  const toon = conversation.headRecordsToon?.[0];
  if (toon && typeof toon === "string") {
    return toon;
  }
  const head = conversation.headRecords?.[0];
  if (head && typeof head === "string") {
    return head.slice(0, 200);
  }
  return undefined;
}

function isUserEvent(record: TranscriptRecord): boolean {
  return record.type === "event_msg" && typeof record.payload?.type === "string" && record.payload.type === "user_message";
}

function extractUserMessage(record: TranscriptRecord): string | undefined {
  const message = record.payload?.message;
  if (typeof message === "string" && message.trim().length > 0) {
    return normalizeWhitespace(message);
  }
  return undefined;
}

function extractReasoningSegments(payload: any): string[] {
  const segments: string[] = [];

  if (typeof payload?.reasoning === "string") {
    segments.push(payload.reasoning);
  } else if (Array.isArray(payload?.reasoning)) {
    segments.push(payload.reasoning.join("\n"));
  }

  const metadataReasoning = payload?.metadata?.reasoning ?? payload?.metadata?.reasoning_text;
  if (typeof metadataReasoning === "string") {
    segments.push(metadataReasoning);
  }

  segments.push(...collectContentText(payload?.content, (type) => (type ? REASONING_TYPES.has(type) : false)));
  return segments.map((segment) => normalizeWhitespace(segment)).filter(Boolean);
}

function extractAssistantText(payload: any): string | undefined {
  const collected = collectContentText(payload?.content, (type) => !type || ASSISTANT_TEXT_TYPES.has(type));
  if (typeof payload?.text === "string") {
    collected.push(payload.text);
  }

  const metadataSummary = payload?.metadata?.summary;
  if (typeof metadataSummary === "string") {
    collected.push(metadataSummary);
  }

  const joined = collected.map((text) => normalizeWhitespace(text)).filter(Boolean);
  if (joined.length === 0) {
    return undefined;
  }
  return joined.join("\n").trim();
}

function collectContentText(content: unknown, predicate: (type: string | null) => boolean): string[] {
  if (!content) {
    return [];
  }

  const blocks = Array.isArray(content) ? content : [content];
  const collected: string[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const typeValue = typeof (block as any).type === "string" ? ((block as any).type as string).toLowerCase() : null;
    if (!predicate(typeValue)) {
      continue;
    }
    const textValue = extractTextField(block);
    if (textValue) {
      collected.push(textValue);
    }
  }

  return collected;
}

function extractTextField(block: Record<string, unknown>): string | undefined {
  if (typeof block.text === "string") {
    return block.text;
  }
  if (typeof block.value === "string") {
    return block.value;
  }
  if (Array.isArray(block.content)) {
    const nested = block.content
      .map((nestedBlock) => (typeof nestedBlock?.text === "string" ? nestedBlock.text : undefined))
      .filter((value): value is string => Boolean(value));
    if (nested.length > 0) {
      return nested.join(" ");
    }
  }
  return undefined;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export type { NormalizedEvent };
