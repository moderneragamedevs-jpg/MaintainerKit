import type { Severity } from "@maintainerkit/core";

export type ContribSpecSeverity = Severity;

export const AI_CAPABILITIES = [
  "issue-classification",
  "duplicate-issue-suggestion",
  "pull-request-summary",
  "risk-analysis",
  "review-assistance",
  "release-notes",
] as const;
export type AIcapability = (typeof AI_CAPABILITIES)[number];

export const AGENT_OPERATIONS = [
  "read",
  "comment",
  "label",
  "close",
  "merge",
  "release",
  "push",
] as const;
export type AgentOperation = (typeof AGENT_OPERATIONS)[number];

/** Operations that change repository state and therefore need explicit human approval. */
export const MUTATING_OPERATIONS: readonly AgentOperation[] = [
  "comment",
  "label",
  "close",
  "merge",
  "release",
  "push",
] as const;

export interface RequiredFileSpec {
  path: string;
  description?: string;
}

export interface PullRequestTitlePolicy {
  convention?: "conventional" | "none";
  types?: string[];
  requireScope?: boolean;
  maxLength?: number;
}

export interface PullRequestDescriptionPolicy {
  minLength?: number;
  requiredSections?: string[];
  requireLinkedIssue?: boolean;
}

export interface PullRequestChecksPolicy {
  required?: string[];
  acceptedConclusions?: ("success" | "neutral" | "skipped")[];
}

export interface PullRequestContributorPolicy {
  allowedAuthorAssociations?: string[];
  requireDcoSignoff?: boolean;
  requireVerifiedCommits?: boolean;
}

export interface RuleOverride {
  enabled?: boolean;
  severity?: ContribSpecSeverity;
}

/** The document as authored. Only `specVersion` is required; everything else is optional. */
export interface ContribSpecDocument {
  $schema?: string;
  specVersion: string;
  metadata?: {
    name?: string;
    description?: string;
    url?: string;
    maintainers?: string[];
  };
  repository?: {
    requiredFiles?: (string | RequiredFileSpec)[];
  };
  pullRequests?: {
    title?: PullRequestTitlePolicy;
    description?: PullRequestDescriptionPolicy;
    checks?: PullRequestChecksPolicy;
    contributor?: PullRequestContributorPolicy;
  };
  issues?: {
    requireTemplate?: boolean;
    requiredLabels?: string[];
    staleAfterDays?: number;
  };
  release?: {
    changelogPath?: string;
    requireUnreleasedSection?: boolean;
    requireChangelogEntry?: boolean;
    versionFiles?: string[];
  };
  security?: {
    requireDependencyAlerts?: boolean;
    requireSecretScanning?: boolean;
    requirePushProtection?: boolean;
    requireBranchProtection?: boolean;
    requireSignedCommits?: boolean;
    minimumApprovals?: number;
  };
  ai?: {
    enabled?: boolean;
    provider?: string;
    model?: string;
    capabilities?: AIcapability[];
    requireHumanApprovalFor?: AgentOperation[];
  };
  agents?: {
    allowedOperations?: AgentOperation[];
    humanApprovalRequired?: boolean;
  };
  rules?: Record<string, RuleOverride>;
}

/**
 * Defaults applied to an authored document. Fields that are left `undefined` here mean
 * "no policy configured", which rules must treat as `skip` rather than inventing a rule.
 */
export interface ResolvedConfig {
  specVersion: string;
  metadata: NonNullable<ContribSpecDocument["metadata"]>;
  repository: { requiredFiles: RequiredFileSpec[] };
  pullRequests: {
    title: Required<Omit<PullRequestTitlePolicy, "convention">> & {
      convention: "conventional" | "none";
    };
    description: Required<PullRequestDescriptionPolicy>;
    checks: { required: string[]; acceptedConclusions: ("success" | "neutral" | "skipped")[] };
    contributor: {
      allowedAuthorAssociations?: string[];
      requireDcoSignoff: boolean;
      requireVerifiedCommits: boolean;
    };
  };
  issues: { requireTemplate: boolean; requiredLabels: string[]; staleAfterDays?: number };
  release: {
    changelogPath: string;
    requireUnreleasedSection: boolean;
    requireChangelogEntry: boolean;
    versionFiles: string[];
  };
  security: {
    requireDependencyAlerts: boolean;
    requireSecretScanning: boolean;
    requirePushProtection: boolean;
    requireBranchProtection: boolean;
    requireSignedCommits: boolean;
    minimumApprovals: number;
  };
  ai: {
    enabled: boolean;
    provider?: string;
    model?: string;
    capabilities: AIcapability[];
    requireHumanApprovalFor: AgentOperation[];
  };
  agents: { allowedOperations: AgentOperation[]; humanApprovalRequired: boolean };
  rules: Record<string, RuleOverride>;
}

export const DEFAULT_PR_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
] as const;
