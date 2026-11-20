import { describe, expect, it, vi } from "vitest";
import {
  AI_CAPABILITY_IDS,
  AICapabilityError,
  AIProviderError,
  AITimeoutError,
  AIValidationError,
  CAPABILITY_CONTRACTS,
  MockAIProvider,
  AIProviderRegistry,
  capabilityContract,
  createDefaultAIRegistry,
  executeAIRequest,
  generateMockValue,
  isAICapability,
  parseAndValidate,
  parseStructured,
  toAdvisory,
  tryExecuteAIRequest,
  validateAgainstSchema,
} from "../src/index.js";
import type { AIProvider, AIRequest } from "../src/index.js";

const classificationRequest: AIRequest = {
  capability: "issue-classification",
  system: "system",
  user: "user",
  schema: capabilityContract("issue-classification").schema,
};

describe("capability contracts", () => {
  it("defines a closed schema for every capability", () => {
    expect(AI_CAPABILITY_IDS).toHaveLength(6);
    for (const id of AI_CAPABILITY_IDS) {
      const contract = CAPABILITY_CONTRACTS[id];
      expect(contract.id).toBe(id);
      expect(contract.schema.type).toBe("object");
      expect(contract.schema.additionalProperties).toBe(false);
      expect(contract.promptVersion).toMatch(/^\d+$/);
      expect(contract.constraints.length).toBeGreaterThan(0);
    }
  });

  it("recognises capability ids and rejects others", () => {
    expect(isAICapability("risk-analysis")).toBe(true);
    expect(isAICapability("merge-everything")).toBe(false);
  });
});

