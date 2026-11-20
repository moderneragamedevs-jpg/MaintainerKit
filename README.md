# MaintainerKit

**Repository governance and maintenance, written down and checkable.**

MaintainerKit is an open-source platform for teams that maintain software repositories. It gives you a
versioned policy document (**ContribSpec**), a deterministic engine that evaluates it, a repository
health auditor, a CLI, a GitHub Action, and an optional AI layer that is advisory only.

- **Deterministic first.** Every pass/fail comes from a documented rule with evidence and a remediation.
- **AI is optional.** No API key is required; nothing degrades when AI is off.
- **Read-only by default.** The one write operation (publishing a check run) needs an explicit gate.
- **Provider-independent.** The policy engine knows nothing about GitHub, or about any AI vendor.

```bash
# From a clone (packages are not published yet — see "Installation"):
pnpm install && pnpm build
node packages/interfaces/cli/dist/bin.js init
node packages/interfaces/cli/dist/bin.js validate
node packages/interfaces/cli/dist/bin.js audit
node packages/interfaces/cli/dist/bin.js check --path .
```

## What it does

| Command                  | Purpose                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `maintainerkit init`     | Write a commented ContribSpec document and a read-only CI workflow                  |
| `maintainerkit validate` | Schema + semantic validation with JSON Pointer locations                            |
| `maintainerkit doctor`   | Environment diagnostics: runtime, config, git, token presence, AI, write gate       |
| `maintainerkit audit`    | Nine documented repository health checks; works without a policy document           |
| `maintainerkit check`    | Evaluate policies for a repository or pull request                                  |
| `maintainerkit report`   | Re-render a saved report, or summarise a JSONL audit trail                          |
| `maintainerkit explain`  | Explain a rule, a finding, exit codes, the report format, AI, or the security model |

Example of the output you get when something fails:

```text
Findings requiring attention (1)
  [FAIL error] MK-PR-001  Title "Update stuff" is not a Conventional Commits title.
      title: Update stuff
      fix:
    Use "<type>(<scope>): <subject>" with a type from: feat, fix, docs, ...
      docs: docs/POLICY_RULES.md#mk-pr-001--pull-request-title
```

## ContribSpec

One YAML file, validated against a published JSON Schema, with a fixed set of rules:

```yaml
specVersion: "1.0"

repository:
  requiredFiles: [README.md, LICENSE, CONTRIBUTING.md, SECURITY.md]

pullRequests:
  title:
    convention: conventional
    maxLength: 72
  description:
    minLength: 30
    requiredSections: [Summary, Testing]
  checks:
    required: [verify]
  contributor:
    requireDcoSignoff: true

security:
  requireDependencyAlerts: true
  requireBranchProtection: true
  minimumApprovals: 1

ai:
  enabled: false # AI is optional; policy checks never depend on it
  capabilities: []
```

Full reference: [docs/CONTRIBSPEC.md](docs/CONTRIBSPEC.md) · Rules: [docs/POLICY_RULES.md](docs/POLICY_RULES.md)

## Security posture

- Analysis is API-and-file based; **no code from a pull request is executed**.
- The GitHub Action runs on `pull_request`, **never** `pull_request_target`.
- Token permissions are minimal (`contents: read` by default).
- No automatic merge, close, label, or comment. Publishing a check run requires
  `checks: write` _and_ `MAINTAINERKIT_ALLOW_WRITE=true`.
- Secrets are redacted at every sink, including reports written to disk.
- AI output is validated against a closed JSON Schema and can never change a policy verdict.

Read [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) and [SECURITY.md](SECURITY.md).

## Installation

**Package name notice.** The npm name `maintainerkit` is owned by an unrelated project. MaintainerKit
publishes under the `@maintainerkit/*` scope (CLI binary name: `maintainerkit`), and **no package has
been published yet**. See [docs/adr/0001-project-naming.md](docs/adr/0001-project-naming.md).

Until publication is authorized:

```bash
pnpm install
pnpm build
node packages/interfaces/cli/dist/bin.js --help
```

## Repository layout

```text
packages/core                 provider-neutral contracts, reports, errors
packages/contribspec          ContribSpec 1.0 schema, loader, validation, migration
packages/policy-engine        7 deterministic rules + registry
packages/audit                audit events, redaction, 9 health checks
packages/workflow-engine      orchestration and report rendering
packages/integrations/git     local working tree adapter
packages/integrations/github  Octokit read adapter + gated check publishing
packages/ai/{core,providers,prompts,advisor}
packages/interfaces/{cli,sdk,github-action}
schemas/                      published JSON Schema
docs/                         specification, rules, CLI, AI, security, ADRs
examples/                     runnable example policies
tests/                        architecture, security, and end-to-end suites
```

Architecture and boundaries: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Development

```bash
pnpm install          # install workspace dependencies
pnpm build            # build every package (Turborepo)
pnpm test             # 350+ unit, contract, and integration tests
pnpm verify           # build + typecheck + lint + format + tests
```

CI runs the same commands. See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Project status

Pre-release (`0.1.0`), greenfield, developed in the open. ContribSpec is a MaintainerKit specification,
not an industry standard: it has one implementation and no independent adoption yet.

- Changelog: [CHANGELOG.md](CHANGELOG.md)
- Documentation index: [docs/README.md](docs/README.md)
- Implementation status: [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md)
- Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md)
- Governance: [GOVERNANCE.md](GOVERNANCE.md)

## License

Apache-2.0. See [LICENSE](LICENSE).
