import type { Severity } from "@maintainerkit/core";
import type { ResolvedConfig } from "@maintainerkit/contribspec";
import { getDefaultRegistry } from "./evaluate.js";
import type { RuleDefinition } from "./rules/types.js";

export interface RuleExplanation {
  id: string;
  title: string;
  description: string;
  appliesTo: readonly string[];
  defaultSeverity: Severity;
  effectiveSeverity: Severity;
  enabled: boolean;
  policyPath: string;
  docsUrl: string;
  /** Smallest change that would make the rule pass, phrased for humans. */
  remediationHint: string;
}

const REMEDIATION_HINTS: Record<string, string> = {
  "MK-PR-001": 'Reword the title as "<type>(<scope>): <subject>" using an allowed type.',
  "MK-PR-002": "Add the missing description sections and enough context for a reviewer.",
  "MK-PR-003": "Make the named CI check run and pass on this pull request.",
  "MK-PR-004": "Satisfy the contributor requirements, or ask a maintainer to adopt the change.",
  "MK-REPO-001": "Add the missing file, or remove it from repository.requiredFiles.",
  "MK-REL-001": 'Add a "## [Unreleased]" changelog section and align version files.',
  "MK-SEC-001": "Enable the missing GitHub security feature in repository settings.",
};

/** Static explanation of a rule, independent of any subject. */
export function explainRule(ruleId: string, config?: ResolvedConfig): RuleExplanation {
  const rule: RuleDefinition | undefined = getDefaultRegistry().get(ruleId);
  if (!rule) {
    throw new Error(`Unknown rule "${ruleId}".`);
  }
  const override = config?.rules[rule.id];
  return {
    id: rule.id,
    title: rule.title,
    description: rule.description,
    appliesTo: rule.appliesTo,
    defaultSeverity: rule.defaultSeverity,
    effectiveSeverity: override?.severity ?? rule.defaultSeverity,
    enabled: override?.enabled !== false,
    policyPath: rule.policyPath,
    docsUrl: `docs/POLICY_RULES.md${rule.docsAnchor}`,
    remediationHint: REMEDIATION_HINTS[rule.id] ?? "See the rule documentation.",
  };
}

/** All rules, in catalog order. */
export function listRules(): RuleDefinition[] {
  return getDefaultRegistry().list();
}
