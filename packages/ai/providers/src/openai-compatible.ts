import {
  AIProviderError,
  type AIProvider,
  type AIProviderResponse,
  type AIRequest,
  type AIRequestOptions,
} from "@maintainerkit/ai-core";
import { AI_CAPABILITY_IDS } from "@maintainerkit/ai-core";
import {
  errorForResponse,
  parseJsonBody,
  pickNumber,
  resolveFetch,
  type FetchLike,
} from "./http.js";

export interface OpenAICompatibleOptions {
  /** Provider id shown in reports; use a distinct id for self-hosted servers. */
  id?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: FetchLike;
  /** Extra headers (e.g. for a gateway that requires an organization id). */
  headers?: Record<string, string>;
}

/**
 * OpenAI-compatible chat completions adapter.
 *
 * Works with OpenAI, Azure-style gateways, OpenRouter, vLLM, LM Studio, and llama.cpp servers — all
 * of which implement `POST /chat/completions`. Uses `fetch` only: no vendor SDK, no hidden requests.
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly id: string;
  readonly description: string;
  readonly capabilities = AI_CAPABILITY_IDS;
  readonly #options: OpenAICompatibleOptions;
  readonly #fetch: FetchLike;

  constructor(options: OpenAICompatibleOptions = {}) {
    this.id = options.id ?? "openai-compatible";
    this.#options = options;
    this.#fetch = resolveFetch(options.fetchImpl);
    this.description = `OpenAI-compatible endpoint at ${this.#baseUrl()}`;
  }

  #baseUrl(): string {
    return (
      this.#options.baseUrl ??
      process.env.OPENAI_BASE_URL ??
      "https://api.openai.com/v1"
    ).replace(/\/$/, "");
  }

  async complete(request: AIRequest, options: AIRequestOptions = {}): Promise<AIProviderResponse> {
    const apiKey = this.#options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new AIProviderError("No API key configured for the OpenAI-compatible provider.", {
        code: "ai/missing-credentials",
        hint: "Set OPENAI_API_KEY, or choose a provider that does not need a key (ollama, mock).",
      });
    }

    const model = options.model ?? this.#options.model ?? process.env.MAINTAINERKIT_AI_MODEL;
    if (!model) {
      throw new AIProviderError("No model configured.", {
        code: "ai/missing-model",
        hint: "Set ai.model in ContribSpec, or MAINTAINERKIT_AI_MODEL.",
      });
    }

    const body = JSON.stringify({
      model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}),
      ...(request.seed === undefined ? {} : { seed: request.seed }),
      // Native JSON mode where supported; validation does not rely on it.
      response_format: { type: "json_object" },
    });

    const response = await this.#fetch(`${this.#baseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        ...this.#options.headers,
      },
      body,
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (!response.ok) throw await errorForResponse(this.id, response.status, response);

    const json = await parseJsonBody(this.id, await response.text());
    const choices = json.choices;
    const first = Array.isArray(choices)
      ? (choices[0] as Record<string, unknown> | undefined)
      : undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    const text = typeof message?.content === "string" ? message.content : undefined;

    if (text === undefined) {
      throw new AIProviderError(`${this.id} response contained no message content.`, {
        code: "ai/malformed-response",
        retryable: true,
      });
    }

    const usage = json.usage as Record<string, unknown> | undefined;
    const inputTokens = pickNumber(usage, "prompt_tokens", "input_tokens");
    const outputTokens = pickNumber(usage, "completion_tokens", "output_tokens");
    return {
      text,
      model: typeof json.model === "string" ? json.model : model,
      ...(inputTokens === undefined && outputTokens === undefined
        ? {}
        : {
            usage: {
              ...(inputTokens === undefined ? {} : { inputTokens }),
              ...(outputTokens === undefined ? {} : { outputTokens }),
              totalTokens:
                pickNumber(usage, "total_tokens") ?? (inputTokens ?? 0) + (outputTokens ?? 0),
            },
          }),
    };
  }
}
