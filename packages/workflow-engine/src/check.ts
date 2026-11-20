import {
  ConfigError,
  ExecutionError,
  TOOL_NAME,
  TOOL_VERSION,
  summarizeFindings,
  type Advisor,
  type AdvisoryFinding,
  type Diagnostic,
  type PolicySubject,
  type PullRequestSnapshot,
  type RepositorySnapshot,
  type RepositorySource,
  type ReportEnvelope,
  type Severity,
} from "@maintainerkit/core";
import type { ResolvedConfig } from "@maintainerkit/contribspec";
import type { PolicyRegistry } from "@maintainerkit/policy-engine";
import { evaluatePolicy } from "@maintainerkit/policy-engine";
import {
  auditRepository,
  createAuditEvent,
  redactDeep,
  type AuditActor,
  type AuditEvent,
  type AuditSink,
  type AuditWorkflow,
} from "@maintainerkit/audit";

// The advisory seam lives in core so this layer never depends on an AI implementation.
export type { Advisor, AdvisorOutcome } from "@maintainerkit/core";

export interface WorkflowContext {
  now?: Date;
  actor?: AuditActor;
  workflow?: AuditWorkflow;
  auditSink?: AuditSink;
  toolVersion?: string;
}

export interface RunCheckOptions extends WorkflowContext {
  source: RepositorySource;
  config: ResolvedConfig;
  /** When set, the run evaluates pull-request policies for this PR instead of repository policies. */
  pullRequestNumber?: number;
  failOn?: Severity;
  dryRun?: boolean;
  advisor?: Advisor;
  registry?: PolicyRegistry;
  /** Diagnostics already collected while loading the configuration (warnings are preserved). */
  diagnostics?: Diagnostic[];
}

export interface WorkflowResult {
  report: ReportEnvelope;
  auditEvents: AuditEvent[];
}

async function emit(sink: AuditSink | undefined, event: AuditEvent): Promise<void> {
  if (!sink) return;
  await sink.append(event);
}

function redactReport(report: ReportEnvelope): ReportEnvelope {
  // Repository text can contain credentials (a token pasted into a PR body, say). Redact at the
  // boundary so every consumer — CLI, Action, SDK, saved JSON — gets the same safe artifact.
  return redactDeep(report);
}

function envelope(input: {
  kind: "check" | "audit";
  now: Date;
  toolVersion: string;
  subject: PolicySubject;
  findings: ReportEnvelope["findings"];
  summary: ReportEnvelope["summary"];
  advisories: AdvisoryFinding[];
  diagnostics: Diagnostic[];
  policyVersion: string | null;
  pullRequest?: PullRequestSnapshot;
}): ReportEnvelope {
  return redactReport({
    schemaVersion: "1",
    kind: input.kind,
    generatedAt: input.now.toISOString(),
    tool: { name: TOOL_NAME, version: input.toolVersion },
    policyVersion: { specVersion: input.policyVersion },
    subject: {
      kind: input.subject.kind,
      label: input.subject.label,
      repository: input.subject.repository.ref,
      ...(input.pullRequest ? { pullRequestNumber: input.pullRequest.number } : {}),
    },
    summary: input.summary,
    findings: input.findings,
    advisories: input.advisories,
    diagnostics: input.diagnostics,
  });
}

/**
 * Runs a policy check.
 *
 * Ordering is deliberate: the repository snapshot is read once, the policy engine runs before any
 * advisor, and advisor failures are captured as diagnostics so they can never influence the verdict.
 */
