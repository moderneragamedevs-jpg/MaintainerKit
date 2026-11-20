import { singleLine, truncate } from "@maintainerkit/core";
import type { RuleDefinition, RuleResult } from "./types.js";

/** Removes HTML comments and collapses blank lines, so templates do not count as content. */
export function meaningfulBody(body: string | undefined): string {
  if (!body) return "";
  return body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

/**
 * Heading lookup without building a RegExp from user input: scans lines, so a hostile section name
 * cannot cause backtracking or escape problems.
 */
export function hasHeading(body: string, heading: string): boolean {
  const target = heading.trim().toLowerCase();
  if (target === "") return false;
  for (const line of body.split("\n")) {
    const match = /^(#{1,6})[ \t]+(.*)$/.exec(line.trimEnd());
    if (!match) continue;
    const text = (match[2] ?? "").trim().toLowerCase();
    if (text === target || text.startsWith(`${target} `) || text.startsWith(`${target}:`))
      return true;
  }
  return false;
}

const LINKED_ISSUE_PATTERN = /(?:^|[^\w#])#([1-9][0-9]{0,8})\b/;

export const prDescriptionRule: RuleDefinition = {
  id: "MK-PR-002",
  title: "Pull request description meets the configured requirements",
  description:
    "Checks body length (HTML comments ignored), required Markdown sections, and whether the description links an issue.",
  appliesTo: ["pull_request"],
  defaultSeverity: "error",
  policyPath: "/pullRequests/description",
  docsAnchor: "#mk-pr-002--pull-request-description",
  evaluate({ config, subject }) {
    const pullRequest = subject.pullRequest;
    if (!pullRequest) return { status: "skip", message: "No pull request snapshot was provided." };

    const policy = config.pullRequests.description;
    const body = meaningfulBody(pullRequest.body);
    const results: RuleResult[] = [];
    const evidence = [{ label: "description length", value: String(body.length) }];

    if (body.length < policy.minLength) {
      results.push({
        status: "fail",
        message:
          body.length === 0
            ? "The pull request has no description."
            : `The description is ${body.length} characters; at least ${policy.minLength} are required.`,
        evidence,
        remediation:
          "Explain what changed, why, and how it was verified. HTML comments do not count.",
      });
    }

    const missing = policy.requiredSections.filter((section) => !hasHeading(body, section));
    if (missing.length > 0) {
      results.push({
        status: "fail",
        message: `Missing required section(s): ${missing.join(", ")}.`,
        evidence: [
          ...evidence,
          { label: "required sections", value: truncate(policy.requiredSections.join(", "), 240) },
          { label: "missing", value: missing.join(", ") },
        ],
        remediation: `Add a "## ${missing[0]}" heading with content. Configuration: /pullRequests/description/requiredSections.`,
      });
    }

    if (policy.requireLinkedIssue) {
      const linked = new Set(pullRequest.linkedIssues ?? []);
      const detected = LINKED_ISSUE_PATTERN.exec(body)?.[1];
      if (linked.size === 0 && detected === undefined) {
        results.push({
          status: "fail",
          message: "The description does not reference an issue.",
          evidence: [
            ...evidence,
            { label: "body preview", value: truncate(singleLine(body), 120) },
          ],
          remediation: 'Reference the issue, e.g. "Closes #123", so the change can be traced.',
        });
      }
    }

    if (results.length === 0) {
      return {
        status: "pass",
        message: policy.requiredSections.length
          ? `Description satisfies all requirements (${policy.requiredSections.length} section(s) present).`
          : "Description satisfies the configured length requirement.",
        evidence,
      };
    }
    return results;
  },
};
