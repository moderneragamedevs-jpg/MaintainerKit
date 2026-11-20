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

export interface OllamaOptions {
  id?: string;
  /** Defaults to OLLAMA_HOST or http://127.0.0.1:11434. */
  baseUrl?: string;
  model?: string;
  fetchImpl?: FetchLike;
}

/**
 * Ollama adapter (`POST /api/chat`) for fully local inference.
 *
 * No API key: the model runs on the operator's machine, so repository data never leaves the host.
 * This is the recommended AI option for private repositories.
 */
export class OllamaProvider implements AIProvider {
  readonly id: string;
  readonly description: string;
  readonly capabilities = AI_CAPABILITY_IDS;
  readonly #options: OllamaOptions;
  readonly #fetch: FetchLike;

  constructor(options: OllamaOptions = {}) {
    this.id = options.id ?? "ollama";
    this.#options = options;
    this.#fetch = resolveFetch(options.fetchImpl);
    this.description = `Local Ollama server at ${this.#baseUrl()}`;
  }

  #baseUrl(): string {
    const raw = this.#options.baseUrl ?? process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
    const withScheme = /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
    return withScheme.replace(/\/$/, "");
  }

  async complete(request: AIRequest, options: AIRequestOptions = {}): Promise<AIProviderResponse> {
    const model =
      options.model ?? this.#options.model ?? process.env.MAINTAINERKIT_AI_MODEL ?? "llama3.1";
    const body = JSON.stringify({
      model,
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
      options: {
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.maxOutputTokens ? { num_predict: request.maxOutputTokens } : {}),
        ...(request.seed === undefined ? {} : { seed: request.seed }),
      },
    });

    const response = await this.#fetch(`${this.#baseUrl()}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (!response.ok) throw await errorForResponse(this.id, response.status, response);

    const json = await parseJsonBody(this.id, await response.text());
    const message = json.message as Record<string, unknown> | undefined;
    const text = typeof message?.content === "string" ? message.content : undefined;

    if (text === undefined) {
      throw new AIProviderError(`${this.id} response contained no message content.`, {
        code: "ai/malformed-response",
        retryable: true,
      });
    }

    const inputTokens = pickNumber(json, "prompt_eval_count");
    const outputTokens = pickNumber(json, "eval_count");
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
