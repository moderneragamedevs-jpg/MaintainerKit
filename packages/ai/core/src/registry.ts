import type { AICapability, AIProvider } from "./types.js";

export class DuplicateProviderError extends Error {
  constructor(id: string) {
    super(`An AI provider with id "${id}" is already registered.`);
    this.name = "DuplicateProviderError";
  }
}

/**
 * Provider registry.
 *
 * The application selects a provider by id from configuration or the environment. Nothing else in
 * MaintainerKit knows provider names, so adding a vendor is a registration, not a change to the
 * policy engine, the CLI, or the Action.
 */
export class AIProviderRegistry {
  readonly #providers = new Map<string, AIProvider>();

  register(provider: AIProvider): this {
    if (this.#providers.has(provider.id)) throw new DuplicateProviderError(provider.id);
    if (provider.capabilities.length === 0) {
      throw new Error(`AI provider "${provider.id}" declares no capabilities.`);
    }
    this.#providers.set(provider.id, provider);
    return this;
  }

  get(id: string): AIProvider | undefined {
    return this.#providers.get(id);
  }

  has(id: string): boolean {
    return this.#providers.has(id);
  }

  list(): AIProvider[] {
    return [...this.#providers.values()];
  }

  ids(): string[] {
    return this.list().map((provider) => provider.id);
  }

  /** Providers that advertise a capability, in registration order. */
  supporting(capability: AICapability): AIProvider[] {
    return this.list().filter((provider) => provider.capabilities.includes(capability));
  }
}
