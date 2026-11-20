# ADR-0003 — Monorepo boundaries and the neutral snapshot seam

- Status: Accepted
- Date: 2026-11-20

## Context

MaintainerKit must support GitHub first but not be GitHub-only, and must keep the policy engine free of
both vendor APIs and AI. A single package would make those guarantees unverifiable.

## Decision

Split by **rate of change and dependency direction**, not by noun:

```
core              pure contracts, errors, exit codes, report envelope   (no deps)
contribspec       schema + loader + validation                          → core
policy-engine     rules, registry, evaluation                           → core, contribspec
audit             events, redaction, JSONL/Markdown sinks               → core
workflow-engine   orchestration of check/audit/report                   → core, contribspec, policy-engine, audit
integrations/git  local filesystem + git CLI reader                     → core
integrations/github  Octokit reader (+ gated check publishing)          → core
ai/core           provider contract, registry, mock                     → core
ai/providers      fetch-based adapters                                  → ai/core
ai/prompts        versioned prompt templates + output schemas           → ai/core
interfaces/*      cli, github-action, sdk                               → everything
```

Providers implement `RepositorySource` / `PullRequestSource` interfaces declared in `core`, returning
neutral snapshots. Adding GitLab or Gitea must not require touching `policy-engine`.

## Consequences

- Packages are created when they have a contract and a consumer in the same change; no empty shells.
- Build order is expressed by Turborepo (`dependsOn: ["^build"]`).
- The dependency rule is testable by static import scanning.

## Alternatives rejected

- Single package: unauditable boundaries.
- "Engine takes Octokit types": couples rules to GitHub and breaks offline auditing.
