import { assertValidRuleId, type RuleDefinition, type SubjectKind } from "./types.js";

export class DuplicateRuleError extends Error {
  constructor(id: string) {
    super(`A rule with id "${id}" is already registered.`);
    this.name = "DuplicateRuleError";
  }
}

/**
 * An ordered, immutable-by-convention collection of rules.
 *
 * Third parties extend policy by registering their own `RuleDefinition` instances; the built-in
 * rules use the same contract, so there is no privileged path.
 */
export class PolicyRegistry {
  readonly #rules = new Map<string, RuleDefinition>();

  constructor(rules: readonly RuleDefinition[] = []) {
    for (const rule of rules) this.register(rule);
  }

  register(rule: RuleDefinition): this {
    assertValidRuleId(rule.id);
    if (rule.appliesTo.length === 0) {
      throw new Error(`Rule "${rule.id}" declares no applicable subject kinds.`);
    }
    if (this.#rules.has(rule.id)) throw new DuplicateRuleError(rule.id);
    this.#rules.set(rule.id, rule);
    return this;
  }

  get(id: string): RuleDefinition | undefined {
    return this.#rules.get(id);
  }

  has(id: string): boolean {
    return this.#rules.has(id);
  }

  list(kind?: SubjectKind): RuleDefinition[] {
    const rules = [...this.#rules.values()];
    return kind ? rules.filter((rule) => rule.appliesTo.includes(kind)) : rules;
  }

  ids(): string[] {
    return this.list().map((rule) => rule.id);
  }
}
