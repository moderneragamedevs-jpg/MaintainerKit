# Repository audit checks

`maintainerkit audit` runs nine checks against a repository and reports per-check status with evidence
and remediation. It needs **no** policy document: the audit is about repository health, not about your
ContribSpec.

## No health score

There is deliberately no 0–100 score. A weighted number would look authoritative while resting on
invented factors, and it would hide the only thing that matters: which check failed and what to do about
it. The report states per-check status. The overall result is `fail` when at least one **error-severity**
check fails; warnings are reported but do not fail the run.

## Status semantics

| Status | Meaning                                                                                                   |
| ------ | --------------------------------------------------------------------------------------------------------- |
| `pass` | The documented condition holds                                                                            |
| `fail` | The condition does not hold; evidence and remediation are included                                        |
| `skip` | The check cannot observe its input from this source (for example security settings from a local checkout) |

`skip` is never reported as `pass`. A check that crashes becomes an `error` finding and fails the audit:
an audit that could not complete must not claim health.

## Reading the results

- `--format text` (default): actionable findings first, with evidence and `fix:` text.
- `--format markdown`: a report suitable for a comment or a saved artifact.
- `--format json`: the stable report contract (see [REPORTS.md](REPORTS.md)).
- `--repo owner/name`: audit through the GitHub API, which enables the security checks.
- `--audit-log audit.jsonl`: append structured audit events (redacted).

---

## MK-AUD-001

**README explains the project** — severity: error

**Pass condition:** `README.md` exists and, when file contents are readable, contains at least 200
non-whitespace characters. When contents are not readable, presence alone is reported as a pass with
"content not inspected".

**Remediation:** add a README that says what the project does, how to install it, and how to use it.

## MK-AUD-002

**License is present and identifiable** — severity: error

**Pass condition:** a `LICENSE`/`LICENCE`/`COPYING` file exists, or the provider reports an SPDX license.
When contents are readable, a known license family (Apache-2.0, MIT, BSD-3-Clause, GPL-3.0, MPL-2.0) is
identified; an unidentifiable custom text fails.

**Remediation:** add a standard license text. Without a license the code is not legally usable by others.

## MK-AUD-003

**Contribution guide exists** — severity: warning

**Pass condition:** `CONTRIBUTING.md` exists.

**Remediation:** document setup, test, and review expectations.

## MK-AUD-004

**Security policy exists** — severity: error

**Pass condition:** `SECURITY.md` exists.

**Remediation:** document a private reporting channel and supported versions.

## MK-AUD-005

**Code of conduct exists** — severity: warning

**Pass condition:** `CODE_OF_CONDUCT.md` exists.

**Remediation:** adopt a code of conduct and name an enforcement contact.

## MK-AUD-006

**Continuous integration is configured** — severity: error

**Pass condition:** at least one `.github/workflows/*.yml|yaml` file exists. When contents are readable,
at least one workflow declares a trigger (`on:`).

**Remediation:** add a workflow that builds and tests the project on pull requests.

## MK-AUD-007

**Dependency updates are configured** — severity: warning

**Pass condition:** a dependency automation config exists (`renovate.json`, `.github/renovate.json`,
`.renovaterc`, `dependabot.yml`, `.github/dependabot.yml`) **or** the provider reports dependency alerts
as enabled. A lockfile is reported as evidence, not as a requirement (a repository may not be a package).

**Remediation:** add `.github/dependabot.yml` or `renovate.json`, and enable alerts.

## MK-AUD-008

**GitHub security features are enabled** — severity: error

**Pass condition:** when the provider reports security posture, secret scanning, dependency alerts, and
push protection are all enabled. When posture is unavailable, the check is skipped with that reason.

**Remediation:** enable the controls in the repository's code security settings.

## MK-AUD-009

**Default branch is protected** — severity: error

**Pass condition:** when the provider reports branch protection, protection is enabled and at least one
approving review is required. When the information is unavailable, the check is skipped.

**Remediation:** require pull requests, reviews, and passing checks on the default branch.

---

## Local versus remote

| Check                  | Local working tree   | GitHub (`--repo`)                              |
| ---------------------- | -------------------- | ---------------------------------------------- |
| MK-AUD-001…007         | Evaluated            | Evaluated                                      |
| MK-AUD-008, MK-AUD-009 | Skipped (no posture) | Evaluated when the token can read the settings |

A local audit answers "does this repository have the files and CI it claims?"; a remote audit also
answers "are the provider-level protections on?". Both are useful; neither is faked.
