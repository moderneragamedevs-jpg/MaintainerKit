import { prChecksRule } from "./pr-checks.js";
import { prContributorRule } from "./pr-contributor.js";
import { prDescriptionRule } from "./pr-description.js";
import { prTitleRule } from "./pr-title.js";
import { repositoryFilesRule } from "./repo-files.js";
import { releaseReadinessRule } from "./release-readiness.js";
import { repositorySecurityRule } from "./repo-security.js";
import type { RuleDefinition } from "./types.js";

/**
 * The built-in rule catalog, in reporting order.
 *
 * Ids are stable (see docs/POLICY_RULES.md). Adding a rule is additive; renaming or removing one
 * breaks existing `rules:` overrides and is treated as a breaking change.
 */
export const BUILT_IN_RULES: readonly RuleDefinition[] = [
  repositoryFilesRule,
  repositorySecurityRule,
  prTitleRule,
  prDescriptionRule,
  prChecksRule,
  prContributorRule,
  releaseReadinessRule,
] as const;
