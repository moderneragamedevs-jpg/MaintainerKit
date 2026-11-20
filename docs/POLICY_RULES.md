# Policy rules

Seven deterministic rules. Each has a stable id, a documented input contract, a fixed result shape, and
unit tests in `packages/policy-engine/test`.

Evaluation is pure: the same snapshot, configuration, and injected timestamp always produce the same
findings. Rules never read the network, the wall clock, or the environment.

## Result contract

Every rule returns one or more outcomes:

```ts
{
  status: "pass" | "fail" | "skip";
  message: string;          // what happened, in one sentence
  evidence: { label, value }[];  // what the rule observed (redacted at render time)
  remediation?: string;     // how to fix it, when fixable
}
```

`skip` means "cannot be determined" and is never treated as a pass. Severity comes from the rule
default, overridable per rule under `rules:` in ContribSpec (`info`, `warning`, `error`). Findings fail
the run at or above `--fail-on` (default `error`); a rule that _crashes_ always fails the run.

Findings also carry `ruleId`, `policyPath` (JSON Pointer into the document), and `docsUrl`.

---

## MK-REPO-001 — Required repository files

|                  |                                   |
| ---------------- | --------------------------------- |
| Applies to       | repository, pull_request, release |
| Default severity | error                             |
| Configuration    | `/repository/requiredFiles`       |
| Source           | `rules/repo-files.ts`             |

**Evaluates:** for each configured file, whether it exists in the repository snapshot.

**Pass:** the file exists. Matching is case-exact first, then case-insensitive, so a repository does not
pass on one operating system and fail on another. Evidence shows the path as it actually exists.

**Fail:** `Required file "<path>" is missing.` One finding per missing file, each with the configured
purpose as a hint.

**Skip:** no files configured.

**Remediation:** add the file, or remove the entry if the requirement is obsolete.

```yaml
repository:
  requiredFiles:
    - path: SECURITY.md
      description: How to report a vulnerability.
```

---

## MK-PR-001 — Pull request title

|                  |                                              |
| ---------------- | -------------------------------------------- |
| Applies to       | pull_request                                 |
| Default severity | error                                        |
| Configuration    | `/pullRequests/title`                        |
| Source           | `rules/pr-title.ts`, `rules/conventional.ts` |

**Evaluates:** the title against Conventional Commits — `type(scope)!: subject` — plus the configured
type list and length limit.

**Pass:** the title parses, the type is allowed, the scope is present when required, and the length is
within the limit.

**Fail (one finding per problem):**

- `Title "…" is not a Conventional Commits title.`
- `Title type "feature" is not in the allowed list.` — with a suggestion when a near match exists
  (`feature` → `feat`).
- `Title is missing a required scope, e.g. "feat(api): …".`
- `Title is 91 characters; the configured maximum is 72.`

**Skip:** `convention: none`, or no pull-request snapshot.

**Notes:** the parser is a single anchored regular expression with bounded quantifiers — no
catastrophic backtracking on hostile input. Uppercase types are rejected, matching the conventional
specification.

```yaml
pullRequests:
  title:
    convention: conventional
    types: [feat, fix, docs, chore]
    maxLength: 72
```

---

## MK-PR-002 — Pull request description

|                  |                             |
| ---------------- | --------------------------- |
| Applies to       | pull_request                |
| Default severity | error                       |
| Configuration    | `/pullRequests/description` |
| Source           | `rules/pr-description.ts`   |

**Evaluates:** body length, required Markdown sections, and (optionally) an issue reference.

**Pass:** length ≥ `minLength`, every required heading exists, and — when `requireLinkedIssue` is set —
the body references an issue.

**Fail:**

- `The pull request has no description.`
- `The description is 12 characters; at least 40 are required.`
- `Missing required section(s): Testing.`
- `The description does not reference an issue.`

**Notes:** HTML comments are stripped before measuring, so a PR that leaves template comments untouched
does not pass. Headings are matched by scanning lines, not by building a RegExp from user input, so a
hostile section name cannot inject a pattern.

