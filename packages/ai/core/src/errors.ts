import { MaintainerKitError } from "@maintainerkit/core";

/**
 * AI failures are their own error family: they must be recoverable, logged, and never confused with a
 * policy violation. Every error carries `retryable` so the executor knows whether to try again.
 */
export class AIError extends MaintainerKitError {
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { code: string; retryable?: boolean; hint?: string; cause?: unknown },
  ) {
    super(message, {
      code: options.code,
      category: "execution",
      ...(options.hint ? { hint: options.hint } : {}),
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.retryable = options.retryable ?? false;
  }
}

export class AIProviderError extends AIError {
  readonly status?: number;

  constructor(
    message: string,
    options: {
      code?: string;
      retryable?: boolean;
      status?: number;
      hint?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, {
      code: options.code ?? "ai/provider-error",
      retryable: options.retryable ?? false,
      ...(options.hint ? { hint: options.hint } : {}),
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.status = options.status;
  }
}

export class AIAuthenticationError extends AIProviderError {
  constructor(providerId: string, status = 401) {
    super(`${providerId} rejected the credentials.`, {
      code: "ai/authentication-failed",
      status,
      hint: `Check the API key for ${providerId}. Keys are read from the environment and never written to logs or reports.`,
    });
  }
}

export class AIRateLimitError extends AIProviderError {
  constructor(providerId: string, retryAfterMs?: number) {
    super(`${providerId} rate limited the request.`, {
      code: "ai/rate-limited",
      retryable: true,
      status: 429,
      hint: retryAfterMs
        ? `Retry after approximately ${Math.ceil(retryAfterMs / 1000)}s.`
        : "Retry later or reduce the number of AI requests.",
    });
  }
}

export class AITimeoutError extends AIProviderError {
  constructor(timeoutMs: number) {
    super(`The AI provider did not respond within ${timeoutMs}ms.`, {
      code: "ai/timeout",
      retryable: true,
      hint: "Raise --ai-timeout, or run without AI: policy results do not depend on it.",
    });
  }
}

export class AICapabilityError extends AIError {
  constructor(providerId: string, capability: string, supported: readonly string[]) {
    super(`Provider "${providerId}" does not support the "${capability}" capability.`, {
      code: "ai/unsupported-capability",
      hint: `Supported: ${supported.join(", ") || "(none)"}`,
    });
  }
}

export class AIValidationError extends AIError {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`The AI response did not match the required schema (${problems.length} problem(s)).`, {
      code: "ai/invalid-output",
      retryable: true,
      hint: "Invalid model output is discarded as a whole; no partial data is used.",
    });
    this.problems = problems;
  }
}
