/**
 * Templates produced by `maintainerkit init`.
 *
 * Kept as plain strings (not YAML serialisation) so the generated file keeps its comments: a policy
 * document that explains itself is far more likely to be edited correctly.
 */

export interface InitTemplateOptions {
  strict?: boolean;
}

export function contribSpecTemplate(options: InitTemplateOptions = {}): string {
  const strict = options.strict === true;
  return `# MaintainerKit policy document (ContribSpec ${"1.0"})
# Validated against schemas/contribspec-1.0.schema.json.
# Docs: docs/CONTRIBSPEC.md
specVersion: "1.0"

repository:
  requiredFiles:
    - path: README.md
      description: What the project is and how to use it.
    - path: LICENSE
      description: License text.
    - path: CONTRIBUTING.md
      description: How to set up, test, and submit changes.
    - path: SECURITY.md
      description: How to report a vulnerability privately.

pullRequests:
  title:
    convention: conventional
    maxLength: 72
  description:
    minLength: 30
    requiredSections:
      - Summary
      - Testing
  checks:
    # Names must match the checks your CI reports, e.g. "ci / test".
    required: []
    acceptedConclusions: [success, neutral]
  contributor:${strict ? "\n    requireDcoSignoff: true" : " {}"}

issues:
  requireTemplate: ${strict ? "true" : "false"}

release:
  changelogPath: CHANGELOG.md
  requireUnreleasedSection: false
  requireChangelogEntry: false

security:
  # These checks need GitHub API access (--repo owner/name) to observe real values.
  requireDependencyAlerts: ${strict ? "true" : "false"}
  requireSecretScanning: ${strict ? "true" : "false"}
  requireBranchProtection: ${strict ? "true" : "false"}
  minimumApprovals: ${strict ? "1" : "0"}

ai:
  # AI is optional and advisory only. MaintainerKit works fully without it.
  enabled: false
  capabilities: []

agents:
  # Read-only by default. Mutating operations require explicit configuration and human approval.
  allowedOperations: [read]
  humanApprovalRequired: true
`;
}

export function workflowTemplate(options: { name?: string } = {}): string {
  const name = options.name ?? "MaintainerKit";
  return `# MaintainerKit policy check — read-only.
#
# Security notes:
# - runs on \`pull_request\` (never \`pull_request_target\`), so no untrusted code executes
# - permissions are minimal: metadata read for context, contents read for repository files
# - no secrets are required; the GITHUB_TOKEN below is provided by GitHub
# - this workflow cannot merge, close, label, or comment
name: ${name}

on:
  pull_request:
    types: [opened, edited, synchronize, reopened, ready_for_review]

permissions:
  contents: read

jobs:
  policy-check:
    name: Policy check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          # Only repository metadata is read; no builds or scripts from the PR are executed.
          persist-credentials: false
      - name: Validate ContribSpec
        run: npx --yes @maintainerkit/cli@latest validate --config maintainerkit.yml
      - name: Evaluate policies
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          npx --yes @maintainerkit/cli@latest check \\
            --repo "\${{ github.repository }}" \\
            --pr "\${{ github.event.pull_request.number }}" \\
            --config maintainerkit.yml
`;
}
