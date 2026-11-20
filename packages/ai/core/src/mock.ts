import { AIProviderError } from "./errors.js";
import { generateMockValue } from "./structured.js";
import {
  AI_CAPABILITY_IDS,
  type AIProvider,
  type AIProviderResponse,
  type AIRequest,
  type AIRequestOptions,
} from "./types.js";

export interface MockProviderOptions {
  id?: string;
  model?: string;
  /** Overrides the deterministic schema-shaped default. Useful for hostile-output tests. */
  responder?: (request: AIRequest) => string | Promise<string>;
  /** Number of calls that fail before succeeding, to exercise retry logic. */
  failFirst?: number;
  failWith?: Error;
  delayMs?: number;
  /** Simulates a provider that ignores its abort signal. */
  ignoreAbort?: boolean;
}

/**
 * Deterministic in-memory provider.
 *
 * Exists so every AI workflow can be tested — and demonstrated to users — without a network call,
 * an API key, or a vendor account. Its default output is generated from the request's JSON Schema,
 * so it cannot drift from the capability contracts.
 */
export class MockAIProvider implements AIProvider {
  readonly id: string;
  readonly description = "Deterministic mock provider (no network calls, no API key).";
  readonly capabilities = AI_CAPABILITY_IDS;
  readonly #model: string;
  readonly #options: MockProviderOptions;
  #calls = 0;

  constructor(options: MockProviderOptions = {}) {
    this.id = options.id ?? "mock";
    this.#model = options.model ?? "mock-1";
    this.#options = options;
  }

  get calls(): number {
    return this.#calls;
  }

  async complete(request: AIRequest, options: AIRequestOptions = {}): Promise<AIProviderResponse> {
    this.#calls += 1;

    if (this.#options.delayMs && this.#options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.#options.delayMs));
    }

    if (this.#options.failFirst && this.#calls <= this.#options.failFirst) {
      throw (
        this.#options.failWith ??
        new AIProviderError("Mock provider was configured to fail.", {
          code: "ai/mock-failure",
          retryable: true,
        })
      );
    }

    if (options.signal?.aborted && !this.#options.ignoreAbort) {
      throw new AIProviderError("Request aborted.", { code: "ai/aborted", retryable: false });
    }

    const text = this.#options.responder
      ? await this.#options.responder(request)
      : `${JSON.stringify(generateMockValue(request.schema), null, 2)}\n`;

    const inputTokens = Math.ceil(request.user.length / 4);
    const outputTokens = Math.ceil(text.length / 4);
    return {
      text,
      model: options.model ?? this.#model,
      // Rough character-based estimate, clearly marked as such by being the mock provider only.
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    };
  }
}
