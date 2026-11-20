import { AICapabilityError, AIError, AITimeoutError, AIValidationError } from "./errors.js";
import { parseAndValidate } from "./structured.js";
import type { AIProvider, AIRequest, AIResult } from "./types.js";

export interface ExecuteAIOptions {
  provider: AIProvider;
  request: AIRequest;
  model?: string;
  /** Per-attempt timeout. Default 20s. */
  timeoutMs?: number;
  /** Total attempts including the first. Default 3. */
  maxAttempts?: number;
  /** Injected for tests so retries do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Called before each retry, for logging and audit events. */
  onRetry?: (info: { attempt: number; delayMs: number; error: AIError }) => void;
  /** Injected clock, for deterministic duration reporting in tests. */
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 250;

function backoffFor(attempt: number): number {
  // Exponential with bounded jitter: enough to avoid thundering herds, small enough for CI.
  const base = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * 100);
  return base + jitter;
}

/**
 * Executes one AI request with timeout, bounded retries, and mandatory schema validation.
 *
 * Rules:
 * - a capability the provider does not advertise is refused before any network call
 * - retries happen only for errors marked retryable (timeouts, rate limits, invalid output)
 * - invalid output is never partially accepted
 * - the result is data only: no tool calls, no repository mutation, no policy influence
 */
export async function executeAIRequest(options: ExecuteAIOptions): Promise<AIResult> {
  const { provider, request } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const clock = options.now ?? (() => Date.now());

  if (!provider.capabilities.includes(request.capability)) {
    throw new AICapabilityError(provider.id, request.capability, provider.capabilities);
  }

  let lastError: AIError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = clock();

    try {
      const response = await provider.complete(request, {
        ...(options.model ? { model: options.model } : {}),
        timeoutMs,
        signal: controller.signal,
      });

      if (controller.signal.aborted) throw new AITimeoutError(timeoutMs);

      const data = await parseAndValidate(response.text, request.schema);
      const durationMs = Math.max(0, clock() - startedAt);

      return {
        provider: provider.id,
        model: response.model,
        capability: request.capability,
        data,
        raw: response.text,
        ...(response.usage ? { usage: response.usage } : {}),
        durationMs,
      };
    } catch (error) {
      const normalised = normaliseError(error, controller.signal.aborted, timeoutMs);
      lastError = normalised;
      const canRetry = normalised.retryable && attempt < maxAttempts;
      if (!canRetry) throw normalised;
      const delayMs = backoffFor(attempt);
      options.onRetry?.({ attempt, delayMs, error: normalised });
      await sleep(delayMs);
    } finally {
      clearTimeout(timer);
    }
  }

  throw (
    lastError ?? new AIError("AI request failed without a recorded error.", { code: "ai/unknown" })
  );
}

function normaliseError(error: unknown, aborted: boolean, timeoutMs: number): AIError {
  if (error instanceof AIError) return error;
  if (aborted) return new AITimeoutError(timeoutMs);
  if (error instanceof Error && error.name === "AbortError") return new AITimeoutError(timeoutMs);
  if (error instanceof AIValidationError) return error;
  return new AIError(
    `AI request failed: ${error instanceof Error ? error.message : String(error)}`,
    {
      code: "ai/request-failed",
      retryable: true,
    },
  );
}

/**
 * Runs a request and always returns a list of errors instead of throwing.
 * Convenience for the workflow layer, where an AI failure must never abort the run.
 */
export async function tryExecuteAIRequest(
  options: ExecuteAIOptions,
): Promise<{ result: AIResult; error?: undefined } | { result?: undefined; error: AIError }> {
  try {
    return { result: await executeAIRequest(options) };
  } catch (error) {
    if (error instanceof AIError) return { error };
    return {
      error: new AIError(error instanceof Error ? error.message : String(error), {
        code: "ai/unknown",
      }),
    };
  }
}

/** True for errors that are worth retrying at a higher level (e.g. next CI run). */
export function isRetryable(error: unknown): boolean {
  return error instanceof AIError && error.retryable;
}

/** True when the request itself is invalid, independent of the provider. */
export function isValidationFailure(error: unknown): boolean {
  return error instanceof AIValidationError;
}
