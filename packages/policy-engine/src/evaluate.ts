import {
  createFinding,
  describeError,
  summarizeFindings,
  type PolicyFinding,
  type PolicySubject,
  type ReportSubject,
  type ReportSummary,
  type Severity,
} from "@maintainerkit/core";
import type { ResolvedConfig } from "@maintainerkit/contribspec";
import { BUILT_IN_RULES } from "./rules/index.js";
import { PolicyRegistry } from "./rules/registry.js";
import type { RuleResult } from "./rules/types.js";

export interface EvaluateOptions {
  /** Findings at or above this severity fail the run. Default `error`. */
  failOn?: Severity;
  /** Present in the API for symmetry with command flags; dry runs never change results. */
  dryRun?: boolean;
  /** Injected clock. Rules must not read the wall clock themselves. */
  now?: Date;
  /** Custom catalog (defaults to the built-in rules). */
  registry?: PolicyRegistry;
}

export interface EvaluationReport {
  findings: PolicyFinding[];
  summary: ReportSummary;
  policyVersion: string;
  subject: ReportSubject;
  /** Rule ids that ran, in order — useful for "what did this actually check?" questions. */
  evaluatedRuleIds: string[];
  /** Rule ids skipped because configuration disabled them. */
  disabledRuleIds: string[];
}

let defaultRegistry: PolicyRegistry | undefined;

export function createDefaultRegistry(): PolicyRegistry {
  return new PolicyRegistry(BUILT_IN_RULES);
}

export function getDefaultRegistry(): PolicyRegistry {
  defaultRegistry ??= createDefaultRegistry();
  return defaultRegistry;
}

function subjectKeyOf(subject: PolicySubject): string {
  if (subject.kind === "pull_request" && subject.pullRequest)
    return `pr-${subject.pullRequest.number}`;
  return subject.kind;
}

function toFindings(
  ruleId: string,
  ruleTitle: string,
  subjectKind: PolicySubject["kind"],
  subjectKey: string,
  severity: Severity,
  policyPath: string,
  docsAnchor: string,
  results: readonly RuleResult[],
): PolicyFinding[] {
  const docsUrl = `docs/POLICY_RULES.md${docsAnchor}`;
  return results.map((result, index) =>
    createFinding({
      id: `${ruleId}:${subjectKey}${results.length > 1 ? `#${index + 1}` : ""}`,
      ruleId,
      ruleTitle,
      status: result.status,
      severity,
      message: result.message,
      evidence: result.evidence ?? [],
      ...(result.remediation ? { remediation: result.remediation } : {}),
      policyPath,
      docsUrl,
      subjectKind,
    }),
  );
}

/**
 * Runs every rule that applies to the subject's kind.
 *
 * Guarantees:
 * - deterministic: same snapshot + config + injected clock ⇒ identical findings
 * - total: a rule that throws produces an `error` finding; evaluation never rejects
 * - explainable: each finding carries rule id, evidence, policy path, and remediation
 */
export async function evaluatePolicy(
  subject: PolicySubject,
  config: ResolvedConfig,
  options: EvaluateOptions = {},
): Promise<EvaluationReport> {
  const registry = options.registry ?? getDefaultRegistry();
  const now = (options.now ?? new Date()).toISOString();
  const findings: PolicyFinding[] = [];
  const evaluatedRuleIds: string[] = [];
  const disabledRuleIds: string[] = [];
  const subjectKey = subjectKeyOf(subject);

  for (const rule of registry.list(subject.kind)) {
    const override = config.rules[rule.id];
    if (override?.enabled === false) {
      disabledRuleIds.push(rule.id);
      continue;
    }
    const severity = override?.severity ?? rule.defaultSeverity;
    evaluatedRuleIds.push(rule.id);

    try {
      const outcome = await rule.evaluate({
        config,
        subject,
        options: { dryRun: options.dryRun ?? false, now },
      });
      const results = Array.isArray(outcome) ? outcome : [outcome];
      if (results.length === 0) {
        findings.push(
          createFinding({
            id: `${rule.id}:${subjectKey}`,
            ruleId: rule.id,
            ruleTitle: rule.title,
            status: "error",
            severity: "error",
            message: "The rule returned no results, which is a rule implementation bug.",
            evidence: [],
            policyPath: rule.policyPath,
            docsUrl: `docs/POLICY_RULES.md${rule.docsAnchor}`,
            subjectKind: subject.kind,
          }),
        );
        continue;
      }
      findings.push(
        ...toFindings(
          rule.id,
          rule.title,
          subject.kind,
          subjectKey,
          severity,
          rule.policyPath,
          rule.docsAnchor,
          results,
        ),
      );
    } catch (error) {
      const described = describeError(error);
      findings.push(
        createFinding({
          id: `${rule.id}:${subjectKey}`,
          ruleId: rule.id,
          ruleTitle: rule.title,
          status: "error",
          severity: "error",
          message: `Rule failed to evaluate: ${described.message}`,
          evidence: described.code ? [{ label: "error code", value: described.code }] : [],
          policyPath: rule.policyPath,
          docsUrl: `docs/POLICY_RULES.md${rule.docsAnchor}`,
          subjectKind: subject.kind,
        }),
      );
    }
  }

  const summary = summarizeFindings(findings, [], { failOn: options.failOn ?? "error" });

  return {
    findings,
    summary,
    policyVersion: config.specVersion,
    subject: {
      kind: subject.kind,
      label: subject.label,
      repository: subject.repository.ref,
      ...(subject.kind === "pull_request" && subject.pullRequest
        ? { pullRequestNumber: subject.pullRequest.number }
        : {}),
    },
    evaluatedRuleIds,
    disabledRuleIds,
  };
}

/** Checks whether a finding blocks the run under the given threshold. */
export function isBlocking(finding: PolicyFinding, failOn: Severity = "error"): boolean {
  if (finding.status === "error") return true;
  if (finding.status !== "fail") return false;
  const rank: Record<Severity, number> = { info: 0, warning: 1, error: 2 };
  return rank[finding.severity] >= rank[failOn];
}
