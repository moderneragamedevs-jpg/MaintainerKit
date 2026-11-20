# Governance

MaintainerKit is a small, maintainer-led open-source project. This document says how decisions are
made, so contributors know what to expect and nobody has to guess who decides.

## Principles

1. **Users first, then contributors, then maintainers' preferences.** A change that helps users wins
   over stylistic taste.
2. **Written decisions.** Anything that changes a public contract (rule ids, report schema, ContribSpec,
   CLI flags, exit codes) needs an ADR or an accepted RFC.
3. **No silent reversals.** Never revert another person's work without discussing it in the issue.
4. **Security is not a feature vote.** A change that weakens the security model needs an explicit ADR and
   two maintainer approvals.
5. **No vendor capture.** No single company controls the project; the specification is not a sales tool
   for a hosted product.

## Roles

| Role | Responsibilities | How you get it |
| --- | --- | --- |
| **Contributor** | Opens issues and PRs, reviews are welcome from anyone | Submit a signed-off PR |
| **Reviewer** | May approve PRs in areas they have contributed to | Invited by maintainers after sustained, high-quality contributions |
| **Maintainer** | Merge rights, releases, security response, roadmap | Nominated by a maintainer, approved by all current maintainers |
| **Security maintainer** | Triage of private reports, advisories | A maintainer with security review duty (rotation by agreement) |

Maintainers step down by announcing it; access is removed when a maintainer has been inactive for six
months and does not respond to a check-in.

## Decisions

- **Small changes** (bug fixes, docs, a new rule that fits an existing contract): lazy consensus. A
  maintainer approves the PR; no RFC needed.
- **Contract changes** (new/changed ContribSpec field, rule id change, report schema, exit codes, CLI
  flag removal, new write operation): an RFC issue using the template below, open for at least 7 days,
  then a maintainer decision recorded in the issue and (if architectural) as an ADR in `docs/adr/`.
- **Security changes**: RFC + two maintainer approvals + updated `docs/SECURITY_MODEL.md`.
- **Releases**: a maintainer with release duty, after `pnpm verify` passes.

If consensus fails, the change does not happen. Nobody merges on a 50/50 split.

## RFC template

```text
Title:
Status: draft | accepted | rejected | superseded
Problem:      what is broken or missing, with evidence
Proposal:     the change, precisely (fields, ids, flags, schema)
Alternatives: what else was considered and why it lost
Compatibility: what breaks for existing users, and the migration path
Security:     impact on the threat model
Testing:      how the behaviour will be verified
Decision:     filled in by maintainers, with date and rationale
```

## ContribSpec versioning

ContribSpec follows `MAJOR.MINOR` (currently `1.0`):

- A **minor** may add optional fields and rules. Documents stay valid.
- A **major** may rename or remove fields, change defaults with user-visible effects, or change rule
  semantics. A migration must ship with the implementation.
- Unknown keys are rejected, so a newer minor document cannot be silently misinterpreted by an older
  implementation; a newer minor produces a warning, an unknown major produces an error.

## Independence and adoption claims

ContribSpec is a MaintainerKit specification. It becomes a "standard" only when (a) at least two
independent maintainers outside this project use it in production, and (b) this governance document is
replaced by a multi-stakeholder process. Until then, documentation and the website must not claim
standard status or adoption numbers.

## Trademark and naming

The product name and the `@maintainerkit` npm scope are project assets, not company assets. See
[docs/adr/0001-project-naming.md](docs/adr/0001-project-naming.md) for the current naming decision,
including the unrelated `maintainerkit` package on npm.

## Contacts

Maintainer contact details are published in the repository's GitHub organization profile. Security
reports must use the private channel in [SECURITY.md](SECURITY.md), not email to individuals.
