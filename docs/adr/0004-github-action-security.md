# ADR-0004 — GitHub Action security posture

- Status: Accepted
- Date: 2026-11-20

## Context

PR-triggered automation is a classic privilege-escalation surface: `pull_request_target` with a
checkout of the head ref executes contributor-controlled code with a write token; a compromised
token can rewrite the default branch; over-broad permissions silently expand blast radius.

MaintainerKit's job is _reading_ repository and PR metadata and _reporting_ results.

## Decision

1. **Analysis uses `pull_request`, never `pull_request_target`.** No checkout of untrusted head code
   is required, because analysis is API-based. The Action reads metadata only; it never builds or
   runs code from the PR.
2. **Default permissions are `contents: read`.** Write is opt-in per workflow, documented per feature:
   `checks: write` only when the workflow publishes a check run; `pull-requests: write` only for a
   future explicitly-authorized operation.
3. **No automatic mutations.** The Action cannot merge, close, label, or comment. Any future
   mutation must (a) be a separate, explicitly enabled command, (b) require
   `MAINTAINERKIT_ALLOW_WRITE=true`, and (c) be recorded in the audit log with actor and approval.
4. **Code-level write gate.** `GitHubWriteClient` is constructed only when both the workflow opted in
   (`publish-checks: true`) and the env gate is set; otherwise a `WriteNotAuthorizedError` is thrown
   before any request is made. Absence of the gate is the default.
5. **Fork PRs** are detected (`head.repo.full_name !== base.repo.full_name`) and marked on the report;
   secrets are never passed to fork-triggered runs, and the action must not require them.
6. **Log hygiene**: all output passes through the redaction layer; tokens are never printed, and
   action input values are not echoed.
7. **Read-only and write-enabled workflows are separate files** in this repository, so the default
   consumer copy is read-only.

## Consequences

- The Action works on fork PRs with a read-only `GITHUB_TOKEN` — the common case for public OSS.
- Publishing a check run requires `checks: write`; if absent, the Action reports to the log and
  exits with the policy status instead of failing on permissions (documented behaviour).
- No secret is required at all: analysis is API-and-file based, and AI is opt-in with a separate key.

## Alternatives rejected

- `pull_request_target` + head checkout: remote code execution with a write token.
- Committing a token-using bot: not maintainable for a small project.
- Auto-fix/auto-label in v1: unverifiable blast radius, needs design first.