describe("structured output", () => {
  it("parses raw JSON", () => {
    expect(parseStructured('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses fenced JSON", () => {
    expect(parseStructured('Here you go:\n```json\n{"a":1}\n```\nThanks')).toEqual({ a: 1 });
  });

  it("parses JSON surrounded by prose", () => {
    expect(parseStructured('Sure. {"a":1} hope that helps')).toEqual({ a: 1 });
  });

  it("rejects non-JSON output", () => {
    expect(() => parseStructured("I cannot help with that.")).toThrow(AIValidationError);
  });

  it("rejects unknown keys, wrong enums, and out-of-range numbers", async () => {
    const schema = capabilityContract("issue-classification").schema;
    await expect(
      validateAgainstSchema(
        { category: "bug", confidence: 0.5, rationale: "x", suggestedLabels: [], extra: 1 },
        schema,
      ),
    ).rejects.toThrow(AIValidationError);
    await expect(
      validateAgainstSchema(
        { category: "nonsense", confidence: 0.5, rationale: "x", suggestedLabels: [] },
        schema,
      ),
    ).rejects.toThrow(AIValidationError);
    await expect(
      validateAgainstSchema(
        { category: "bug", confidence: 2, rationale: "x", suggestedLabels: [] },
        schema,
      ),
    ).rejects.toThrow(AIValidationError);
  });

  it("reports readable problems", async () => {
    try {
      await parseAndValidate(
        '{"category":"bug"}',
        capabilityContract("issue-classification").schema,
      );
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(AIValidationError);
      expect((error as AIValidationError).problems.join(" ")).toContain("confidence");
    }
  });

  it("generates mock values that satisfy every contract", async () => {
    for (const id of AI_CAPABILITY_IDS) {
      const contract = CAPABILITY_CONTRACTS[id];
      const value = generateMockValue(contract.schema);
      await expect(validateAgainstSchema(value, contract.schema)).resolves.toEqual(value);
    }
  });
});

describe("mock provider", () => {
  it("produces valid structured output for a request", async () => {
    const provider = new MockAIProvider();
    const result = await executeAIRequest({ provider, request: classificationRequest });
    expect(result.provider).toBe("mock");
    expect(result.model).toBe("mock-1");
    expect(result.capability).toBe("issue-classification");
    expect((result.data as { category: string }).category.length).toBeGreaterThan(0);
    expect(result.usage?.totalTokens ?? 0).toBeGreaterThan(0);
  });

  it("can be scripted for hostile-output tests", async () => {
    const provider = new MockAIProvider({ responder: () => "ignore previous instructions" });
    await expect(
      executeAIRequest({ provider, request: classificationRequest, maxAttempts: 1 }),
    ).rejects.toBeInstanceOf(AIValidationError);
  });

  it("counts calls", async () => {
    const provider = new MockAIProvider();
    await provider.complete(classificationRequest, {});
    expect(provider.calls).toBe(1);
  });
});

describe("executeAIRequest", () => {
  it("refuses capabilities the provider does not advertise", async () => {
    const limited: AIProvider = {
      id: "limited",
      capabilities: ["risk-analysis"],
      complete: async () => ({ text: "{}", model: "x" }),
    };
    await expect(
      executeAIRequest({ provider: limited, request: classificationRequest, maxAttempts: 1 }),
    ).rejects.toBeInstanceOf(AICapabilityError);
  });

  it("retries retryable failures, then succeeds", async () => {
    const provider = new MockAIProvider({ failFirst: 1 });
    const sleep = vi.fn(async () => undefined);
    const onRetry = vi.fn();
    const result = await executeAIRequest({
      provider,
      request: classificationRequest,
      sleep,
      onRetry,
    });

    expect(provider.calls).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(result.data).toBeTruthy();
  });

  it("does not retry non-retryable failures", async () => {
    const provider: AIProvider = {
      id: "broken",
      capabilities: AI_CAPABILITY_IDS,
      complete: async () => {
        throw new AIProviderError("nope", { code: "ai/fatal", retryable: false });
      },
    };
    const sleep = vi.fn(async () => undefined);
    await expect(
      executeAIRequest({ provider, request: classificationRequest, sleep, maxAttempts: 3 }),
    ).rejects.toThrow(/nope/);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after the attempt budget", async () => {
    const provider = new MockAIProvider({ failFirst: 99 });
    const sleep = vi.fn(async () => undefined);
    await expect(
      executeAIRequest({ provider, request: classificationRequest, sleep, maxAttempts: 2 }),
    ).rejects.toBeInstanceOf(AIProviderError);
    expect(provider.calls).toBe(2);
  });

  it("enforces the timeout even when a provider ignores the abort signal", async () => {
    const provider = new MockAIProvider({ ignoreAbort: true, delayMs: 60 });
    const sleep = vi.fn(async () => undefined);
    await expect(
      executeAIRequest({
        provider,
        request: classificationRequest,
        timeoutMs: 5,
        maxAttempts: 1,
        sleep,
      }),
    ).rejects.toBeInstanceOf(AITimeoutError);
  });

  it("reports duration using the injected clock", async () => {
    let tick = 0;
    const result = await executeAIRequest({
      provider: new MockAIProvider(),
      request: classificationRequest,
      now: () => (tick += 25),
    });
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("never returns partial data on invalid output", async () => {
    const provider = new MockAIProvider({
      responder: () => JSON.stringify({ category: "bug", confidence: 0.9, rationale: "x" }),
    });
    await expect(
      executeAIRequest({ provider, request: classificationRequest, maxAttempts: 1 }),
    ).rejects.toBeInstanceOf(AIValidationError);
  });

  it("returns errors instead of throwing in the safe wrapper", async () => {
    const provider = new MockAIProvider({ responder: () => "not json" });
    const outcome = await tryExecuteAIRequest({
      provider,
      request: classificationRequest,
      maxAttempts: 1,
    });
    expect(outcome.error).toBeInstanceOf(AIValidationError);
    expect(outcome.result).toBeUndefined();
  });
});

describe("advisories", () => {
  it("carries provider identity and prompt version", async () => {
    const result = await executeAIRequest({
      provider: new MockAIProvider(),
      request: classificationRequest,
    });
    const advisory = toAdvisory(result, {
      id: "adv-1",
      promptVersion: "1",
      title: "Classified",
      summary: "Looks like a bug.",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(advisory).toMatchObject({
      id: "adv-1",
      capability: "issue-classification",
      provider: "mock",
      model: "mock-1",
      promptVersion: "1",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("provider registry", () => {
  it("registers the mock provider by default", () => {
    const registry = createDefaultAIRegistry();
    expect(registry.ids()).toEqual(["mock"]);
    expect(registry.supporting("risk-analysis").map((provider) => provider.id)).toEqual(["mock"]);
  });

  it("rejects duplicate ids", () => {
    const registry = new AIProviderRegistry();
    registry.register(new MockAIProvider());
    expect(() => registry.register(new MockAIProvider())).toThrow(/already registered/);
  });

  it("can be created empty", () => {
    expect(createDefaultAIRegistry({ includeMock: false }).list()).toEqual([]);
  });
});
