import {
  createFinding,
  findRepositoryFile,
  repositoryHasFile,
  truncate,
  type PolicyFinding,
  type RepositorySnapshot,
  type Severity,
} from "@maintainerkit/core";

/**
 * Repository health auditing.
 *
 * Rules of this module:
 * 1. Every check is documented (docs/AUDIT_CHECKS.md) with the exact condition it evaluates.
 * 2. There is no aggregated "health score". A number produced by weighting invented factors would
 *    look authoritative and mean nothing; the report states per-check status with evidence.
 * 3. Unobservable data yields `skip` with the reason, never `pass`.
 */
export interface AuditCheckContext {
  repository: RepositorySnapshot;
  now: string;
}

export interface AuditCheck {
  /** `MK-AUD-00N`. Stable: consumers may pin on these ids. */
  id: string;
  title: string;
  description: string;
  category: "documentation" | "ci" | "dependencies" | "security";
  defaultSeverity: Severity;
  /** Documents the exact pass condition, verbatim, in docs/AUDIT_CHECKS.md. */
  passCondition: string;
  evaluate(context: AuditCheckContext): Promise<PolicyFinding[]>;
}

const DOCS = "docs/AUDIT_CHECKS.md";

function finding(
  check: AuditCheck,
  status: PolicyFinding["status"],
  message: string,
  extra: {
    evidence?: PolicyFinding["evidence"];
    remediation?: string;
    severity?: Severity;
  } = {},
): PolicyFinding {
  return createFinding({
    id: `${check.id}:repository`,
    ruleId: check.id,
    ruleTitle: check.title,
    status,
    severity: extra.severity ?? check.defaultSeverity,
    message,
    evidence: extra.evidence ?? [],
    ...(extra.remediation ? { remediation: extra.remediation } : {}),
    policyPath: "docs/AUDIT_CHECKS.md",
    docsUrl: `${DOCS}#${check.id.toLowerCase()}`,
    subjectKind: "repository",
  });
}

async function readOptional(
  repository: RepositorySnapshot,
  path: string,
): Promise<{ present: boolean; content: string | null; path: string }> {
  const match = findRepositoryFile(repository.files, path);
  const present = repositoryHasFile(repository, path);
  if (!present) return { present: false, content: null, path };
  const content = repository.readFile ? await repository.readFile(match?.path ?? path) : null;
  return { present: true, content, path: match?.path ?? path };
}

const MIN_README_CHARS = 200;

function documentationCheck(config: {
  id: string;
  title: string;
  description: string;
  path: string;
  severity: Severity;
  minChars?: number;
  passCondition: string;
  remediation: string;
}): AuditCheck {
  return {
    id: config.id,
    title: config.title,
    description: config.description,
    category: "documentation",
    defaultSeverity: config.severity,
    passCondition: config.passCondition,
    async evaluate({ repository }) {
      const result = await readOptional(repository, config.path);
      if (!result.present) {
        return [
          finding(this, "fail", `${config.path} is missing.`, {
            evidence: [{ label: "expected path", value: config.path }],
            remediation: config.remediation,
          }),
        ];
      }

      const minChars = config.minChars ?? 0;
      if (result.content !== null && minChars > 0) {
        const length = result.content.trim().length;
        if (length < minChars) {
          return [
            finding(
              this,
              "fail",
              `${result.path} has ${length} characters; at least ${minChars} are expected.`,
              {
                evidence: [
                  { label: "file", value: result.path },
                  { label: "characters", value: String(length) },
                ],
                remediation: "Expand the document so it explains the project, not just its name.",
              },
            ),
          ];
        }
      }

      return [
        finding(this, "pass", `Found ${result.path}.`, {
          evidence: [
            { label: "file", value: result.path },
            ...(result.content === null
              ? [{ label: "content", value: "not inspected by this source" }]
              : []),
          ],
        }),
      ];
    },
  };
}

export const readmeCheck: AuditCheck = documentationCheck({
  id: "MK-AUD-001",
  title: "README explains the project",
  description: "The repository has a README.md with substantive content.",
  path: "README.md",
  severity: "error",
  minChars: MIN_README_CHARS,
  passCondition: `README.md exists and, when file contents are readable, contains at least ${MIN_README_CHARS} non-whitespace characters.`,
  remediation:
    "Add a README.md that states what the project does, how to install it, and how to use it.",
});

const LICENSE_MARKERS: readonly { spdx: string; needles: string[] }[] = [
  { spdx: "Apache-2.0", needles: ["Apache License", "Version 2.0"] },
  { spdx: "MIT", needles: ["MIT License", "Permission is hereby granted, free of charge"] },
  {
    spdx: "BSD-3-Clause",
    needles: ["BSD 3-Clause", "Redistribution and use in source and binary forms"],
  },
  { spdx: "GPL-3.0", needles: ["GNU GENERAL PUBLIC LICENSE", "Version 3"] },
  { spdx: "MPL-2.0", needles: ["Mozilla Public License Version 2.0"] },
];

