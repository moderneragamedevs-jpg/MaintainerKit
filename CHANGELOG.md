# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

ContribSpec is versioned separately (`MAJOR.MINOR`), so a package release may ship without a
ContribSpec change.

## [Unreleased]

### Added

- **ContribSpec 1.0**: JSON Schema (draft 2020-12), YAML loader, structural validation with JSON Pointer
  diagnostics, semantic cross-field validation, explicit version compatibility, and migration
  infrastructure (`none` available yet by design).
- **Policy engine**: deterministic evaluation with an extensible rule registry and seven rules —
  `MK-REPO-001` required files, `MK-SEC-001` security configuration, `MK-PR-001` title convention,
  `MK-PR-002` description requirements, `MK-PR-003` required checks, `MK-PR-004` contributor
  requirements, `MK-REL-001` release readiness.
- **Repository audit**: nine documented health checks (`MK-AUD-001`…`MK-AUD-009`) with evidence,
  remediation, and explicit `skip` semantics instead of invented scores.
- **Integrations**: local filesystem/git adapter (path-traversal safe, size-capped) and an Octokit
  read adapter with typed error mapping and a gated check-run publisher.
- **CLI**: `init`, `validate`, `doctor`, `audit`, `check`, `report`, `explain`; `text|json|markdown`
  output; documented exit codes; works with no AI provider configured.
- **GitHub Action**: bundled `node24` action running on `pull_request` only, `contents: read` by
  default, job-summary output, optional check-run publishing behind a write gate.
- **AI layer (optional)**: `AIProvider` contract, six capability schemas, structured-output validation
  with Ajv, timeouts and bounded retries, mock provider, and `fetch`-based adapters for
  OpenAI-compatible endpoints, Anthropic, and Ollama. Advisories are structurally separate from policy
  findings and cannot change a verdict.
- **Audit trail**: structured events, JSONL sink, in-memory sink, storage seam for future persistence,
  and central secret redaction applied to every output artifact.
- **SDK**: `MaintainerKit` facade plus re-exported stable contracts for building on the platform.
- **Quality gates**: 300+ tests (unit, provider contract, mocked GitHub, architecture, security,
  end-to-end), dependency-direction tests, and reproducible builds.

### Security

- Redaction of GitHub tokens, provider keys, bearer headers, cloud keys, and key-like assignments at
  every sink, including saved JSON reports.
- Write gate (`MAINTAINERKIT_ALLOW_WRITE=true`) required for the single mutating operation; fails closed
  on any other value.
- Prompt-injection defenses: untrusted data wrapping, control-token stripping, role-marker indentation,
  injection-phrase detection, and closed-schema output validation.
- Documented threat model and ADRs covering naming, determinism, layering, and Action security.

### Notes

- No packages have been published. The npm name `maintainerkit` belongs to an unrelated project; a
  scoped publication under `@maintainerkit/*` is the plan (ADR-0001) and requires explicit maintainer
  authorization.
- ContribSpec is **not** claimed to be an industry standard; there is no independent adoption yet.
