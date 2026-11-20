# ContribSpec 1.0 — specification and field reference

ContribSpec is MaintainerKit's repository policy document: YAML, validated against a JSON Schema, and
evaluated by the deterministic policy engine.

- Schema: [`schemas/contribspec-1.0.schema.json`](../schemas/contribspec-1.0.schema.json)
  (`$id: urn:maintainerkit:contribspec:1.0`, JSON Schema draft 2020-12)
- Reference implementation: `@maintainerkit/contribspec`
- Rule catalogue: [POLICY_RULES.md](POLICY_RULES.md)

ContribSpec is **not** an industry standard. It is a MaintainerKit specification with one
implementation and a public change process ([GOVERNANCE.md](../GOVERNANCE.md)).

## Validation layers

A document must pass three layers, in order. Each layer reports machine-readable codes.

| Layer     | What it checks                                                 | Example codes                                                                                                                   |
| --------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Syntax    | YAML parses, no duplicate keys, size under 256 KiB             | `contribspec/invalid-yaml`, `contribspec/empty-document`                                                                        |
| Schema    | Only known keys, correct types, bounds, enums                  | `contribspec/schema.additionalProperties`, `contribspec/schema.minimum`                                                         |
| Semantics | Cross-field invariants, path safety, rule references, versions | `contribspec/unsupported-version`, `contribspec/ai-without-capabilities`, `contribspec/unsafe-path`, `contribspec/unknown-rule` |

Rules:

- **Unknown keys are rejected.** A typo like `titel:` fails instead of being silently ignored.
- **Paths are repository-relative.** `..`, `~/`, absolute paths, and drive letters are rejected.
- **Errors gate evaluation.** Any error stops the run with exit code 2. Warnings do not.
- **`skip` is not `pass`.** Values the provider cannot observe (for example GitHub security settings
  from a local checkout) produce `skip` with a reason.

## Top-level structure

```yaml
specVersion: "1.0" # required
$schema: "…" # optional editor hint

metadata: { … }
repository: { … }
pullRequests: { … }
issues: { … }
release: { … }
security: { … }
ai: { … }
agents: { … }
rules: { … }
```

Every section is optional except `specVersion`. Omitted values use documented defaults; a default is
chosen so that an empty section never creates a surprising failure.

## `specVersion` (required)

`"MAJOR.MINOR"`. This implementation supports `1.x`:

- `1.0` → accepted.
- `1.<n>` with `n > 0` → accepted with a `contribspec/newer-minor` warning (unknown keys are still
  rejected, so the document cannot be silently misinterpreted).
- any other major → `contribspec/unsupported-version` error. No guessing, no silent downgrade.

Migration: `migrateDocument()` applies the longest available migration chain. ContribSpec 1.x has no
migrations because same-major documents never need shape changes; the infrastructure exists so a
future `2.0` is a data change rather than a refactor.

## `metadata`

Documentation only; never affects evaluation.

| Field         | Type                 | Notes |
| ------------- | -------------------- | ----- |
| `name`        | string ≤120          |       |
| `description` | string ≤500          |       |
| `url`         | string, `http(s)://` |       |
| `maintainers` | string[] ≤50         |       |

## `repository`

| Field           | Type                                   | Default                | Meaning                                       |
| --------------- | -------------------------------------- | ---------------------- | --------------------------------------------- |
| `requiredFiles` | (string \| {path, description})[] ≤100 | `README.md`, `LICENSE` | Files that must exist. Strings are shorthand. |

Paths are matched case-exactly first, then case-insensitively, so a repository does not pass on Linux
and fail on Windows for the same content.

## `pullRequests`

### `pullRequests.title`

| Field          | Type                                 | Default                                                                | Meaning                                      |
| -------------- | ------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------- |
| `convention`   | `conventional` \| `none`             | `conventional`                                                         | Conventional Commits `type(scope)!: subject` |
| `types`        | string[] (lowercase, ≤20 chars each) | feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert | Allowed types                                |
| `requireScope` | boolean                              | `false`                                                                | Require `(scope)`                            |
| `maxLength`    | integer 1–300                        | `72`                                                                   | Maximum title length                         |

### `pullRequests.description`

| Field                | Type            | Default | Meaning                                          |
| -------------------- | --------------- | ------- | ------------------------------------------------ |
| `minLength`          | integer 0–20000 | `20`    | Minimum characters, HTML comments excluded       |
| `requiredSections`   | string[] ≤20    | `[]`    | Markdown headings (`## Summary`) that must exist |
| `requireLinkedIssue` | boolean         | `false` | Body must reference `#123`                       |

### `pullRequests.checks`

| Field                 | Type                                | Default              | Meaning                                         |
| --------------------- | ----------------------------------- | -------------------- | ----------------------------------------------- |
| `required`            | string[] ≤50                        | `[]`                 | Check names that must report (case-insensitive) |
| `acceptedConclusions` | (`success`\|`neutral`\|`skipped`)[] | `[success, neutral]` | Conclusions that count as passing               |

### `pullRequests.contributor`

| Field                       | Type    | Default                | Meaning                                       |
| --------------------------- | ------- | ---------------------- | --------------------------------------------- |
| `allowedAuthorAssociations` | enum[]  | unset (no restriction) | GitHub `author_association` values            |
| `requireDcoSignoff`         | boolean | `false`                | Every commit needs a `Signed-off-by:` trailer |
| `requireVerifiedCommits`    | boolean | `false`                | Every commit must be signature-verified       |

