import { randomUUID } from "node:crypto";
import type { Severity } from "@maintainerkit/core";
import type { ProviderId, RepositoryRef } from "@maintainerkit/core";

/**
 * Audit event model.
 *
 * Deliberately storage-agnostic (see `AuditSink`): the initial release writes JSONL, and a future
 * adapter can persist the same objects without changing producers.
 *
 * Fields are designed to answer: who ran what, against which repository, with which policy version,
 * what was the outcome, and did a human approve it. No secrets, no unnecessary personal data —
 * author logins are included only where they are already public repository metadata.
 */
export type AuditEventType =
  | "run.started"
  | "validation.completed"
  | "policy.evaluated"
  | "audit.completed"
  | "ai.requested"
  | "ai.completed"
  | "ai.failed"
  | "write.requested"
  | "write.blocked"
  | "run.completed"
  | "run.failed";

export type AuditStatus = "success" | "failure" | "blocked" | "unknown";

export interface AuditActor {
  kind: "cli" | "action" | "sdk" | "unknown";
  /** Non-identifying label: GitHub actor login, CI job name, or "local". */
  id?: string;
}

export interface AuditWorkflow {
  name: string;
  runId?: string;
  trigger?: string;
  /** True when the workflow ran for a fork pull request (read-only, untrusted input). */
  fork?: boolean;
}

export interface AuditInputReference {
  /** e.g. `owner/name@main`, `pull/42`, or a file path. */
  reference: string;
  checksum?: string;
}

export interface AuditOutputSummary {
  status: "pass" | "fail";
  findings: number;
  failed: number;
  bySeverity?: Record<Severity, number>;
  reportPath?: string;
}

export interface AuditProvider {
  id: ProviderId;
  model?: string;
  capability?: string;
}

export interface AuditApproval {
  required: boolean;
  granted: boolean;
  approver?: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  type: AuditEventType;
  actor: AuditActor;
  repository?: RepositoryRef;
  workflow?: AuditWorkflow;
  policyVersion?: string;
  status: AuditStatus;
  input?: AuditInputReference;
  output?: AuditOutputSummary;
  provider?: AuditProvider;
  approval?: AuditApproval;
  /** Small, non-sensitive extras (e.g. exitCode, durationMs). */
  metadata?: Record<string, string | number | boolean>;
}

export interface CreateAuditEventInput {
  type: AuditEventType;
  status: AuditStatus;
  actor?: AuditActor;
  repository?: RepositoryRef;
  workflow?: AuditWorkflow;
  policyVersion?: string;
  input?: AuditInputReference;
  output?: AuditOutputSummary;
  provider?: AuditProvider;
  approval?: AuditApproval;
  metadata?: Record<string, string | number | boolean>;
  /** Injected for deterministic tests; defaults to now. */
  now?: Date;
  /** Injected for deterministic tests; defaults to a random UUID. */
  id?: string;
}

export function createAuditEvent(input: CreateAuditEventInput): AuditEvent {
  return {
    id: input.id ?? `evt_${randomUUID()}`,
    timestamp: (input.now ?? new Date()).toISOString(),
    type: input.type,
    actor: input.actor ?? { kind: "cli" },
    status: input.status,
    ...(input.repository ? { repository: input.repository } : {}),
    ...(input.workflow ? { workflow: input.workflow } : {}),
    ...(input.policyVersion ? { policyVersion: input.policyVersion } : {}),
    ...(input.input ? { input: input.input } : {}),
    ...(input.output ? { output: input.output } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.approval ? { approval: input.approval } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

/** Compact one-line rendering for logs. */
export function formatAuditEvent(event: AuditEvent): string {
  const parts = [
    event.timestamp,
    event.type,
    event.status,
    event.repository
      ? `${event.repository.owner ?? ""}/${event.repository.name}`.replace(/^\//, "")
      : undefined,
    event.policyVersion ? `policy=${event.policyVersion}` : undefined,
    event.output ? `findings=${event.output.findings}/${event.output.failed} failed` : undefined,
    event.provider ? `provider=${event.provider.id}` : undefined,
  ].filter(Boolean);
  return parts.join(" ");
}
