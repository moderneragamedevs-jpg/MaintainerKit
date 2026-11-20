import type { RuleDefinition, RuleResult } from "./types.js";

export const prContributorRule: RuleDefinition = {
  id: "MK-PR-004",
  title: "Contributor requirements are satisfied",
  description:
    "Checks the author association allow-list, DCO sign-off trailers on every commit, and commit signature verification when configured.",
  appliesTo: ["pull_request"],
  defaultSeverity: "error",
  policyPath: "/pullRequests/contributor",
  docsAnchor: "#mk-pr-004--contributor-requirements",
  evaluate({ config, subject }) {
    const pullRequest = subject.pullRequest;
    if (!pullRequest) return { status: "skip", message: "No pull request snapshot was provided." };

    const policy = config.pullRequests.contributor;
    const configured =
      policy.allowedAuthorAssociations !== undefined ||
      policy.requireDcoSignoff ||
      policy.requireVerifiedCommits;

    if (!configured) {
      return {
        status: "skip",
        message: "No contributor requirements are configured.",
      };
    }

    const results: RuleResult[] = [];
    const baseEvidence = [
      { label: "author", value: pullRequest.author },
      { label: "author association", value: pullRequest.authorAssociation ?? "unknown" },
    ];

    if (policy.allowedAuthorAssociations !== undefined) {
      if (!pullRequest.authorAssociation || pullRequest.authorAssociation === "unknown") {
        results.push({
          status: "skip",
          message:
            "The provider did not report an author association, so the allow-list cannot be checked.",
          evidence: baseEvidence,
        });
      } else if (!policy.allowedAuthorAssociations.includes(pullRequest.authorAssociation)) {
        results.push({
          status: "fail",
          message: `Author association "${pullRequest.authorAssociation}" is not allowed.`,
          evidence: [
            ...baseEvidence,
            { label: "allowed", value: policy.allowedAuthorAssociations.join(", ") },
          ],
          remediation:
            "Either this contribution needs a maintainer to adopt it, or the allow-list in /pullRequests/contributor/allowedAuthorAssociations is too strict.",
        });
      }
    }

    if (policy.requireDcoSignoff) {
      if (pullRequest.commits.length === 0) {
        results.push({
          status: "skip",
          message: "No commit data was provided, so DCO sign-off cannot be checked.",
          evidence: baseEvidence,
        });
      } else {
        const unsigned = pullRequest.commits.filter((commit) => commit.signedOff !== true);
        if (unsigned.length > 0) {
          results.push({
            status: "fail",
            message: `${unsigned.length} of ${pullRequest.commits.length} commit(s) lack a Signed-off-by trailer.`,
            evidence: [
              ...baseEvidence,
              {
                label: "unsigned commits",
                value: unsigned.map((commit) => commit.sha.slice(0, 12)).join(", "),
              },
            ],
            remediation: "Run `git rebase --signoff` and use `git commit -s` for future commits.",
          });
        }
      }
    }

    if (policy.requireVerifiedCommits) {
      if (pullRequest.commits.length === 0) {
        results.push({
          status: "skip",
          message: "No commit data was provided, so signature verification cannot be checked.",
          evidence: baseEvidence,
        });
      } else {
        const unverified = pullRequest.commits.filter((commit) => commit.verified !== true);
        if (unverified.length > 0) {
          results.push({
            status: "fail",
            message: `${unverified.length} commit(s) are not verified.`,
            evidence: [
              ...baseEvidence,
              {
                label: "unverified commits",
                value: unverified.map((commit) => commit.sha.slice(0, 12)).join(", "),
              },
            ],
            remediation: "Sign commits with a configured key or enable web-based commit signing.",
          });
        }
      }
    }

    if (results.length === 0) {
      return {
        status: "pass",
        message: "Contributor requirements are satisfied.",
        evidence: baseEvidence,
      };
    }
    return results;
  },
};