When the provider reports no author association or no commits, the corresponding check returns `skip`
rather than failing.

## `issues`

| Field             | Type           | Default | Meaning                                                                           |
| ----------------- | -------------- | ------- | --------------------------------------------------------------------------------- |
| `requireTemplate` | boolean        | `false` | At least one `.github/ISSUE_TEMPLATE` file should exist (reported by the auditor) |
| `requiredLabels`  | string[] ≤20   | `[]`    | Labels expected on issues (documentation/report metadata)                         |
| `staleAfterDays`  | integer 0–3650 | unset   | Documented staleness expectation                                                  |

Issue policies are intentionally limited in 0.1: they describe expectations that the auditor reports.
MaintainerKit never labels or closes issues.

## `release`

| Field                      | Type       | Default        | Meaning                                                            |
| -------------------------- | ---------- | -------------- | ------------------------------------------------------------------ |
| `changelogPath`            | path       | `CHANGELOG.md` | Changelog file                                                     |
| `requireUnreleasedSection` | boolean    | `false`        | Changelog must have an `Unreleased` heading                        |
| `requireChangelogEntry`    | boolean    | `false`        | Changelog must contain the release version                         |
| `versionFiles`             | path[] ≤20 | `[]`           | Files whose declared version must match (JSON `version` is parsed) |

## `security`

| Field                     | Type         | Default | Meaning                                   |
| ------------------------- | ------------ | ------- | ----------------------------------------- |
| `requireDependencyAlerts` | boolean      | `false` | Dependabot alerts enabled                 |
| `requireSecretScanning`   | boolean      | `false` | Secret scanning enabled                   |
| `requirePushProtection`   | boolean      | `false` | Push protection enabled                   |
| `requireBranchProtection` | boolean      | `false` | Default branch protected                  |
| `requireSignedCommits`    | boolean      | `false` | Branch protection requires signed commits |
| `minimumApprovals`        | integer 0–20 | `0`     | Required approving reviews                |

These are observable only through the GitHub API. Against a local path they return `skip` with an
explanation; they never report a pass they cannot prove.

## `ai`

| Field                     | Type        | Default                 | Meaning                                                                                                                 |
| ------------------------- | ----------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `enabled`                 | boolean     | `false`                 | Run advisories at all                                                                                                   |
| `provider`                | string ≤60  | unset                   | `mock`, `openai-compatible`, `anthropic`, `ollama` (or a registered id)                                                 |
| `model`                   | string ≤120 | provider default        | Model name                                                                                                              |
| `capabilities`            | enum[]      | `[]`                    | issue-classification, duplicate-issue-suggestion, pull-request-summary, risk-analysis, review-assistance, release-notes |
| `requireHumanApprovalFor` | operation[] | all mutating operations | Operations that must be approved by a human                                                                             |

Invariants enforced at validation:

- `enabled: true` requires at least one capability (`contribspec/ai-without-capabilities`).
- capabilities without `enabled: true` is an error (`contribspec/capabilities-without-ai`).
- `requireHumanApprovalFor` without `merge` produces a warning: merging stays human-controlled.

## `agents`

| Field                   | Type    | Default  | Meaning                                                 |
| ----------------------- | ------- | -------- | ------------------------------------------------------- |
| `allowedOperations`     | enum[]  | `[read]` | read, comment, label, close, merge, release, push       |
| `humanApprovalRequired` | boolean | `true`   | Cannot be `false` while mutating operations are allowed |

Setting `humanApprovalRequired: false` with `comment`, `merge`, or any other mutating operation is a
validation **error**. This is a deliberate security invariant, not a preference.

## `rules`

Per-rule overrides keyed by rule id:

```yaml
rules:
  MK-SEC-001:
    severity: warning # info | warning | error
  MK-REL-001:
    enabled: false
```

Unknown rule ids are errors when the evaluating build knows its rule catalogue
(`contribspec/unknown-rule`), which prevents a typo from silently disabling a check.

## Complete example

```yaml
specVersion: "1.0"

metadata:
  name: Example project
  description: A small library with a strict contribution policy.

repository:
  requiredFiles:
    - path: README.md
      description: What the project does and how to use it.
    - path: LICENSE
    - path: CONTRIBUTING.md
    - path: SECURITY.md
    - path: CHANGELOG.md

pullRequests:
  title:
    convention: conventional
    types: [feat, fix, docs, refactor, perf, test, build, ci, chore, revert, security]
    maxLength: 72
  description:
    minLength: 40
    requiredSections: [Summary, Testing]
    requireLinkedIssue: true
  checks:
    required: [verify, lint]
    acceptedConclusions: [success, neutral]
  contributor:
    requireDcoSignoff: true

release:
  changelogPath: CHANGELOG.md
  requireUnreleasedSection: true
  requireChangelogEntry: true
  versionFiles: [package.json]

security:
  requireDependencyAlerts: true
  requireSecretScanning: true
  requireBranchProtection: true
  minimumApprovals: 1

ai:
  enabled: false
  capabilities: []

agents:
  allowedOperations: [read]
  humanApprovalRequired: true

rules:
  MK-SEC-001:
    severity: warning
```

More examples: [`examples/`](../examples).

## Compatibility promise

Within a major version, published fields are not renamed or removed, and rule ids are stable. New
optional fields may be added in a minor version; documents that do not use them stay valid. See
[GOVERNANCE.md](../GOVERNANCE.md#contribspec-versioning).
