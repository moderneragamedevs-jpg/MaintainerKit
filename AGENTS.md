# AGENTS.md — operating rules for AI coding agents

This file is for automated coding agents (and humans who want the same discipline). Follow it exactly.
It overrides general habits you may have; it does not override the user's explicit instructions or the
security model in `docs/SECURITY_MODEL.md`.

## Before you change anything

1. Read `README.md`, `docs/ARCHITECTURE.md`, and the document for the area you are touching
   (`docs/POLICY_RULES.md`, `docs/CONTRIBSPEC.md`, `docs/AUDIT_CHECKS.md`, `docs/GITHUB_INTEGRATION.md`,
   `docs/AI.md`).
2. Inspect the existing code and tests in that package. Match their conventions.
3. Find the public contract you are about to change (rule id, report field, CLI flag, schema key,
   action input). If it is public, the change needs an ADR or an accepted RFC first.
4. Read `CONTRIBUTING.md` for the task template. Write the objective, scope, tests, and acceptance
   criteria into the issue or PR body before coding.

## Hard rules

- **Determinism is not negotiable.** Policy rules must be pure: no wall clock, no network, no
  randomness, no environment reads. Inject `now` and pass snapshots.
- **Never let AI output change a policy verdict, exit code, or check conclusion.** Advisories are a
  separate array, always labelled with provider and model.
- **Respect the dependency direction** (`tests/architecture.test.ts` enforces it):
  `core` ← `contribspec` ← `policy-engine`; `core` ← `audit`, `integrations`, `ai/*`;
  `workflow-engine` composes the lower layers; `interfaces/*` may depend on anything below.
- **No new write operation without a gate.** A mutating call must require configuration *and*
  `MAINTAINERKIT_ALLOW_WRITE=true`, emit an audit event, and be documented.
- **Skip is not pass.** If the input is unavailable, return `skip` with a reason.
- **Never weaken a test to get green.** If a test encodes a wrong assumption, change it explicitly in
  the same PR and explain why.
- **Never invent results.** Do not claim a command ran, a test passed, or a network call succeeded
  unless you executed it and saw the output.
- **No unrequested artifacts.** No extra READMEs, summaries, sample projects, or "improvements" outside
  the task.

## Commands

```bash
corepack pnpm install        # install (pnpm is required; corepack ships with Node)
pnpm build                   # Turborepo build of every package
pnpm test                    # vitest: unit, contract, architecture, security
pnpm test:e2e                # build, then exercise the CLI binary
pnpm verify                  # build + typecheck + lint + format + tests (use before proposing a PR)
pnpm vitest run packages/policy-engine   # one package
```

If `pnpm` is unavailable, `corepack pnpm …` works without a global install.

## Where things go

| You are adding… | Put it in |
| --- | --- |
| A policy rule | `packages/policy-engine/src/rules/` + `rules/index.ts` + `docs/POLICY_RULES.md` + tests |
| A health check | `packages/audit/src/checks.ts` + `docs/AUDIT_CHECKS.md` + tests |
| A ContribSpec field | `packages/contribspec/src/schema/contribspec-1.0.schema.json`, regenerate with `node packages/contribspec/scripts/generate-schema.mjs`, update types/docs |
| An AI provider | `packages/ai/providers/src/` + factory + shared contract tests + `docs/AI.md` |
| A CLI command or flag | `packages/interfaces/cli/src/commands/` + `program.ts` + `docs/CLI.md` + tests |
| A GitHub API call | `packages/integrations/github/src/api-types.ts` (read interface) and the adapter |
| A report field | `packages/core/src/report.ts` (additive only) + `docs/REPORTS.md` |

## Security checklist for any change

- Does any new path print, log, store, or transmit a token, key, or private repository content?
- Does any new output bypass redaction (`redact`/`redactDeep`) or Markdown escaping?
- Does any new input come from repository content and reach a shell, a filesystem path, or a prompt
  without sanitisation?
- Does any new write happen without the gate, and is it recorded in the audit trail?
- Does any new dependency expand the runtime attack surface? Justify it or avoid it.

## Definition of done

- The behaviour is covered by tests that fail without the change.
- `pnpm verify` passes locally.
- Public docs and `CHANGELOG.md` are updated.
- The diff is reviewable: unrelated refactors are not included.
- You can explain every line you added.
