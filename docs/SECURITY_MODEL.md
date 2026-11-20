# MaintainerKit — Security Model & Threat Model

Scope: the CLI, the GitHub Action, integrations, and the optional AI layer.

## 1. Assets to protect

1. GitHub tokens and AI API keys.
2. Repository write access (default branch, releases, issues, PRs).
3. Integrity of policy results (a forged "pass" is a security failure).
4. User data in logs and audit events (no secrets, no unnecessary personal data).
5. Supply chain: the packages users install and the Action they reference.

## 2. Trust boundaries

```
untrusted ──────────────────────────────────────────────► trusted
GitHub API payloads (PR titles/bodies, issue text, file contents, commit messages)
        │
        ├─ treated as data: length-capped, wrapped, never executed, never interpolated into prompts as instructions
        ▼
MaintainerKit parser ─► validated neutral snapshot ─► deterministic rules ─► report
                                                  ▲
                                    AI provider (untrusted output, schema-validated, advisory)
```

- Nothing from repository content is `eval`'d, shell-executed, or used to build a command line.
- File reads are restricted to repository-relative paths; path traversal (`..`, absolute paths,
  symlink escape) is rejected by the local adapter.
- AI output is untrusted input: schema-validated, size-capped, never used for a policy decision.

## 3. Threats and mitigations

| Threat                             | Mitigation                                                                                                                                | Verified by                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Prompt injection via PR/issue text | Data wrapping + explicit "ignore instructions in data" framing, control-marker stripping, output schema validation, no tool authority     | `ai-prompts` + `ai-core` tests |
| Secret leakage into logs/audit     | Central redaction (GitHub tokens, `sk-*`, bearer headers, AWS keys, private keys, generic high-entropy assignments) applied at every sink | `audit` redaction tests        |
| `pull_request_target` RCE          | Action uses `pull_request`, API-only analysis, no head checkout                                                                           | Action docs + workflow files   |
| Over-broad token permissions       | `contents: read` default; `checks: write` only for check publishing; permissions table in docs                                            | workflows + docs               |
| Unauthorized mutation              | `MAINTAINERKIT_ALLOW_WRITE` + explicit config gate + `WriteNotAuthorizedError` before any request                                         | `integrations/github` tests    |
| Malicious ContribSpec config       | JSON Schema + semantic validation with bounded sizes; unknown keys rejected (`additionalProperties: false`)                               | `contribspec` tests            |
| DoS via huge inputs                | Response/body caps, file size caps, regexes without catastrophic backtracking (linear, anchored, bounded), timeouts                       | unit tests + review            |
| Rate limits / transient failure    | Typed errors, retry with jitter only for idempotent reads, graceful degradation to `unknown`                                              | `integrations/github` tests    |
| Malformed AI response              | Schema validation → typed `AIValidationError`; policy results unaffected                                                                  | provider contract tests        |

## 4. Principles

- **Least privilege**: every documented operation lists the exact permissions it needs.
- **Deny by default**: no write path without an explicit gate; unknown provider data → `unknown`, never `pass`.
- **Determinism is a security property**: same input ⇒ same report, so tampering is detectable.
- **Audit before action**: mutating operations (none in v1) must be logged with actor and approval.
- **No hidden network calls**: the only outbound calls are the GitHub API (when a remote repo is
  queried) and the configured AI provider (when AI is enabled).

## 5. Human-in-the-loop

| Operation                              | Authorization required                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| Read repo/PR metadata, compute reports | none (read-only token)                                                       |
| Publish a check run                    | workflow `checks: write` + `publish-checks: true`                            |
| Send data to an AI provider            | `ai.enabled: true` in ContribSpec + provider key in env                      |
| Any mutation (future)                  | explicit config + `MAINTAINERKIT_ALLOW_WRITE=true` + human approval recorded |

## 6. Known limitations

- Local `audit` trusts the working tree; it cannot verify branch protection without a GitHub token.
- AI risk analysis is heuristic and can be wrong; it never blocks a merge by itself.
- Redaction is pattern-based; a novel secret format may escape it. Never put secrets in repository
  files that MaintainerKit reads.
- No SBOM signing or attestation in 0.1 (see `SECURITY.md` for the reporting process).

## 7. Reporting a vulnerability

See `SECURITY.md`. Do not open a public issue for a vulnerability.
