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

export interface AnthropicOptions {
  id?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: FetchLike;
}

const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Anthropic Messages API adapter (`POST /v1/messages`).
 *
 * Anthropic has no `response_format` flag, so JSON is requested in the prompt and enforced by
 * schema validation after the response — the same guarantee as native JSON modes.
 */
export class AnthropicProvider implements AIProvider {
  readonly id: string;
  readonly description: string;
  readonly capabilities = AI_CAPABILITY_IDS;
  readonly #options: AnthropicOptions;
  readonly #fetch: FetchLike;

  constructor(options: AnthropicOptions = {}) {
    this.id = options.id ?? "anthropic";
    this.#options = options;
    this.#fetch = resolveFetch(options.fetchImpl);
    this.description = `Anthropic Messages API at ${this.#baseUrl()}`;
  }

  #baseUrl(): string {
    return (this.#options.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/$/, "");
  }

  async complete(request: AIRequest, options: AIRequestOptions = {}): Promise<AIProviderResponse> {
    const apiKey = this.#options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new AIProviderError("No API key configured for the Anthropic provider.", {
        code: "ai/missing-credentials",
        hint: "Set ANTHROPIC_API_KEY, or choose the mock or ollama provider.",
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
      max_tokens: request.maxOutputTokens ?? 1024,
      system: request.system,
      messages: [{ role: "user", content: request.user }],
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    });

    const response = await this.#fetch(`${this.#baseUrl()}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body,
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (!response.ok) throw await errorForResponse(this.id, response.status, response);

    const json = await parseJsonBody(this.id, await response.text());
    const content = json.content;
    const blocks = Array.isArray(content) ? content : [];
    const text = blocks
      .map((block) => {
        const typed = block as Record<string, unknown>;
        return typed.type === "text" && typeof typed.text === "string" ? typed.text : "";
      })
      .join("")
      .trim();

    if (text === "") {
      throw new AIProviderError(`${this.id} response contained no text block.`, {
        code: "ai/malformed-response",
        retryable: true,
      });
    }

    const usage = json.usage as Record<string, unknown> | undefined;
    const inputTokens = pickNumber(usage, "input_tokens");
    const outputTokens = pickNumber(usage, "output_tokens");
    return {
      text,
      model: typeof json.model === "string" ? json.model : model,
      ...(inputTokens === undefined && outputTokens === undefined
        ? {}
        : {
            usage: {
              ...(inputTokens === undefined ? {} : { inputTokens }),
              ...(outputTokens === undefined ? {} : { outputTokens }),
              totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
            },
          }),
    };
  }
}