export const licenseCheck: AuditCheck = {
  id: "MK-AUD-002",
  title: "License is present and identifiable",
  description: "The repository declares a license, either via provider metadata or a LICENSE file.",
  category: "documentation",
  defaultSeverity: "error",
  passCondition:
    "A LICENSE/LICENCE/COPYING file exists, or the provider reports an SPDX license id. When contents are readable, a known license family is identified.",
  async evaluate({ repository }) {
    const declared = repository.metadata.licenseSpdx;
    const candidates = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "COPYING"];
    let found: { path: string; content: string | null } | undefined;
    for (const candidate of candidates) {
      const result = await readOptional(repository, candidate);
      if (result.present) {
        found = { path: result.path, content: result.content };
        break;
      }
    }

    if (!found && !declared) {
      return [
        finding(this, "fail", "No license file and no license reported by the provider.", {
          evidence: [{ label: "checked", value: candidates.join(", ") }],
          remediation: "Add a LICENSE file. Without one, the code is not legally usable by others.",
        }),
      ];
    }

    const detected = found?.content
      ? LICENSE_MARKERS.find((marker) =>
          marker.needles.every((needle) => found?.content?.includes(needle)),
        )
      : undefined;

    if (found?.content && !detected && !declared) {
      return [
        finding(this, "fail", `${found.path} exists but its license could not be identified.`, {
          evidence: [{ label: "file", value: found.path }],
          remediation: "Use a standard license text so tooling and consumers can identify it.",
        }),
      ];
    }

    const spdx = declared ?? detected?.spdx;
    return [
      finding(
        this,
        "pass",
        spdx ? `License identified as ${spdx}.` : `Found ${found?.path ?? "license metadata"}.`,
        {
          evidence: [
            ...(found ? [{ label: "file", value: found.path }] : []),
            ...(spdx ? [{ label: "spdx", value: spdx }] : []),
            ...(found?.content === undefined && found
              ? [{ label: "content", value: "not inspected by this source" }]
              : []),
          ],
        },
      ),
    ];
  },
};

export const contributingCheck: AuditCheck = documentationCheck({
  id: "MK-AUD-003",
  title: "Contribution guide exists",
  description: "CONTRIBUTING.md tells new contributors how to set up and submit changes.",
  path: "CONTRIBUTING.md",
  severity: "warning",
  passCondition: "CONTRIBUTING.md exists (any content).",
  remediation: "Add CONTRIBUTING.md with setup, test, and review expectations.",
});

export const securityPolicyCheck: AuditCheck = documentationCheck({
  id: "MK-AUD-004",
  title: "Security policy exists",
  description: "SECURITY.md explains how to report a vulnerability privately.",
  path: "SECURITY.md",
  severity: "error",
  passCondition: "SECURITY.md exists (any content).",
  remediation: "Add SECURITY.md with a private reporting channel and supported versions.",
});

export const codeOfConductCheck: AuditCheck = documentationCheck({
  id: "MK-AUD-005",
  title: "Code of conduct exists",
  description: "CODE_OF_CONDUCT.md states community expectations and an enforcement contact.",
  path: "CODE_OF_CONDUCT.md",
  severity: "warning",
  passCondition: "CODE_OF_CONDUCT.md exists (any content).",
  remediation: "Adopt a code of conduct (e.g. Contributor Covenant) and name a contact.",
});

const WORKFLOW_PATTERN = /^\.github\/workflows\/[^/]+\.ya?ml$/i;

