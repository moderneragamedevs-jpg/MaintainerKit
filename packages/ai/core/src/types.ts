import type { AdvisoryFinding } from "@maintainerkit/core";

export const AI_CAPABILITY_IDS = [
  "issue-classification",
  "duplicate-issue-suggestion",
  "pull-request-summary",
  "risk-analysis",
  "review-assistance",
  "release-notes",
] as const;

export type AICapability = (typeof AI_CAPABILITY_IDS)[number];

export interface AIUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** Only when the provider reports it; never estimated by MaintainerKit. */
  costUsd?: number;
}

/** A minimal JSON Schema subset, enough to describe structured AI output. */
export type JsonSchema = Record<string, unknown>;

/**
 * Request sent to a provider.
 *
 * `schema` is part of the request because structured output is a requirement of the contract, not a
 * post-processing detail: providers may use it for native JSON modes, and every response is
 * validated against it before anything downstream sees it.
 */
export interface AIRequest {
  capability: AICapability;
  system: string;
  user: string;
  schema: JsonSchema;
  maxOutputTokens?: number;
  temperature?: number;
  /** Deterministic sampling, when the provider supports it. */
  seed?: number;
}

export interface AIRequestOptions {
  model?: string;
  timeoutMs?: number;
  /** Aborted when the caller's timeout elapses or the run is cancelled. */
  signal?: AbortSignal;
}

export interface AIProviderResponse {
  /** Raw model output. Untrusted: never used before schema validation. */
  text: string;
  /** Model actually used (providers may default it). */
  model: string;
  usage?: AIUsage;
}

/**
 * The only AI seam. Adapters implement this over HTTP; the application layer never imports a vendor
 * SDK. Providers must be pure request/response: no tool calls, no repository access, no side effects.
 */
export interface AIProvider {
  readonly id: string;
  readonly capabilities: readonly AICapability[];
  /** Human-readable description shown by `maintainerkit doctor` and explain output. */
  readonly description?: string;
  complete(request: AIRequest, options: AIRequestOptions): Promise<AIProviderResponse>;
}

export interface AIResult {
  provider: string;
  model: string;
  capability: AICapability;
  /** Validated structured output. */
  data: unknown;
  /** Raw text, retained for auditing; never rendered without escaping. */
  raw: string;
  usage?: AIUsage;
  durationMs: number;
}

/** Builds an advisory from a validated result. Advisories never influence policy outcomes. */
export function toAdvisory(
  result: AIResult,
  content: {
    id: string;
    promptVersion: string;
    title: string;
    summary: string;
    confidence?: number;
    items?: AdvisoryFinding["items"];
    createdAt: string;
  },
): AdvisoryFinding {
  return {
    id: content.id,
    capability: result.capability,
    provider: result.provider,
    model: result.model,
    promptVersion: content.promptVersion,
    title: content.title,
    summary: content.summary,
    ...(content.confidence === undefined ? {} : { confidence: content.confidence }),
    ...(content.items ? { items: content.items } : {}),
    createdAt: content.createdAt,
  };
}
