# MaintainerKit — Roadmap

Versioning: SemVer for packages, independent SemVer for ContribSpec
(`major.minor` in the document, e.g. `1.0`). Nothing here is a promise of a date.

## Milestone 0.1 — Usable locally (current)

| Epic           | Feature                                                                       | State |
| -------------- | ----------------------------------------------------------------------------- | ----- |
| E1 Foundation  | pnpm + Turborepo + strict TS + Vitest + CI                                    | done  |
| E2 ContribSpec | v1.0 JSON Schema, YAML loader, schema + semantic validation, examples, docs   | done  |
| E3 Engine      | Rule registry, 7 rules, deterministic reports, dry-run, explain               | done  |
| E4 Audit       | Repository health checks, JSON + Markdown output, JSONL audit events          | done  |
| E5 GitHub      | Octokit reader, CLI `check --pr`, GitHub Action with check publishing         | done  |
| E6 AI          | Provider contract, mock + 3 adapters, classification/summary/risk, validation | done  |
| E7 Community   | README, CONTRIBUTING, CoC, SECURITY, GOVERNANCE, templates, docs site         | done  |

## Milestone 0.2 — Adoption hardening

- [ ] `maintainerkit check --base <ref>` diff-aware evaluation for local branches.
- [ ] Issue policies: label requirements, template detection, stale policy metadata.
- [ ] SARIF output for GitHub code scanning.
- [ ] Config `extends` for organization-wide shared ContribSpec documents.
- [ ] GitLab adapter proving provider independence.
- [ ] Performance budget: `audit` on a 5k-file repo under 1s (documented measurement).

## Milestone 0.3 — Assisted maintenance

- [ ] Duplicate-issue suggestions with an explicit human-confirm flow.
- [ ] Release notes generation from conventional commits, draft-only.
- [ ] Review assistance summaries attached to a check run as annotations.
- [ ] Provider cost/usage reporting surfaced in the audit trail.

## Milestone 1.0 — Stability contract

- [ ] ContribSpec 1.x compatibility policy frozen and tested across minors.
- [ ] Stable SDK surface with a deprecation policy.
- [ ] Formal RFC + governance process exercised by at least one external proposal.
- [ ] Independent adoption exists (not claimed before it is true).

## Backlog ready for outside contributors

- `good first issue`: add a rule (each rule is a self-contained file, tests, docs entry).
- `good first issue`: documentation examples for `examples/`.
- `good first issue`: new `explain` topics.
- `help wanted`: SARIF renderer.
- `help wanted`: GitLab adapter (uses only `core` contracts).
- `help wanted`: AI provider adapter for a self-hosted OpenAI-compatible server.
- `help wanted`: Persian/Japanese translations of the README (docs only).

Rules for adding work: every item must state objective, scope, dependencies, files, tests, acceptance
criteria, and risk (see `CONTRIBUTING.md`). Prefer changes under ~300 lines.
