import { Codex, type Thread, type ThreadEvent, type ThreadItem } from "@codex-native/sdk";
import type { MultiAgentConfig, ReverieResult } from "./types.js";
import { ReverieSystem } from "./reverie.js";
import { DEFAULT_MINI_MODEL } from "./constants.js";
import { isValidReverieExcerpt, deduplicateReverieInsights } from "./reverie-quality.js";

const MAX_BUFFER_ENTRIES = 4;
const DEFAULT_HINT_INTERVAL_MS = 120_000;
const DEFAULT_HINT_MIN_SCORE = 0.60;
const DEFAULT_HINT_MAX_MATCHES = 2;
const DEFAULT_CONTEXT_CHARS = 800;
const DEFAULT_REASONING_WEIGHT = 0.6;
const DEFAULT_DIALOGUE_WEIGHT = 0.4;
const DEFAULT_MIN_REASONING_CHARS = 120;
const DEFAULT_MIN_DIALOGUE_CHARS = 160;
const DEFAULT_HINT_TURN_GAP = 2;
const DEFAULT_HINT_HELPFUL_SCORE = 0.65;
const DEFAULT_CONVERSATION_COOLDOWN_TURNS = 3;
const FALLBACK_CANDIDATE_CAP = 80;
const SIGNATURE_CONTEXT_TAIL = 200;
const FORMAT_CONTEXT_TAIL = 160;

export function attachReverieHints(thread: Thread, reverie: ReverieSystem, config: MultiAgentConfig): () => void {
  if (!config.autoReverieHints) {
    return () => {};
  }
  const manager = new ReverieHintManager(thread, reverie, config);
  return manager.attach();
}

class ReverieHintManager {
  private readonly intervalMs: number;
  private readonly minScore: number;
  private readonly maxMatches: number;
  private readonly contextChars: number;
  private readonly reasoningWeight: number;
  private readonly dialogueWeight: number;
  private readonly minReasoningChars: number;
  private readonly minDialogueChars: number;
  private reasoningBuffer: string[] = [];
  private dialogueBuffer: string[] = [];
  private readonly useMiniModel: boolean;
  private readonly hintModel: string;
  private readonly config: MultiAgentConfig;
  private readonly minTurnGap: number;
  private readonly helpfulScore: number;
  private readonly conversationCooldown: number;
  private unsubscribe?: () => void;
  private pending = false;
  private disposed = false;
  private lastHintAt = 0;
  private lastSignature?: string;
  private turnCounter = 0;
  private lastHintTurn = 0;
  private recentConversationTurns = new Map<string, number>();

  constructor(
    private readonly thread: Thread,
    private readonly reverie: ReverieSystem,
    config: MultiAgentConfig,
  ) {
    this.config = config;
    this.intervalMs = Math.max(30_000, config.reverieHintIntervalMs ?? DEFAULT_HINT_INTERVAL_MS);
    this.minScore = config.reverieHintMinScore ?? DEFAULT_HINT_MIN_SCORE;
    this.maxMatches = Math.max(1, config.reverieHintMaxMatches ?? DEFAULT_HINT_MAX_MATCHES);
    this.contextChars = Math.max(200, config.reverieHintContextChars ?? DEFAULT_CONTEXT_CHARS);

    const rawReasoningWeight = config.reverieHintReasoningWeight ?? DEFAULT_REASONING_WEIGHT;
    const rawDialogueWeight = config.reverieHintDialogueWeight ?? DEFAULT_DIALOGUE_WEIGHT;
    const weightsSum = rawReasoningWeight + rawDialogueWeight;
    if (weightsSum <= 0) {
      this.reasoningWeight = DEFAULT_REASONING_WEIGHT;
      this.dialogueWeight = DEFAULT_DIALOGUE_WEIGHT;
    } else {
      this.reasoningWeight = rawReasoningWeight / weightsSum;
      this.dialogueWeight = rawDialogueWeight / weightsSum;
    }

    this.minReasoningChars = Math.max(40, config.reverieHintMinReasoningChars ?? DEFAULT_MIN_REASONING_CHARS);
    this.minDialogueChars = Math.max(40, config.reverieHintMinDialogueChars ?? DEFAULT_MIN_DIALOGUE_CHARS);
    this.useMiniModel = config.reverieHintUseMiniModel ?? true;
    this.hintModel = config.reverieHintModel ?? DEFAULT_MINI_MODEL;
    this.minTurnGap = Math.max(1, config.reverieHintTurnGap ?? DEFAULT_HINT_TURN_GAP);
    const helpful = config.reverieHintHelpfulScore ?? DEFAULT_HINT_HELPFUL_SCORE;
    this.helpfulScore = Math.min(0.99, Math.max(helpful, this.minScore));
    this.conversationCooldown = Math.max(1, config.reverieHintConversationCooldown ?? DEFAULT_CONVERSATION_COOLDOWN_TURNS);
  }

