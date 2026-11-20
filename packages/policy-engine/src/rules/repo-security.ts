import type { SecurityPosture } from "@maintainerkit/core";
import type { RuleDefinition, RuleResult } from "./types.js";

type PostureFlag = keyof SecurityPosture;

interface Requirement {
  flag: PostureFlag;
  label: string;
  remediation: string;
}

const FLAG_REQUIREMENTS: Requirement[] = [
  {
    flag: "dependencyAlerts",
    label: "dependency vulnerability alerts",
    remediation: "Enable Dependabot alerts in repository settings (Settings → Code security).",
  },
  {
    flag: "secretScanning",
    label: "secret scanning",
    remediation: "Enable secret scanning and push protection in repository settings.",
  },
  {
    flag: "pushProtection",
    label: "secret scanning push protection",
    remediation: "Enable push protection so secrets are blocked before they land.",
  },
  {
    flag: "branchProtection",
    label: "default branch protection",
    remediation: "Protect the default branch with required reviews and status checks.",
  },
  {
    flag: "signedCommitsRequired",
    label: "required commit signatures",
    remediation: "Require signed commits on the protected branch.",
  },
];

export const repositorySecurityRule: RuleDefinition = {
  id: "MK-SEC-001",
  title: "Repository security configuration is enabled",
  description:
    "Verifies the configured security posture flags (dependency alerts, secret scanning, push protection, branch protection, signed commits) and the minimum required approvals.",
  appliesTo: ["repository", "pull_request"],
  defaultSeverity: "error",
  policyPath: "/security",
  docsAnchor: "#mk-sec-001--repository-security-configuration",
  evaluate({ config, subject }) {
    const policy = config.security;
    const posture = subject.repository.security;
    const results: RuleResult[] = [];

    const configuredFlags = FLAG_REQUIREMENTS.filter((requirement) => {
      const key = `require${requirement.flag.charAt(0).toUpperCase()}${requirement.flag.slice(1)}`;
      return policy[key as keyof typeof policy] === true;
    });

    if (configuredFlags.length === 0 && policy.minimumApprovals === 0) {
      return { status: "skip", message: "No security requirements are configured." };
    }

    if (!posture) {
      return {
        status: "skip",
        message:
          "The repository source reported no security posture. Local checkouts cannot observe GitHub security settings; run this check against the GitHub API (--repo owner/name).",
      };
    }

    for (const requirement of configuredFlags) {
      const value = posture[requirement.flag];
      if (value === undefined || value === "unknown") {
        results.push({
          status: "skip",
          message: `Could not determine whether ${requirement.label} is enabled.`,
          evidence: [{ label: "requirement", value: requirement.label }],
        });
      } else if (value === false) {
        results.push({
          status: "fail",
          message: `${requirement.label} is not enabled.`,
          evidence: [
            { label: "requirement", value: requirement.label },
            { label: "observed", value: "disabled" },
          ],
          remediation: requirement.remediation,
        });
      } else {
        results.push({
          status: "pass",
          message: `${requirement.label} is enabled.`,
          evidence: [{ label: "requirement", value: requirement.label }],
        });
      }
    }

    if (policy.minimumApprovals > 0) {
      const approvals = posture.requiredApprovals;
      if (approvals === undefined || approvals === "unknown") {
        results.push({
          status: "skip",
          message: "Could not determine the required approval count for the default branch.",
          evidence: [{ label: "configured minimum", value: String(policy.minimumApprovals) }],
        });
      } else if (approvals < policy.minimumApprovals) {
        results.push({
          status: "fail",
          message: `Branch protection requires ${approvals} approval(s); ${policy.minimumApprovals} are required by policy.`,
          evidence: [
            { label: "observed", value: String(approvals) },
            { label: "configured", value: String(policy.minimumApprovals) },
          ],
          remediation: "Raise the required approving review count in branch protection settings.",
        });
      } else {
        results.push({
          status: "pass",
          message: `Branch protection requires ${approvals} approval(s), meeting the configured minimum.`,
          evidence: [{ label: "observed", value: String(approvals) }],
        });
      }
    }

    if (results.length === 0) {
      return { status: "skip", message: "No security requirements produced a result." };
    }
    return results;
  },
};
