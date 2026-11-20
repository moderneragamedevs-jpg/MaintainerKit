import { DEFAULT_PR_TYPES, MUTATING_OPERATIONS } from "./types.js";
import type {
  ContribSpecDocument,
  RequiredFileSpec,
  ResolvedConfig,
  RuleOverride,
} from "./types.js";

function normaliseRequiredFiles(
  entries: (string | { path: string; description?: string })[] | undefined,
): RequiredFileSpec[] {
  if (!entries) return [{ path: "README.md" }, { path: "LICENSE" }];
  return entries.map((entry) =>
    typeof entry === "string"
      ? { path: entry }
      : { path: entry.path, ...(entry.description ? { description: entry.description } : {}) },
  );
}

/**
 * Applies documented defaults. Pure and total: given a schema-valid document it always returns a
 * complete configuration, so rules never need their own fallback logic (and cannot disagree about
 * what "unset" means).
 */
export function resolveConfig(document: ContribSpecDocument): ResolvedConfig {
  const doc = document;
  const contributor = doc.pullRequests?.contributor;

  return {
    specVersion: doc.specVersion,
    metadata: {
      ...(doc.metadata?.name ? { name: doc.metadata.name } : {}),
      ...(doc.metadata?.description ? { description: doc.metadata.description } : {}),
      ...(doc.metadata?.url ? { url: doc.metadata.url } : {}),
      ...(doc.metadata?.maintainers ? { maintainers: [...doc.metadata.maintainers] } : {}),
    },
    repository: {
      requiredFiles: normaliseRequiredFiles(doc.repository?.requiredFiles),
    },
    pullRequests: {
      title: {
        convention: doc.pullRequests?.title?.convention ?? "conventional",
        types: [...(doc.pullRequests?.title?.types ?? DEFAULT_PR_TYPES)],
        requireScope: doc.pullRequests?.title?.requireScope ?? false,
        maxLength: doc.pullRequests?.title?.maxLength ?? 72,
      },
      description: {
        minLength: doc.pullRequests?.description?.minLength ?? 20,
        requiredSections: [...(doc.pullRequests?.description?.requiredSections ?? [])],
        requireLinkedIssue: doc.pullRequests?.description?.requireLinkedIssue ?? false,
      },
      checks: {
        required: [...(doc.pullRequests?.checks?.required ?? [])],
        acceptedConclusions: [
          ...(doc.pullRequests?.checks?.acceptedConclusions ?? ["success", "neutral"]),
        ],
      },
      contributor: {
        ...(contributor?.allowedAuthorAssociations
          ? { allowedAuthorAssociations: [...contributor.allowedAuthorAssociations] }
          : {}),
        requireDcoSignoff: contributor?.requireDcoSignoff ?? false,
        requireVerifiedCommits: contributor?.requireVerifiedCommits ?? false,
      },
    },
    issues: {
      requireTemplate: doc.issues?.requireTemplate ?? false,
      requiredLabels: [...(doc.issues?.requiredLabels ?? [])],
      ...(doc.issues?.staleAfterDays === undefined
        ? {}
        : { staleAfterDays: doc.issues.staleAfterDays }),
    },
    release: {
      changelogPath: doc.release?.changelogPath ?? "CHANGELOG.md",
      requireUnreleasedSection: doc.release?.requireUnreleasedSection ?? false,
      requireChangelogEntry: doc.release?.requireChangelogEntry ?? false,
      versionFiles: [...(doc.release?.versionFiles ?? [])],
    },
    security: {
      requireDependencyAlerts: doc.security?.requireDependencyAlerts ?? false,
      requireSecretScanning: doc.security?.requireSecretScanning ?? false,
      requirePushProtection: doc.security?.requirePushProtection ?? false,
      requireBranchProtection: doc.security?.requireBranchProtection ?? false,
      requireSignedCommits: doc.security?.requireSignedCommits ?? false,
      minimumApprovals: doc.security?.minimumApprovals ?? 0,
    },
    ai: {
      enabled: doc.ai?.enabled ?? false,
      ...(doc.ai?.provider ? { provider: doc.ai.provider } : {}),
      ...(doc.ai?.model ? { model: doc.ai.model } : {}),
      capabilities: [...(doc.ai?.capabilities ?? [])],
      requireHumanApprovalFor: [...(doc.ai?.requireHumanApprovalFor ?? MUTATING_OPERATIONS)],
    },
    agents: {
      allowedOperations: [...(doc.agents?.allowedOperations ?? ["read"])],
      humanApprovalRequired: doc.agents?.humanApprovalRequired ?? true,
    },
    rules: normaliseRules(doc.rules),
  };
}

function normaliseRules(
  rules: Record<string, RuleOverride> | undefined,
): Record<string, RuleOverride> {
  if (!rules) return {};
  const result: Record<string, RuleOverride> = {};
  for (const [ruleId, override] of Object.entries(rules)) {
    result[ruleId] = {
      ...(override.enabled === undefined ? {} : { enabled: override.enabled }),
      ...(override.severity === undefined ? {} : { severity: override.severity }),
    };
  }
  return result;
}

/** True when the config permits a mutating agent operation (it never does by default). */
export function isOperationAllowed(config: ResolvedConfig, operation: string): boolean {
  return config.agents.allowedOperations.includes(operation as never);
}

/** True when a mutating operation requires recorded human approval under this config. */
export function requiresHumanApproval(config: ResolvedConfig, operation: string): boolean {
  if (!MUTATING_OPERATIONS.includes(operation as never)) return false;
  return (
    config.agents.humanApprovalRequired ||
    config.ai.requireHumanApprovalFor.includes(operation as never)
  );
}