  attach(): () => void {
    this.unsubscribe = this.thread.onEvent((event) => this.handleEvent(event));
    return () => this.dispose();
  }

  private dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.unsubscribe?.();
    this.reasoningBuffer = [];
    this.dialogueBuffer = [];
  }

  private handleEvent(event: ThreadEvent): void {
    if (this.disposed) {
      return;
    }

    if (event.type === "turn.completed") {
      this.turnCounter += 1;
      this.maybeEmitHint();
      return;
    }

    if (event.type === "item.completed" || event.type === "item.updated") {
      const channel = this.classifyItem(event.item);
      if (!channel) {
        return;
      }
      const text = this.extractItemText(event.item);
      if (!text) {
        return;
      }
      this.capture(text, channel);
      this.maybeEmitHint();
      return;
    }

    if (event.type === "raw_event") {
      const text = this.extractUserMessage(event.raw);
      if (!text) {
        return;
      }
      this.capture(text, "dialogue");
      this.maybeEmitHint();
    }
  }

  private extractItemText(item: ThreadItem): string | null {
    if (item.type === "reasoning" || item.type === "agent_message") {
      return item.text;
    }
    return null;
  }

  private classifyItem(item: ThreadItem): Channel | null {
    if (item.type === "reasoning") {
      return "reasoning";
    }
    if (item.type === "agent_message") {
      return "dialogue";
    }
    return null;
  }

  private extractUserMessage(raw: unknown): string | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const eventMsg = (raw as { EventMsg?: { UserMessage?: { message?: string } } }).EventMsg;
    const message = eventMsg?.UserMessage?.message;
    return typeof message === "string" ? message : null;
  }

  private capture(text: string, channel: Channel): void {
    const normalized = text.trim();
    if (!normalized) {
      return;
    }
    const target = channel === "reasoning" ? this.reasoningBuffer : this.dialogueBuffer;
    target.push(normalized.slice(-this.contextChars));
    if (target.length > MAX_BUFFER_ENTRIES) {
      target.shift();
    }
  }

  private maybeEmitHint(): void {
    if (this.pending) {
      return;
    }
    if (this.turnCounter < this.minTurnGap) {
      return;
    }
    if (this.turnCounter - this.lastHintTurn < this.minTurnGap) {
      return;
    }
    const now = Date.now();
    if (now - this.lastHintAt < this.intervalMs) {
      return;
    }
    this.pending = true;
    void this.emitHint()
      .then((emitted) => {
        if (emitted) {
          this.lastHintTurn = this.turnCounter;
          this.lastHintAt = Date.now();
        }
      })
      .finally(() => {
        this.pending = false;
      });
  }

  private buildContext(buffer: string[]): string | null {
    if (buffer.length === 0) {
      return null;
    }
    const combined = buffer.join("\n\n");
    return combined.slice(-this.contextChars).trim();
  }

  private async emitHint(): Promise<boolean> {
    const reasoningContext = this.buildContext(this.reasoningBuffer);
    const dialogueContext = this.buildContext(this.dialogueBuffer);
    if (!reasoningContext && !dialogueContext) {
      return false;
    }

    try {
      const aggregated = await this.collectMatches(reasoningContext, dialogueContext);
      if (aggregated.length === 0) {
        return false;
      }
      const topRelevance = computeMaxRelevance(aggregated);
      if (topRelevance < this.helpfulScore) {
        return false;
      }
      const cooled = aggregated.filter((match) => this.isConversationAllowed(match.result.conversationId));
      if (cooled.length === 0) {
        return false;
      }
      const limited = cooled.slice(0, this.maxMatches);
      const signature = this.buildSignature(reasoningContext, dialogueContext, limited);
      if (signature === this.lastSignature) {
        return false;
      }
      this.lastSignature = signature;
      const fallback = this.formatHintMessage(reasoningContext, dialogueContext, limited);
      const message = await this.composeHintMessage(reasoningContext, dialogueContext, limited, fallback);
      await this.thread.sendBackgroundEvent(message);
      this.recordServedConversations(limited.map((entry) => entry.result.conversationId));
      return true;
    } catch (error) {
      console.warn("Failed to emit reverie hint:", error);
    }
    return false;
  }

  private isConversationAllowed(conversationId: string): boolean {
    if (!conversationId) {
      return false;
    }
    const lastTurn = this.recentConversationTurns.get(conversationId);
    if (lastTurn === undefined) {
      return true;
    }
    return this.turnCounter - lastTurn >= this.conversationCooldown;
  }

  private recordServedConversations(conversationIds: string[]): void {
    for (const id of conversationIds) {
      if (!id) {
        continue;
      }
      this.recentConversationTurns.set(id, this.turnCounter);
    }
  }

  private async collectMatches(
    reasoningContext: string | null,
    dialogueContext: string | null,
  ): Promise<AggregatedMatch[]> {
    const combined = new Map<string, AggregatedMatch>();
    const candidateCap = Math.max(this.maxMatches * 6, FALLBACK_CANDIDATE_CAP);
    let totalRawMatches = 0;
    let qualityFilteredCount = 0;

    if (reasoningContext && reasoningContext.length >= this.minReasoningChars) {
      const matches = await this.reverie.searchReveriesFromText(reasoningContext, {
        limit: this.maxMatches * 2,
        maxCandidates: candidateCap,
      });
      totalRawMatches += matches.length;
      const beforeSize = combined.size;
      this.mergeMatches(combined, matches, this.reasoningWeight, "reasoning");
      qualityFilteredCount += matches.length - (combined.size - beforeSize);
    }

    if (dialogueContext && dialogueContext.length >= this.minDialogueChars) {
      const matches = await this.reverie.searchReveriesFromText(dialogueContext, {
        limit: this.maxMatches * 2,
        maxCandidates: candidateCap,
      });
      totalRawMatches += matches.length;
      const beforeSize = combined.size;
      this.mergeMatches(combined, matches, this.dialogueWeight, "dialogue");
      qualityFilteredCount += matches.length - (combined.size - beforeSize);
    }

    const merged = Array.from(combined.values());
    const beforeDedup = merged.length;

    // Deduplicate similar insights based on excerpt fingerprints
    const deduplicated = this.deduplicateMatches(merged);
    const afterDedup = deduplicated.length;

    // Log quality filtering statistics
    if (totalRawMatches > 0) {
      console.log(
        `Reverie hint quality: ${totalRawMatches} raw → ${beforeDedup} valid → ${afterDedup} unique (filtered ${totalRawMatches - beforeDedup} low-quality, ${beforeDedup - afterDedup} duplicates)`,
      );
    }

    return deduplicated.sort((a, b) => b.score - a.score);
  }

  private deduplicateMatches(matches: AggregatedMatch[]): AggregatedMatch[] {
    // Group by excerpt fingerprint
    const byFingerprint = new Map<string, AggregatedMatch[]>();

    for (const match of matches) {
      const fingerprint = match.result.excerpt
        .slice(0, 100)
        .toLowerCase()
        .replace(/\s+/g, " ");

      if (!byFingerprint.has(fingerprint)) {
        byFingerprint.set(fingerprint, []);
      }
      byFingerprint.get(fingerprint)!.push(match);
    }

    // Keep the match with highest bestRelevance from each group
    const deduplicated: AggregatedMatch[] = [];
    for (const group of byFingerprint.values()) {
      const best = group.reduce((prev, curr) =>
        curr.bestRelevance > prev.bestRelevance ? curr : prev
      );
      deduplicated.push(best);
    }

    // Sort by score descending
    return deduplicated.sort((a, b) => b.score - a.score);
  }

  private mergeMatches(
    map: Map<string, AggregatedMatch>,
    matches: ReverieResult[],
    weight: number,
    channel: Channel,
  ): void {
    for (const match of matches) {
      // Filter out low-quality excerpts before checking relevance
      if (!isValidReverieExcerpt(match.excerpt)) {
        continue;
      }
      if (match.relevance < this.minScore) {
        continue;
      }
      const key = match.conversationId;
      const existing = map.get(key) ?? {
        result: match,
        score: 0,
        bestRelevance: match.relevance,
        fromReasoning: false,
        fromDialogue: false,
      };
      existing.score += match.relevance * weight;
      existing.bestRelevance = Math.max(existing.bestRelevance, match.relevance);
      if (channel === "reasoning") {
        existing.fromReasoning = true;
      } else {
        existing.fromDialogue = true;
      }
      existing.result = match;
      map.set(key, existing);
    }
  }

  private buildSignature(
    reasoningContext: string | null,
    dialogueContext: string | null,
    matches: AggregatedMatch[],
  ): string {
    const reasoningTail = reasoningContext ? reasoningContext.slice(-SIGNATURE_CONTEXT_TAIL) : "";
    const dialogueTail = dialogueContext ? dialogueContext.slice(-SIGNATURE_CONTEXT_TAIL) : "";
    const matchSignature = matches
      .map((match) =>
        `${match.result.conversationId}:${Math.round(match.bestRelevance * 100)}:${match.fromReasoning ? 1 : 0}${match.fromDialogue ? 1 : 0}`,
      )
      .join("|");
    return `${reasoningTail}|${dialogueTail}|${matchSignature}`;
  }

  private formatHintMessage(
    reasoningContext: string | null,
    dialogueContext: string | null,
    matches: AggregatedMatch[],
  ): string {
    const focusLines: string[] = [];
    if (reasoningContext) {
      focusLines.push(`Reasoning: "${reasoningContext.slice(-Math.min(FORMAT_CONTEXT_TAIL, this.contextChars)).trim()}"`);
    }
    if (dialogueContext) {
      focusLines.push(`Dialogue: "${dialogueContext.slice(-Math.min(FORMAT_CONTEXT_TAIL, this.contextChars)).trim()}"`);
    }
    const header = focusLines.length ? `${focusLines.join("\n")}` : "";
    const lines = matches.map((match, idx) => {
      const insight = match.result.insights[0] || match.result.excerpt || "See linked conversation";
      const timestamp = formatTimestamp(match.result.timestamp);
      const sources = match.fromReasoning && match.fromDialogue
        ? "reasoning+dialogue"
        : match.fromReasoning
          ? "reasoning"
          : match.fromDialogue
            ? "dialogue"
            : "";
      const relevancePct = Math.round(Math.min(match.bestRelevance, 0.99) * 100);
      const channelLabel = sources ? ` · ${sources}` : "";
      return `#${idx + 1} (${relevancePct}% · ${timestamp}${channelLabel}) ${insight}`;
    });
    const headerBlock = header ? `${header}\n` : "";
    return `🪄 Reverie hint\n${headerBlock}${lines.join("\n")}`.trim();
  }

  private async composeHintMessage(
    reasoningContext: string | null,
    dialogueContext: string | null,
    matches: AggregatedMatch[],
    fallback: string,
  ): Promise<string> {
    if (!this.useMiniModel || matches.length === 0) {
      return fallback;
    }
    try {
      const codex = new Codex({ baseUrl: this.config.baseUrl, apiKey: this.config.apiKey });
      const hintThread = codex.startThread({
        model: this.hintModel,
        workingDirectory: this.config.workingDirectory,
        skipGitRepoCheck: this.config.skipGitRepoCheck,
        approvalMode: this.config.approvalMode ?? "never",
        sandboxMode: this.config.sandboxMode ?? "danger-full-access",
      });
      const prompt = this.buildMiniModelPrompt(reasoningContext, dialogueContext, matches);
      const turn = await hintThread.run(prompt);
      const response = turn.finalResponse?.trim();
      if (response && response.length > 0) {
        return response;
      }
    } catch (error) {
      console.warn("Failed to compose reverie hint using mini model:", error);
    }
    return fallback;
  }

  private buildMiniModelPrompt(
    reasoningContext: string | null,
    dialogueContext: string | null,
    matches: AggregatedMatch[],
  ): string {
    const focusSections: string[] = [];
    if (reasoningContext) {
      focusSections.push(`Reasoning focus:\n${reasoningContext}`);
    }
    if (dialogueContext) {
      focusSections.push(`Dialogue focus:\n${dialogueContext}`);
    }
    const matchSummaries = matches
      .map((match, idx) => {
        const insight = match.result.insights.join("; ") || match.result.excerpt || "(no summary)";
        const channels = match.fromReasoning && match.fromDialogue
          ? "reasoning+dialogue"
          : match.fromReasoning
            ? "reasoning"
            : match.fromDialogue
              ? "dialogue"
              : "context";
        return `${idx + 1}. [${channels}] relevance=${Math.round(Math.min(match.bestRelevance, 0.99) * 100)}% :: ${insight}`;
      })
      .join("\n");

    return `You are the Reverie Whisperer, providing one or two concise background hints to help another agent.
Focus on actionable reminders inferred from similar past work. If nothing is useful, respond with "(no helpful reverie)".

${focusSections.join("\n\n").trim()}

Past reveries:
${matchSummaries}

Write 1-2 bullet hints, each <= 120 characters. Mention why the reverie matters.`;
  }
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

type Channel = "reasoning" | "dialogue";

export function computeMaxRelevance(matches: AggregatedMatch[]): number {
  return matches.reduce((acc, match) => Math.max(acc, match.bestRelevance), 0);
}

type AggregatedMatch = {
  result: ReverieResult;
  score: number;
  bestRelevance: number;
  fromReasoning: boolean;
  fromDialogue: boolean;
};
