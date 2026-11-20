import { describe, expect, it } from "vitest";
import {
  AIAuthenticationError,
  AIProviderError,
  AIRateLimitError,
  executeAIRequest,
  capabilityContract,
  type AIProvider,
  type AIRequest,
} from "@maintainerkit/ai-core";
import {
  AnthropicProvider,
  OllamaProvider,
  OpenAICompatibleProvider,
  SUPPORTED_PROVIDER_IDS,
  createProviderFromConfig,
  resolveProviderId,
  type FetchLike,
} from "../src/index.js";

const request: AIRequest = {
  capability: "risk-analysis",
  system: "SYSTEM",
  user: "USER",
  schema: capabilityContract("risk-analysis").schema,
};

const validRiskJson = JSON.stringify({
  riskLevel: "low",
  factors: [],
  requiresSecurityReview: false,
});

interface RecordedCall {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal };
}

function fakeFetch(
  respond: (call: RecordedCall) => {
    status?: number;
    body: string;
    headers?: Record<string, string>;
  },
): { fetchImpl: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    const response = respond(call);
    return {
      ok: (response.status ?? 200) < 400,
      status: response.status ?? 200,
      text: async () => response.body,
      headers: { get: (name: string) => response.headers?.[name.toLowerCase()] ?? null },
    };
  };
  return { fetchImpl, calls };
}

/**
 * Contract tests: every adapter must satisfy the same observable behaviour.
 * Any new provider is expected to pass this suite unchanged.
 */
interface ProviderCase {
  name: string;
  build: (fetchImpl: FetchLike) => AIProvider;
  successBody: string;
  expectedUrl: RegExp;
  /** Assertion for the outbound request, so a refactor cannot silently drop the system prompt. */
  assertRequest: (call: RecordedCall) => void;
}

const cases: ProviderCase[] = [
  {
    name: "openai-compatible",
    build: (fetchImpl) =>
      new OpenAICompatibleProvider({ apiKey: "test-key", model: "test-model", fetchImpl }),
    successBody: JSON.stringify({
      model: "test-model",
      choices: [{ message: { content: validRiskJson } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    expectedUrl: /\/chat\/completions$/,
    assertRequest: (call) => {
      expect(call.init.method).toBe("POST");
      expect(call.init.headers.authorization).toContain("Bearer test-key");
      const body = JSON.parse(call.init.body) as {
        model: string;
        messages: { role: string; content: string }[];
        response_format: { type: string };
      };
      expect(body.model).toBe("test-model");
      expect(body.messages[0]).toEqual({ role: "system", content: "SYSTEM" });
      expect(body.messages[1]).toEqual({ role: "user", content: "USER" });
      expect(body.response_format).toEqual({ type: "json_object" });
    },
  },
  {
    name: "anthropic",
    build: (fetchImpl) =>
      new AnthropicProvider({ apiKey: "test-key", model: "claude-test", fetchImpl }),
    successBody: JSON.stringify({
      model: "claude-test",
      content: [{ type: "text", text: validRiskJson }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
    expectedUrl: /\/v1\/messages$/,
    assertRequest: (call) => {
      expect(call.init.headers["x-api-key"]).toBe("test-key");
      expect(call.init.headers["anthropic-version"]).toBeDefined();
      const body = JSON.parse(call.init.body) as {
        system: string;
        messages: { content: string }[];
      };
      expect(body.system).toBe("SYSTEM");
      expect(body.messages[0]?.content).toBe("USER");
    },
  },
  {
    name: "ollama",
    build: (fetchImpl) => new OllamaProvider({ model: "llama-test", fetchImpl }),
    successBody: JSON.stringify({
      model: "llama-test",
      message: { content: validRiskJson },
      prompt_eval_count: 10,
      eval_count: 5,
    }),
    expectedUrl: /\/api\/chat$/,
    assertRequest: (call) => {
      const body = JSON.parse(call.init.body) as {
        stream: boolean;
        format: string;
        messages: unknown[];
      };
      expect(body.stream).toBe(false);
      expect(body.format).toBe("json");
      expect(body.messages).toHaveLength(2);
    },
  },
];

describe.each(cases)("$name provider contract", (providerCase) => {
  it("sends the system and user prompt and returns validated data", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: providerCase.successBody }));
    const provider = providerCase.build(fetchImpl);

    const result = await executeAIRequest({ provider, request });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toMatch(providerCase.expectedUrl);
    providerCase.assertRequest(calls[0]!);
    expect(result.data).toEqual({ riskLevel: "low", factors: [], requiresSecurityReview: false });
    expect(result.provider).toBe(provider.id);
    expect(result.usage?.inputTokens).toBe(10);
  });

  it("maps 401 to an authentication error without echoing the key", async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 401, body: '{"error":"bad key"}' }));
    const provider = providerCase.build(fetchImpl);

    await expect(executeAIRequest({ provider, request, maxAttempts: 1 })).rejects.toBeInstanceOf(
      AIAuthenticationError,
    );
    try {
      await executeAIRequest({ provider, request, maxAttempts: 1 });
    } catch (error) {
      expect((error as Error).message).not.toContain("test-key");
      expect((error as { code?: string }).code).toBe("ai/authentication-failed");
    }
  });

  it("maps 429 to a retryable rate-limit error", async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 429,
      body: "slow down",
      headers: { "retry-after": "2" },
    }));
    const provider = providerCase.build(fetchImpl);
    const error = await executeAIRequest({ provider, request, maxAttempts: 1 }).catch(
      (caught) => caught,
    );
    expect(error).toBeInstanceOf(AIRateLimitError);
    expect((error as AIProviderError).retryable).toBe(true);
  });

  it("marks 5xx as retryable and 4xx as not", async () => {
    const server = providerCase.build(fakeFetch(() => ({ status: 503, body: "down" })).fetchImpl);
    const client = providerCase.build(fakeFetch(() => ({ status: 400, body: "bad" })).fetchImpl);

    const serverError = await executeAIRequest({ provider: server, request, maxAttempts: 1 }).catch(
      (e) => e,
    );
    const clientError = await executeAIRequest({ provider: client, request, maxAttempts: 1 }).catch(
      (e) => e,
    );

    expect((serverError as AIProviderError).retryable).toBe(true);
    expect((clientError as AIProviderError).retryable).toBe(false);
  });

  it("rejects responses that are not JSON at all", async () => {
    const { fetchImpl } = fakeFetch(() => ({ body: "<html>gateway</html>" }));
    const provider = providerCase.build(fetchImpl);
    await expect(executeAIRequest({ provider, request, maxAttempts: 1 })).rejects.toBeInstanceOf(
      AIProviderError,
    );
  });

  it("rejects a response missing the expected envelope", async () => {
    const { fetchImpl } = fakeFetch(() => ({ body: '{"unexpected":true}' }));
    const provider = providerCase.build(fetchImpl);
    await expect(executeAIRequest({ provider, request, maxAttempts: 1 })).rejects.toThrow(
      /no message content|no text block/,
    );
  });

  it("propagates abort signals to fetch", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: providerCase.successBody }));
    const controller = new AbortController();
    const provider = providerCase.build(fetchImpl);
    await provider.complete(request, { signal: controller.signal });
    expect(calls[0]?.init.signal).toBe(controller.signal);
  });
});

