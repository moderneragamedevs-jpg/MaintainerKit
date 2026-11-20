import { MockAIProvider } from "./mock.js";
import { AIProviderRegistry } from "./registry.js";

/** Registry with the mock provider pre-registered: AI workflows are always testable offline. */
export function createDefaultAIRegistry(
  options: { includeMock?: boolean } = {},
): AIProviderRegistry {
  const registry = new AIProviderRegistry();
  if (options.includeMock !== false) registry.register(new MockAIProvider());
  return registry;
}

export const DEFAULT_MOCK_PROVIDER_ID = "mock";
