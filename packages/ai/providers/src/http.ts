import { AIAuthenticationError, AIProviderError, AIRateLimitError } from "@maintainerkit/ai-core";

/** Minimal `fetch` surface, so tests can inject a function instead of a server. */
export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  headers?: { get(name: string): string | null };
}>;

export const DEFAULT_TIMEOUT_MS = 20_000;

export function resolveFetch(fetchImpl?: FetchLike): FetchLike {
  if (fetchImpl) return fetchImpl;
  return globalThis.fetch as unknown as FetchLike;
}

/** Trims provider error bodies so logs stay useful without dumping an entire response. */
function snippet(body: string): string {
  const single = body.replace(/\s+/g, " ").trim();
  return single.length > 200 ? `${single.slice(0, 200)}…` : single;
}

/**
 * Maps an HTTP failure onto the typed AI error family.
 * Error messages never include request headers, so keys cannot leak into logs.
 */
export async function errorForResponse(
  providerId: string,
  status: number,
  response: { text(): Promise<string>; headers?: { get(name: string): string | null } },
): Promise<AIProviderError> {
  const body = await response.text().catch(() => "");
  const detail = snippet(body);

  if (status === 401 || status === 403) return new AIAuthenticationError(providerId, status);
  if (status === 429) {
    const retryAfter = response.headers?.get("retry-after");
    const retryAfterMs =
      retryAfter && !Number.isNaN(Number(retryAfter)) ? Number(retryAfter) * 1000 : undefined;
    return new AIRateLimitError(providerId, retryAfterMs);
  }
  if (status >= 500) {
    return new AIProviderError(`${providerId} returned ${status}.`, {
      code: "ai/provider-unavailable",
      retryable: true,
      status,
      hint: "The provider is unavailable or overloaded; retry later.",
    });
  }
  return new AIProviderError(
    `${providerId} rejected the request (${status})${detail ? `: ${detail}` : ""}`,
    {
      code: "ai/request-rejected",
      retryable: false,
      status,
      hint: "Check the model name and request size.",
    },
  );
}

/** JSON body parsing that fails with a typed, non-retryable error rather than a crash. */
export async function parseJsonBody(
  providerId: string,
  body: string,
): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new AIProviderError(`${providerId} returned a non-JSON response.`, {
    code: "ai/malformed-response",
    retryable: true,
  });
}

/** Extracts usage numbers defensively: providers omit or rename fields between versions. */
export function pickNumber(
  source: Record<string, unknown> | undefined,
  ...keys: string[]
): number | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}
