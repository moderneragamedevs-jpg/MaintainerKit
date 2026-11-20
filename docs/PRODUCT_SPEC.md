# MaintainerKit — Product Specification

Status: Phase 0 baseline (approved for local implementation)
Owner: MaintainerKit maintainers
License: Apache-2.0

## 1. Problem

Small and medium open-source projects fail maintenance for boring, fixable reasons:

- contribution rules live in a maintainer's head, not in the repository;
- the same review comments are written hundreds of times ("add a test", "conventional title", "add a changelog entry");
- repository health (SECURITY.md, CI, branch protection, dependency alerts) is checked rarely, by hand, and inconsistently;
- automation that could help is either vendor-locked (GitHub-only bots) or opaque (LLM-only decisions that cannot be audited).

Maintainers need rules that are **written down, machine-checkable, explainable, and safe to automate** —
and they need to work without an AI provider.

## 2. Product

MaintainerKit is a repository governance and maintenance platform consisting of:

| Component                | Responsibility                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| **ContribSpec**          | A versioned, machine-readable repository policy document (YAML) with a published JSON Schema. |
| **Policy engine**        | Deterministic evaluation of ContribSpec rules against provider-neutral snapshots.             |
| **Auditor**              | Documented repository health checks with evidence and remediation.                            |
| **Integrations**         | Local/git and GitHub readers producing the same neutral snapshots.                            |
| **CLI**                  | `init`, `validate`, `doctor`, `audit`, `check`, `report`, `explain`.                          |
| **GitHub Action**        | Runs checks in CI and publishes a check run.                                                  |
| **AI engine (optional)** | Provider-independent advisory layer: issue classification, PR summaries, risk analysis.       |
| **Audit trail**          | Structured, redacted events in JSONL plus human-readable Markdown.                            |
| **SDK**                  | Stable programmatic surface for building on top of MaintainerKit.                             |

## 3. Non-goals (initial release)

- Hosting or running a server, database, or web dashboard.
- Automatic merging, closing, labelling, or commenting without explicit per-operation authorization.
- Being a general-purpose policy language (ContribSpec is a closed, versioned schema, not Rego/CEL).
- Grading repositories with invented scores. Any status must map to a documented check.
- Claiming ContribSpec is an industry standard. It is a MaintainerKit specification with a public
  change process; adoption claims require independent adoption.

## 4. Users and jobs

1. **Solo maintainer**: `maintainerkit init` → `validate` → `audit` → commit the workflow file.
2. **Project with reviewers**: CI check blocks non-conventional PR titles and missing PR description
   sections with clear remediation text.
3. **Organization**: many repositories using one shared ContribSpec version, machine-readable JSON
   reports into their own dashboards.
4. **Tool builder**: consumes `contribspec` + `policy-engine` (or the SDK) to build their own CI gate.

## 5. Differentiation (grounded, not marketing)

Verified against live sources on 2026-11-20:

| Comparable                            | Stars               | What it does                             | Gap MaintainerKit targets                                                    |
| ------------------------------------- | ------------------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| `ossf/scorecard`                      | 5.8k                | Security health metrics for OSS          | Security-focused; no per-repository contribution policy document             |
| `danger/danger`                       | 5.7k                | Per-PR rule DSL in Ruby                  | Language/runtime mismatch for TS teams; rules are code, not a versioned spec |
| `probot/probot`                       | 9.6k                | GitHub App framework                     | Framework, not a product; GitHub-locked                                      |
| `open-policy-agent/conftest`          | 3.3k                | Rego tests over structured config        | General-purpose; no repo/PR domain model                                     |
| `todogroup/repolinter`                | 466 (archived)      | Repository linter                        | Archived; no PR policies; no versioned spec contract                         |
| `contributor-assistant/github-action` | 350 (archived)      | CLA/DCO assistant                        | Single-purpose; archived                                                     |
| npm `maintainerkit`                   | 0.1.4, other author | Generates agent instructions/triage text | Different author; **name collision** (see ADR-0001)                          |

MaintainerKit's distinct combination: **a versioned policy document + deterministic engine + optional
advisory AI, with every decision explainable and provider-independent** — usable with zero AI keys.

## 6. Success criteria (initial release)

Matches the program specification §19: install → init → validate → audit → CI check → machine-readable
report → optional AI → works without AI → sensitive actions human-controlled → a newcomer can contribute
from documentation alone.

## 7. Constraints

- Apache-2.0, DCO sign-off, no CLA.
- Node.js LTS, strict TypeScript, pnpm workspaces, Turborepo, Vitest.
- No runtime dependency on any AI vendor SDK; AI adapters use `fetch`.
- Core packages must not import GitHub or AI code.
- No network calls in tests; GitHub API is mocked.