export const ciCheck: AuditCheck = {
  id: "MK-AUD-006",
  title: "Continuous integration is configured",
  description: "At least one GitHub Actions workflow exists and declares a trigger.",
  category: "ci",
  defaultSeverity: "error",
  passCondition:
    "At least one `.github/workflows/*.yml|yaml` file exists. When contents are readable, one workflow must declare a trigger (`on:`).",
  async evaluate({ repository }) {
    const workflows = repository.files.filter((file) => WORKFLOW_PATTERN.test(file.path));
    if (workflows.length === 0) {
      return [
        finding(this, "fail", "No GitHub Actions workflow was found.", {
          evidence: [{ label: "searched", value: ".github/workflows/*.{yml,yaml}" }],
          remediation: "Add a workflow that builds and tests the project on pull requests.",
        }),
      ];
    }

    if (!repository.readFile) {
      return [
        finding(this, "pass", `Found ${workflows.length} workflow file(s).`, {
          evidence: [{ label: "workflows", value: workflows.map((file) => file.path).join(", ") }],
        }),
      ];
    }

    const withoutTrigger: string[] = [];
    let inspected = 0;
    for (const workflow of workflows) {
      const content = await repository.readFile(workflow.path);
      if (content === null) continue;
      inspected += 1;
      // A trigger is a top-level `on:` key (quoted forms included).
      if (!/^["']?on["']?:/m.test(content)) withoutTrigger.push(workflow.path);
    }

    if (inspected === 0) {
      return [
        finding(this, "skip", "Workflow files exist but their contents could not be read.", {
          evidence: [{ label: "workflows", value: workflows.map((file) => file.path).join(", ") }],
        }),
      ];
    }

    if (withoutTrigger.length === workflows.length) {
      return [
        finding(this, "fail", "No workflow declares a trigger.", {
          evidence: [{ label: "inspected", value: String(inspected) }],
          remediation: "Add an `on:` block so the workflow runs on push or pull_request.",
        }),
      ];
    }

    return [
      finding(this, "pass", `Found ${workflows.length} workflow file(s) with triggers.`, {
        evidence: [{ label: "workflows", value: workflows.map((file) => file.path).join(", ") }],
      }),
    ];
  },
};

const DEPENDENCY_AUTOMATION = [
  "renovate.json",
  ".github/renovate.json",
  ".renovaterc",
  "dependabot.yml",
  ".github/dependabot.yml",
];
const LOCKFILES = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "Cargo.lock",
  "poetry.lock",
  "go.sum",
  "composer.lock",
];

export const dependencyCheck: AuditCheck = {
  id: "MK-AUD-007",
  title: "Dependency updates are configured",
  description: "The repository pins dependencies and enables automated update tooling or alerts.",
  category: "dependencies",
  defaultSeverity: "warning",
  passCondition: `Either a dependency automation config (${DEPENDENCY_AUTOMATION.join(", ")}) or provider dependency alerts are enabled. A lockfile is reported as evidence, not as a requirement for non-package repositories.`,
  async evaluate({ repository }) {
    const automation = DEPENDENCY_AUTOMATION.find((path) => repositoryHasFile(repository, path));
    const lockfile = LOCKFILES.find((path) => repositoryHasFile(repository, path));
    const alerts = repository.security?.dependencyAlerts;

    if (automation || alerts === true) {
      return [
        finding(
          this,
          "pass",
          automation
            ? `Dependency automation configured (${automation}).`
            : "Dependency alerts are enabled.",
          {
            evidence: [
              ...(automation ? [{ label: "automation", value: automation }] : []),
              ...(lockfile ? [{ label: "lockfile", value: lockfile }] : []),
              ...(alerts === true ? [{ label: "alerts", value: "enabled" }] : []),
            ],
          },
        ),
      ];
    }

    if (alerts === "unknown" || alerts === undefined) {
      return [
        finding(
          this,
          "fail",
          "No dependency automation config was found and alerts state is unknown.",
          {
            evidence: [
              { label: "checked", value: DEPENDENCY_AUTOMATION.join(", ") },
              ...(lockfile ? [{ label: "lockfile", value: lockfile }] : []),
            ],
            remediation:
              "Add .github/dependabot.yml or renovate.json and enable dependency alerts.",
          },
        ),
      ];
    }

    return [
      finding(this, "fail", "Dependency alerts are disabled and no automation config exists.", {
        evidence: [
          { label: "alerts", value: "disabled" },
          { label: "checked", value: DEPENDENCY_AUTOMATION.join(", ") },
        ],
        remediation: "Enable Dependabot alerts, or commit .github/dependabot.yml.",
      }),
    ];
  },
};

export const securitySettingsCheck: AuditCheck = {
  id: "MK-AUD-008",
  title: "GitHub security features are enabled",
  description:
    "Secret scanning and dependency alerts are enabled where the provider can report them.",
  category: "security",
  defaultSeverity: "error",
  passCondition:
    "When the provider reports security posture: secret scanning, dependency alerts, and push protection are all enabled. When posture is unavailable, the check is skipped with that reason.",
  async evaluate({ repository }) {
    const posture = repository.security;
    if (!posture) {
      return [
        finding(
          this,
          "skip",
          "The repository source cannot report GitHub security settings (use --repo with a token to audit these).",
          {
            evidence: [{ label: "provider", value: repository.ref.provider }],
          },
        ),
      ];
    }

    const flags: {
      key: "secretScanning" | "dependencyAlerts" | "pushProtection";
      label: string;
    }[] = [
      { key: "secretScanning", label: "secret scanning" },
      { key: "dependencyAlerts", label: "dependency alerts" },
      { key: "pushProtection", label: "push protection" },
    ];

    const unknown = flags.filter(
      (flag) => posture[flag.key] === undefined || posture[flag.key] === "unknown",
    );
    const disabled = flags.filter((flag) => posture[flag.key] === false);

    if (disabled.length > 0) {
      return [
        finding(this, "fail", `Disabled: ${disabled.map((flag) => flag.label).join(", ")}.`, {
          evidence: disabled.map((flag) => ({ label: flag.label, value: "disabled" })),
          remediation: "Enable these features in the repository's code security settings.",
        }),
      ];
    }

    if (unknown.length === flags.length) {
      return [
        finding(this, "skip", "Security posture was reported as unknown for every control.", {
          evidence: flags.map((flag) => ({ label: flag.label, value: "unknown" })),
        }),
      ];
    }

    return [
      finding(this, "pass", "Reported security features are enabled.", {
        evidence: flags.map((flag) => ({
          label: flag.label,
          value: String(posture[flag.key] ?? "unknown"),
        })),
      }),
    ];
  },
};

export const branchProtectionCheck: AuditCheck = {
  id: "MK-AUD-009",
  title: "Default branch is protected",
  description: "Branch protection and required approvals are configured for the default branch.",
  category: "security",
  defaultSeverity: "error",
  passCondition:
    "When the provider reports branch protection: protection is enabled and at least one approving review is required. When unavailable, the check is skipped with that reason.",
  async evaluate({ repository }) {
    const posture = repository.security;
    if (
      !posture ||
      posture.branchProtection === undefined ||
      posture.branchProtection === "unknown"
    ) {
      return [
        finding(this, "skip", "Branch protection information is not available from this source.", {
          evidence: [{ label: "provider", value: repository.ref.provider }],
        }),
      ];
    }

    if (posture.branchProtection === false) {
      return [
        finding(this, "fail", "The default branch is not protected.", {
          evidence: [{ label: "branch protection", value: "disabled" }],
          remediation: "Require pull requests, reviews, and passing checks on the default branch.",
        }),
      ];
    }

    const approvals = posture.requiredApprovals;
    if (typeof approvals === "number" && approvals < 1) {
      return [
        finding(this, "fail", "Branch protection requires no approving reviews.", {
          evidence: [{ label: "required approvals", value: "0" }],
          remediation: "Require at least one approving review.",
        }),
      ];
    }

    return [
      finding(this, "pass", "The default branch is protected.", {
        evidence: [
          { label: "branch protection", value: "enabled" },
          {
            label: "required approvals",
            value: typeof approvals === "number" ? String(approvals) : "unknown",
          },
        ],
      }),
    ];
  },
};

export const AUDIT_CHECKS: readonly AuditCheck[] = [
  readmeCheck,
  licenseCheck,
  contributingCheck,
  securityPolicyCheck,
  codeOfConductCheck,
  ciCheck,
  dependencyCheck,
  securitySettingsCheck,
  branchProtectionCheck,
] as const;

export interface RepositoryAuditResult {
  findings: PolicyFinding[];
  evaluatedCheckIds: string[];
  /** Pass/fail derived from error-severity failures only (see docs/AUDIT_CHECKS.md). */
  status: "pass" | "fail";
  counts: { total: number; pass: number; fail: number; skip: number };
}

export interface AuditOptions {
  now?: Date;
  checks?: readonly AuditCheck[];
}

/**
 * Runs all health checks. A check that throws becomes an `error` finding: an audit must never claim
 * health when it failed to complete.
 */
export async function auditRepository(
  repository: RepositorySnapshot,
  options: AuditOptions = {},
): Promise<RepositoryAuditResult> {
  const checks = options.checks ?? AUDIT_CHECKS;
  const now = (options.now ?? new Date()).toISOString();
  const findings: PolicyFinding[] = [];

  for (const check of checks) {
    try {
      const result = await check.evaluate({ repository, now });
      findings.push(...result);
    } catch (error) {
      findings.push(
        finding(
          check,
          "error",
          `Check failed to run: ${error instanceof Error ? error.message : String(error)}`,
          {
            severity: "error",
            remediation: "This is a MaintainerKit bug; please report it.",
          },
        ),
      );
    }
  }

  const counts = {
    total: findings.length,
    pass: findings.filter((entry) => entry.status === "pass").length,
    fail: findings.filter((entry) => entry.status === "fail").length,
    skip: findings.filter((entry) => entry.status === "skip").length,
  };

  const status = findings.some(
    (entry) => (entry.status === "fail" || entry.status === "error") && entry.severity === "error",
  )
    ? "fail"
    : "pass";

  return {
    findings,
    evaluatedCheckIds: checks.map((check) => check.id),
    status,
    counts,
  };
}

/** Evidence helper used by report renderers. */
export function evidenceSummary(findingItem: PolicyFinding, limit = 3): string {
  return findingItem.evidence
    .slice(0, limit)
    .map((entry) => `${entry.label}: ${truncate(entry.value, 80)}`)
    .join("; ");
}