describe("credentials and model selection", () => {
  const originalOpenAI = process.env.OPENAI_API_KEY;
  const originalAnthropic = process.env.ANTHROPIC_API_KEY;

  it("reports missing credentials with a hint", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const openai = new OpenAICompatibleProvider({
        fetchImpl: fakeFetch(() => ({ body: "{}" })).fetchImpl,
      });
      await expect(openai.complete(request, {})).rejects.toThrow(/No API key/);

      const anthropic = new AnthropicProvider({
        fetchImpl: fakeFetch(() => ({ body: "{}" })).fetchImpl,
      });
      await expect(anthropic.complete(request, {})).rejects.toThrow(/No API key/);
    } finally {
      if (originalOpenAI) process.env.OPENAI_API_KEY = originalOpenAI;
      if (originalAnthropic) process.env.ANTHROPIC_API_KEY = originalAnthropic;
    }
  });

  it("requires a model for cloud providers", async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: "k",
      fetchImpl: fakeFetch(() => ({ body: "{}" })).fetchImpl,
    });
    const previous = process.env.MAINTAINERKIT_AI_MODEL;
    delete process.env.MAINTAINERKIT_AI_MODEL;
    try {
      await expect(provider.complete(request, {})).rejects.toThrow(/No model configured/);
    } finally {
      if (previous) process.env.MAINTAINERKIT_AI_MODEL = previous;
    }
  });

  it("defaults ollama to a local URL without a key", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      body: JSON.stringify({ message: { content: validRiskJson } }),
    }));
    const provider = new OllamaProvider({ fetchImpl });
    await provider.complete(request, {});
    expect(calls[0]?.url).toMatch(/^http:\/\/127\.0\.0\.1:11434\/api\/chat$/);
  });
});

describe("provider factory", () => {
  it("creates each supported provider", () => {
    expect(createProviderFromConfig({ provider: "mock" }).id).toBe("mock");
    expect(createProviderFromConfig({ provider: "openai", apiKey: "k", model: "m" }).id).toBe(
      "openai",
    );
    expect(createProviderFromConfig({ provider: "anthropic", apiKey: "k", model: "m" }).id).toBe(
      "anthropic",
    );
    expect(createProviderFromConfig({ provider: "ollama" }).id).toBe("ollama");
  });

  it("rejects unknown providers with the supported list", () => {
    expect(() => createProviderFromConfig({ provider: "gpt-9000" })).toThrow(/Unknown AI provider/);
    for (const id of SUPPORTED_PROVIDER_IDS) {
      expect(() => createProviderFromConfig({ provider: id })).not.toThrow();
    }
  });

  it("resolves the provider id by precedence: flag, config, environment", () => {
    const env = { MAINTAINERKIT_AI_PROVIDER: "ollama" } as NodeJS.ProcessEnv;
    expect(resolveProviderId({ flag: "mock", config: "anthropic", env })).toBe("mock");
    expect(resolveProviderId({ config: "anthropic", env })).toBe("anthropic");
    expect(resolveProviderId({ env })).toBe("ollama");
    expect(resolveProviderId({ env: {} as NodeJS.ProcessEnv })).toBeUndefined();
  });
});
