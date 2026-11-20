import type { Evidence, PolicySubject, Severity } from "@maintainerkit/core";
import type { ResolvedConfig } from "@maintainerkit/contribspec";

export type SubjectKind = "repository" | "pull_request" | "release";

export interface RuleContext {
  config: ResolvedConfig;
  subject: PolicySubject;
  options: {
    /** Dry run must not change the result, only how it is reported/published. */
    dryRun: boolean;
    /** Injected timestamp so evaluation is reproducible. */
    now: string;
  };
}

/**
 * A single rule outcome. Rules are pure: they read the snapshot and config, and never perform I/O
 * other than through `subject.repository.readFile` (which is itself part of the input snapshot).
 */
export interface RuleResult {
  /** `skip` is required when the rule's inputs are unavailable — never report `pass` on ignorance. */
  status: "pass" | "fail" | "skip";
  message: string;
  evidence?: Evidence[];
  remediation?: string;
}

export interface RuleDefinition {
  /** Stable id, `MK-<AREA>-<NNN>`. Changing it is a breaking change for configuration overrides. */
  id: string;
  title: string;
  description: string;
  appliesTo: readonly SubjectKind[];
  defaultSeverity: Severity;
  /** JSON Pointer into ContribSpec that configures this rule (used in explain output). */
  policyPath: string;
  docsAnchor: string;
  evaluate(context: RuleContext): RuleResult | RuleResult[] | Promise<RuleResult | RuleResult[]>;
}

/** Rule ids are part of the public contract: `MK-PR-001`, `MK-SEC-001`, ... */
export const RULE_ID_PATTERN = /^MK-[A-Z]{2,4}-[0-9]{3}$/;

export function assertValidRuleId(id: string): void {
  if (!RULE_ID_PATTERN.test(id)) {
    throw new Error(`Invalid rule id "${id}": expected the form MK-AREA-001.`);
  }
}