---

## MK-PR-003 — Required CI checks

|                  |                        |
| ---------------- | ---------------------- |
| Applies to       | pull_request           |
| Default severity | error                  |
| Configuration    | `/pullRequests/checks` |
| Source           | `rules/pr-checks.ts`   |

**Evaluates:** each required check name against the check runs reported for the pull request head.

**Pass:** the check exists, is `completed`, and concluded with one of `acceptedConclusions`
(default `success`, `neutral`).

**Fail:**

- `Required check "verify" has not reported on this pull request.` — evidence lists the checks that did
  report, which is usually the answer.
- `Required check "verify" is still in_progress.`
- `Required check "verify" concluded "failure".`

**Skip:** no required checks configured.

**Notes:** names are matched case-insensitively, and the most recent run wins when a name appears more
than once. `skipped` is not accepted unless you add it explicitly.

---

## MK-PR-004 — Contributor requirements

|                  |                             |
| ---------------- | --------------------------- |
| Applies to       | pull_request                |
| Default severity | error                       |
| Configuration    | `/pullRequests/contributor` |
| Source           | `rules/pr-contributor.ts`   |

**Evaluates:** author association allow-list, DCO sign-off trailers, and commit signature verification.

**Pass:** every configured requirement is satisfied.

**Fail:**

- `Author association "NONE" is not allowed.`
- `2 of 3 commit(s) lack a Signed-off-by trailer.` — lists shortened SHAs.
- `1 commit(s) are not verified.`

**Skip:** nothing configured; or the provider reported no association/commits, because a missing signal
is not evidence of a violation.

**Notes:** the sign-off check looks for a `Signed-off-by: Name <email>` trailer line, which is what the
DCO requires. Verified commits come from the provider's `verification.verified` flag.

---

## MK-REL-001 — Release readiness

|                  |                              |
| ---------------- | ---------------------------- |
| Applies to       | release                      |
| Default severity | error                        |
| Configuration    | `/release`                   |
| Source           | `rules/release-readiness.ts` |

**Evaluates:** changelog presence, an `Unreleased` section, a version entry, and declared versions in
`versionFiles`.

**Pass:** all configured requirements hold.

**Fail:**

- `Changelog "CHANGELOG.md" is missing.`
- `The changelog has no Unreleased section.`
- `The changelog has no entry for version 2.0.0.`
- `package.json declares version 1.1.0, but the release is 1.2.0.`
- `Version file "package.json" is missing.`

**Skip:** no release requirements configured; or no version supplied, when a check needs one; or the
repository source cannot read file contents.

**Notes:** JSON version files are parsed and compared exactly; other files are checked for the version
string. Run it with `maintainerkit check --release 1.4.0` (local or `--repo`), or build the subject through
the SDK.

---

## MK-SEC-001 — Repository security configuration

|                  |                          |
| ---------------- | ------------------------ |
| Applies to       | repository, pull_request |
| Default severity | error                    |
| Configuration    | `/security`              |
| Source           | `rules/repo-security.ts` |

**Evaluates:** the configured GitHub security controls and the minimum approving-review count.

**Pass:** each configured control is enabled, and required approvals meet the minimum.

**Fail:**

- `secret scanning is not enabled.` (per control, with the setting to change)
- `Branch protection requires 0 approval(s); 1 are required by policy.`

**Skip:** no security requirements configured; or the source cannot report posture (a local checkout
always lands here — the reason names the flag to use instead); or an individual control is reported as
`unknown`.

**Notes:** `unknown` is distinct from `false` throughout. A repository where the token cannot read
branch protection is not silently treated as unprotected, nor as protected.

```yaml
security:
  requireDependencyAlerts: true
  requireSecretScanning: true
  requireBranchProtection: true
  minimumApprovals: 1
```

---

## Adding a rule

See [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-policy-rule). Requirements: stable id
(`MK-AREA-001`), `skip` semantics, tests for pass/fail/skip and a hostile input, and a section in this
document.
