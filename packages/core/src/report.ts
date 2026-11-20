import { isAtLeast, maxSeverity, type Severity } from "./severity.js";
import type { Diagnostic } from "./diagnostics.js";
import type { RepositoryRef } from "./snapshot.js";

export type RuleStatus = "pass" | "fail" | "skip" | "error";

export interface Evidence {
  label: string;
  /** Redacted at render time. Never place secrets here. */
  value: string;
}

/** A deterministic policy result. Produced only by `@maintainerkit/policy-engine`. */
export interface PolicyFinding {
  /** Stable identifier for this finding: `<ruleId>:<subjectKey>`. */
  id: string;
  ruleId: string;
  ruleTitle: string;
  status: RuleStatus;
  severity: Severity;
  message: string;
  evidence: Evidence[];
  remediation?: string;
  /** JSON Pointer into the ContribSpec document that configured this rule. */
  policyPath?: string;
  docsUrl?: string;
  subjectKind: "repository" | "pull_request" | "release";
}

/**
 * A non-authoritative AI recommendation.
 *
 * Structurally separate from `PolicyFinding` on purpose (ADR-0002): it is never counted in the
 * summary status, never affects exit codes, and always names the provider that produced it.
 */
export interface AdvisoryFinding {
  id: string;
  capability: string;
  provider: string;
  model: string;
  promptVersion: string;
  title: string;
  summary: string;
  /** 0..1 self-reported by the model, or omitted when the provider gives none. */
  confidence?: number;
  items?: { label: string; detail: string }[];
  createdAt: string;
}

export type ReportStatus = "pass" | "fail";

export interface ReportSummary {
  total: number;
  pass: number;
  fail: number;
  skip: number;
  error: number;
  bySeverity: Record<Severity, number>;
  status: ReportStatus;
  worstSeverity?: Severity;
  advisoryCount: number;
}

export interface ReportSubject {
  kind: "repository" | "pull_request" | "release";
  label: string;
  repository: RepositoryRef;
  pullRequestNumber?: number;
}

/** Current JSON report contract. Additive changes only within a major version. */
export const REPORT_SCHEMA_VERSION = "1" as const;

export interface ReportEnvelope {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  kind: "check" | "audit";
  generatedAt: string;
  tool: { name: string; version: string };
  /** ContribSpec version used for evaluation; `null` for audits that used no policy document. */
  policyVersion: { specVersion: string | null };
  subject: ReportSubject;
  summary: ReportSummary;
  findings: PolicyFinding[];
  advisories: AdvisoryFinding[];
  diagnostics: Diagnostic[];
  audit?: { eventLogPath?: string; eventCount: number };
}

export interface SummarizeOptions {
  /** Findings with status `fail` at or above this severity make the run fail. Default `error`. */
  failOn?: Severity;
}

/**
 * Deterministic summary. Rules that could not run (`status: "error"`) are treated as failures:
 * a run must never certify a repository when a rule crashed.
 *
 * Advisories are counted for visibility only and cannot change `status`.
 */
export function summarizeFindings(
  findings: readonly PolicyFinding[],
  advisories: readonly AdvisoryFinding[] = [],
  options: SummarizeOptions = {},
): ReportSummary {
  const failOn = options.failOn ?? "error";
  const bySeverity: Record<Severity, number> = { info: 0, warning: 0, error: 0 };
  let pass = 0;
  let fail = 0;
  let skip = 0;
  let error = 0;
  let blocking = false;

  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    switch (finding.status) {
      case "pass":
        pass += 1;
        break;
      case "skip":
        skip += 1;
        break;
      case "fail":
        fail += 1;
        if (isAtLeast(finding.severity, failOn)) blocking = true;
        break;
      case "error":
        error += 1;
        blocking = true;
        break;
    }
  }

  const severityOfFailed = findings
    .filter((finding) => finding.status === "fail" || finding.status === "error")
    .map((finding) => finding.severity);
  const worst = maxSeverity(severityOfFailed);

  return {
    total: findings.length,
    pass,
    fail,
    skip,
    error,
    bySeverity,
    status: blocking ? "fail" : "pass",
    ...(worst === undefined ? {} : { worstSeverity: worst }),
    advisoryCount: advisories.length,
  };
}

/** Builds a finding with a stable id, so reports are diffable across runs. */
export function createFinding(input: Omit<PolicyFinding, "id"> & { id?: string }): PolicyFinding {
  return { ...input, id: input.id ?? `${input.ruleId}:${input.subjectKind}` };
}
