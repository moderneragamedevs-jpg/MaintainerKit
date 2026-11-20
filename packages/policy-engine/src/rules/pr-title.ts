import { singleLine } from "@maintainerkit/core";
import type { RuleDefinition, RuleResult } from "./types.js";
import { formatAllowedTypes, parseConventionalTitle, suggestType } from "./conventional.js";

export const prTitleRule: RuleDefinition = {
  id: "MK-PR-001",
  title: "Pull request title follows the configured convention",
  description:
    "Validates the PR title against Conventional Commits (type, optional scope, optional breaking marker) and the configured type list and length limit.",
  appliesTo: ["pull_request"],
  defaultSeverity: "error",
  policyPath: "/pullRequests/title",
  docsAnchor: "#mk-pr-001--pull-request-title",
  evaluate({ config, subject }) {
    const policy = config.pullRequests.title;
    const pullRequest = subject.pullRequest;
    if (!pullRequest) {
      return { status: "skip", message: "No pull request snapshot was provided." };
    }

    const title = pullRequest.title ?? "";
    const evidence = [{ label: "title", value: singleLine(title) }];

    if (policy.convention === "none") {
      return {
        status: "skip",
        message: "Title convention checks are disabled (convention: none).",
      };
    }

    const parsed = parseConventionalTitle(title);
    const results: RuleResult[] = [];

    if (!parsed) {
      results.push({
        status: "fail" as const,
        message: `Title "${singleLine(title)}" is not a Conventional Commits title.`,
        evidence,
        remediation: `Use "<type>(<scope>): <subject>" with a type from: ${formatAllowedTypes(policy.types)}.`,
      });
      return results;
    }

    evidence.push({ label: "parsed type", value: parsed.type });

    if (!policy.types.includes(parsed.type)) {
      const suggestion = suggestType(parsed.type, policy.types);
      results.push({
        status: "fail" as const,
        message: `Title type "${parsed.type}" is not in the allowed list.`,
        evidence: [
          ...evidence,
          { label: "allowed types", value: formatAllowedTypes(policy.types) },
        ],
        remediation: suggestion
          ? `Did you mean "${suggestion}"? Allowed types: ${formatAllowedTypes(policy.types)}.`
          : `Allowed types: ${formatAllowedTypes(policy.types)}.`,
      });
    }

    if (policy.requireScope && parsed.scope === undefined) {
      results.push({
        status: "fail" as const,
        message: 'Title is missing a required scope, e.g. "feat(api): ...".',
        evidence,
        remediation:
          "Add a scope in parentheses after the type. Configuration: /pullRequests/title/requireScope.",
      });
    }

    if (title.length > policy.maxLength) {
      results.push({
        status: "fail" as const,
        message: `Title is ${title.length} characters; the configured maximum is ${policy.maxLength}.`,
        evidence: [...evidence, { label: "length", value: String(title.length) }],
        remediation: "Shorten the title and move detail into the description.",
      });
    }

    if (results.length === 0) {
      return {
        status: "pass",
        message: `Title follows the convention: type "${parsed.type}"${parsed.scope ? `, scope "${parsed.scope}"` : ""}.`,
        evidence,
      };
    }
    return results;
  },
};
