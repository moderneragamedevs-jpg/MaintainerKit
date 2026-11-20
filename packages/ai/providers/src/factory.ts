import { AIProviderError, MockAIProvider, type AIProvider } from "@maintainerkit/ai-core";
import { AnthropicProvider } from "./anthropic.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

export interface ProviderSelection {
  /** Provider id from ContribSpec `ai.provider`, `--provider`, or MAINTAINERKIT_AI_PROVIDER. */
  provider: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

export const SUPPORTED_PROVIDER_IDS = [
  "mock",
  "openai-compatible",
  "openai",
  "anthropic",
  "ollama",
] as const;

/**
 * Builds a provider from configuration.
 *
 * Provider choice is deliberately explicit: there is no "auto-detect and silently call a cloud API"
 * path, because sending repository content to an unexpected provider is a privacy decision.
 */
export function createProviderFromConfig(
  selection: ProviderSelection,
  env: NodeJS.ProcessEnv = process.env,
): AIProvider {
  const provider = selection.provider.trim().toLowerCase();

  switch (provider) {
    case "mock":
      return new MockAIProvider();

    case "openai":
    case "openai-compatible":
      return new OpenAICompatibleProvider({
        ...(provider === "openai" ? { id: "openai" } : {}),
        ...(selection.apiKey ? { apiKey: selection.apiKey } : {}),
        ...(selection.baseUrl ? { baseUrl: selection.baseUrl } : {}),
        ...(selection.model ? { model: selection.model } : {}),
      });

    case "anthropic":
      return new AnthropicProvider({
        ...(selection.apiKey ? { apiKey: selection.apiKey } : {}),
        ...(selection.baseUrl ? { baseUrl: selection.baseUrl } : {}),
        ...(selection.model ? { model: selection.model } : {}),
      });

    case "ollama":
      return new OllamaProvider({
        ...(selection.baseUrl ? { baseUrl: selection.baseUrl } : {}),
        ...(selection.model ? { model: selection.model } : {}),
      });

    default:
      throw new AIProviderError(`Unknown AI provider "${selection.provider}".`, {
        code: "ai/unknown-provider",
        hint: `Supported providers: ${SUPPORTED_PROVIDER_IDS.join(", ")}. Set ai.provider in ContribSpec or pass --provider.`,
      });
  }

  // Unreachable; keeps the signature honest if a case is ever added without a return.
  void env;
}

/** Resolves the provider id from flag, config, then environment — in that precedence order. */
export function resolveProviderId(input: {
  flag?: string;
  config?: string;
  env?: NodeJS.ProcessEnv;
}): string | undefined {
  const env = input.env ?? process.env;
  return input.flag ?? input.config ?? env.MAINTAINERKIT_AI_PROVIDER;
}
