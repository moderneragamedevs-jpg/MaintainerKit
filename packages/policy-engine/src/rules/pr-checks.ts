import type { CheckRunSnapshot } from "@maintainerkit/core";
import type { RuleDefinition, RuleResult } from "./types.js";

/** GitHub check names are case-insensitive for human purposes; match on a normalised form. */
function normalise(name: string): string {
  return name.trim().toLowerCase();
}

/** Later entries win: GitHub can report several runs for the same name across pushes. */
export function latestChecks(checks: readonly CheckRunSnapshot[]): Map<string, CheckRunSnapshot> {
  const map = new Map<string, CheckRunSnapshot>();
  for (const check of checks) map.set(normalise(check.name), check);
  return map;
}

export const prChecksRule: RuleDefinition = {
  id: "MK-PR-003",
  title: "Required CI checks completed with an accepted conclusion",
  description:
    "Verifies that every configured required check exists, is completed, and concluded with one of the accepted conclusions (success/neutral/skipped).",
  appliesTo: ["pull_request"],
  defaultSeverity: "error",
  policyPath: "/pullRequests/checks",
  docsAnchor: "#mk-pr-003--required-ci-checks",
  evaluate({ config, subject }) {
    const pullRequest = subject.pullRequest;
    if (!pullRequest) return { status: "skip", message: "No pull request snapshot was provided." };

    const policy = config.pullRequests.checks;
    if (policy.required.length === 0) {
      return { status: "skip", message: "No required checks are configured." };
    }

    const byName = latestChecks(pullRequest.checks);
    const accepted = new Set(policy.acceptedConclusions);
    const results: RuleResult[] = [];

    for (const requiredName of policy.required) {
      const check = byName.get(normalise(requiredName));

      if (!check) {
        results.push({
          status: "fail",
          message: `Required check "${requiredName}" has not reported on this pull request.`,
          evidence: [
            { label: "required check", value: requiredName },
            {
              label: "reported checks",
              value: pullRequest.checks.map((entry) => entry.name).join(", ") || "(none)",
            },
          ],
          remediation:
            "Ensure the workflow that produces this check runs for pull requests, or correct the name in pullRequests.checks.required.",
        });
        continue;
      }

      if (check.status !== "completed") {
        results.push({
          status: "fail",
          message: `Required check "${requiredName}" is still ${check.status}.`,
          evidence: [
            { label: "required check", value: requiredName },
            { label: "status", value: check.status },
          ],
          remediation: "Wait for the check to finish, then re-run MaintainerKit.",
        });
        continue;
      }

      if (check.conclusion === undefined || !accepted.has(check.conclusion as never)) {
        results.push({
          status: "fail",
          message: `Required check "${requiredName}" concluded "${check.conclusion ?? "unknown"}".`,
          evidence: [
            { label: "required check", value: requiredName },
            { label: "conclusion", value: check.conclusion ?? "unknown" },
            { label: "accepted conclusions", value: policy.acceptedConclusions.join(", ") },
          ],
          remediation:
            "Fix the failing check. Skipped checks are only accepted when listed in acceptedConclusions.",
        });
      }
    }

    if (results.length === 0) {
      return {
        status: "pass",
        message: `All required checks passed (${policy.required.join(", ")}).`,
        evidence: [{ label: "required checks", value: policy.required.join(", ") }],
      };
    }
    return results;
  },
};
