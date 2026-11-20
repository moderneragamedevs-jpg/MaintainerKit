# ADR-0002 — Deterministic policy evaluation is authoritative; AI is advisory only

- Status: Accepted
- Date: 2026-11-20

## Context

An LLM can summarize a pull request or guess an issue's type, but it cannot provide a reproducible,
auditable pass/fail decision. Maintainers must be able to answer "why did this check fail?" with a
rule id, an evidence record, and a policy path — the same answer every time.

## Decision

- Two disjoint result types: `PolicyFinding` (from `policy-engine`, deterministic) and
  `AdvisoryFinding` (from `ai-core`, non-deterministic, always carries `provider`, `model`,
  `promptVersion`, `confidence`).
- Reports keep them in separate arrays. No merge, no "AI-boosted" severity.
- The failure threshold, exit codes, and check-run conclusion are computed **only** from policy findings.
- AI may not read or mutate policy state, and policy rules may not import AI packages
  (enforced by `tests/architecture`).
- Every AI capability must be optional: with no provider configured, the CLI and Action behave
  exactly as with AI disabled.

## Consequences

- Reproducibility: same snapshot + same ContribSpec + same rule set ⇒ same report (injected `now`).
- AI failures degrade to a recorded advisory error, never to a policy failure.
- Reviewers can diff reports across runs and trust the diff.

## Alternatives rejected

- Single finding type with a `source` flag: invites accidental authority leakage.
- AI-based severity adjustment: unverifiable and unstable across model versions.