export async function runCheck(options: RunCheckOptions): Promise<WorkflowResult> {
  const now = options.now ?? new Date();
  const toolVersion = options.toolVersion ?? TOOL_VERSION;
  const events: AuditEvent[] = [];
  const push = async (event: AuditEvent) => {
    events.push(event);
    await emit(options.auditSink, event);
  };

  const repository: RepositorySnapshot = await options.source.getRepository();

  let pullRequest: PullRequestSnapshot | undefined;
  if (options.pullRequestNumber !== undefined) {
    if (
      !("getPullRequest" in options.source) ||
      typeof options.source.getPullRequest !== "function"
    ) {
      throw new ExecutionError(
        "This repository source cannot read pull requests.",
        "workflow/pull-request-unsupported",
        "Use --repo owner/name with a GitHub token for pull-request checks, or drop --pr to run repository policies.",
      );
    }
    pullRequest = await options.source.getPullRequest(options.pullRequestNumber);
  }

  const subject: PolicySubject = pullRequest
    ? {
        kind: "pull_request",
        label: `${repository.ref.owner ?? repository.ref.name}/${repository.ref.name}#${pullRequest.number}`,
        repository,
        pullRequest,
      }
    : {
        kind: "repository",
        label: repository.ref.owner
          ? `${repository.ref.owner}/${repository.ref.name}`
          : repository.ref.name,
        repository,
      };

  await push(
    createAuditEvent({
      type: "run.started",
      status: "unknown",
      now,
      actor: options.actor,
      workflow: options.workflow,
      repository: repository.ref,
      policyVersion: options.config.specVersion,
      input: { reference: subject.label },
      metadata: { dryRun: options.dryRun ?? false },
    }),
  );

  const evaluation = await evaluatePolicy(subject, options.config, {
    ...(options.failOn ? { failOn: options.failOn } : {}),
    dryRun: options.dryRun ?? false,
    now,
    ...(options.registry ? { registry: options.registry } : {}),
  });

  const diagnostics: Diagnostic[] = [...(options.diagnostics ?? [])];
  let advisories: AdvisoryFinding[] = [];

  if (options.advisor) {
    try {
      const outcome = await options.advisor({ subject, config: options.config });
      advisories = outcome.advisories;
      diagnostics.push(...(outcome.diagnostics ?? []));
    } catch (error) {
      diagnostics.push({
        code: "ai/advisor-failed",
        severity: "warning",
        message: `AI advisories were skipped: ${error instanceof Error ? error.message : String(error)}`,
        path: "",
        hint: "Policy results are unaffected. Fix the provider configuration if advisories are expected.",
      });
    }
  }

  // Advisories are counted in the summary for visibility, but only policy findings decide its status.
  const summary = summarizeFindings(evaluation.findings, advisories, {
    failOn: options.failOn ?? "error",
  });

  const report = envelope({
    kind: "check",
    now,
    toolVersion,
    subject,
    findings: evaluation.findings,
    summary,
    advisories,
    diagnostics,
    policyVersion: evaluation.policyVersion,
    ...(pullRequest ? { pullRequest } : {}),
  });

  await push(
    createAuditEvent({
      type: "policy.evaluated",
      status: summary.status === "pass" ? "success" : "failure",
      now,
      actor: options.actor,
      workflow: options.workflow,
      repository: repository.ref,
      policyVersion: evaluation.policyVersion,
      input: { reference: subject.label },
      output: {
        status: summary.status,
        findings: summary.total,
        failed: summary.fail + summary.error,
        bySeverity: summary.bySeverity,
      },
      metadata: {
        rules: evaluation.evaluatedRuleIds.join(","),
        disabledRules: evaluation.disabledRuleIds.join(","),
        advisoryCount: advisories.length,
        fork: pullRequest?.isFork === true,
      },
    }),
  );

  await push(
    createAuditEvent({
      type: "run.completed",
      status: "success",
      now,
      actor: options.actor,
      workflow: options.workflow,
      repository: repository.ref,
      policyVersion: evaluation.policyVersion,
    }),
  );

  return { report, auditEvents: events };
}

export interface RunAuditOptions extends WorkflowContext {
  source: RepositorySource;
}

/**
 * Repository health audit. Independent of ContribSpec: it works in any repository, with or without
 * a policy document, and never claims a numeric health score.
 */
export async function runAudit(options: RunAuditOptions): Promise<WorkflowResult> {
  const now = options.now ?? new Date();
  const toolVersion = options.toolVersion ?? TOOL_VERSION;
  const events: AuditEvent[] = [];
  const push = async (event: AuditEvent) => {
    events.push(event);
    await emit(options.auditSink, event);
  };

  const repository = await options.source.getRepository();
  const subject: PolicySubject = {
    kind: "repository",
    label: repository.ref.owner
      ? `${repository.ref.owner}/${repository.ref.name}`
      : repository.ref.name,
    repository,
  };

  await push(
    createAuditEvent({
      type: "run.started",
      status: "unknown",
      now,
      actor: options.actor,
      workflow: options.workflow,
      repository: repository.ref,
      input: { reference: subject.label },
      metadata: { kind: "audit" },
    }),
  );

  const result = await auditRepository(repository, { now });

  // Reuse the shared summary shape so every renderer handles audit and check reports identically.
  const summary = summarizeFindings(result.findings, [], { failOn: "error" });

  const report = envelope({
    kind: "audit",
    now,
    toolVersion,
    subject,
    findings: result.findings,
    summary,
    advisories: [],
    diagnostics: [],
    policyVersion: null,
  });

  await push(
    createAuditEvent({
      type: "audit.completed",
      status: result.status === "pass" ? "success" : "failure",
      now,
      actor: options.actor,
      workflow: options.workflow,
      repository: repository.ref,
      output: {
        status: result.status,
        findings: result.findings.length,
        failed: result.counts.fail,
        bySeverity: summary.bySeverity,
      },
      metadata: { checks: result.evaluatedCheckIds.join(",") },
    }),
  );

  await push(
    createAuditEvent({
      type: "run.completed",
      status: "success",
      now,
      actor: options.actor,
      workflow: options.workflow,
      repository: repository.ref,
    }),
  );

  return { report, auditEvents: events };
}

/** Guards callers that expect a resolved configuration before running a check. */
export function requirePolicyVersion(config: ResolvedConfig): string {
  if (!config.specVersion) {
    throw new ConfigError(
      "The resolved configuration has no ContribSpec version.",
      "config/missing-version",
    );
  }
  return config.specVersion;
}
