# Implementation status

Last verified: 2026-11-20 · commit this file ships with.

Everything below was executed, not estimated. Reproduce with `corepack pnpm verify` and the commands quoted
in each row.

## Verified working

| Area                                                   | Status                  | Evidence                                                                                                              |
| ------------------------------------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| ContribSpec 1.0 schema + validation                    | Done                    | `packages/contribspec/test` — 28 tests; `maintainerkit validate` on this repository and on `examples/*`               |
| Deterministic policy engine (7 rules)                  | Done                    | `packages/policy-engine/test` — 56 tests; `maintainerkit check` passes on this repository                             |
| Repository audit (9 checks)                            | Done                    | `packages/audit/test` — 48 tests; `maintainerkit audit` on this repository: 7 passed, 2 skipped (no API posture)      |
| Structured audit trail + redaction                     | Done                    | `packages/audit/test/events.test.ts`, `tests/security.test.ts`                                                        |
| Local git adapter                                      | Done                    | `packages/integrations/git/test` — 9 tests                                                                            |
| GitHub read adapter + gated check publishing           | Done                    | `packages/integrations/github/test` — 24 tests (all endpoints faked, no network)                                      |
| Workflow engine + renderers                            | Done                    | `packages/workflow-engine/test` — 17 tests (text, JSON, Markdown, check-run content)                                  |
| CLI (7 commands)                                       | Done                    | `packages/interfaces/cli/test` — 41 tests; `tests/e2e` — 4 binary tests                                               |
| AI core, 3 providers, prompts, advisor                 | Done                    | `packages/ai/**` — 79 tests, including one shared provider contract suite                                             |
| SDK facade                                             | Done                    | `packages/interfaces/sdk`; used by `examples/sdk/check.mjs`                                                           |
| GitHub Action (bundled, read-only by default)          | Done                    | `packages/interfaces/github-action/test` — 15 tests; `dist/index.cjs` runs and fails closed without inputs (`exit 2`) |
| Architecture boundaries (no GitHub/AI imports in core) | Done                    | `tests/architecture.test.ts` — 17 tests                                                                               |
| Documentation set                                      | Done                    | `docs/` (13 documents + 4 ADRs), root governance files, runnable `examples/`                                          |
| CI + release workflow definitions                      | Done (definitions only) | `.github/workflows/{ci,maintainerkit-readonly,maintainerkit-check-run,release}.yml`                                   |

**Test totals:** 352 tests, 351 passing, 1 skipped — the skip is the e2e placeholder that makes an
unbuilt-binary skip visible instead of silent. When the workspace is built, the 4 real e2e tests run.

Full pipeline result: `pnpm verify` (tests → build → typecheck → lint → format) plus `pnpm test:e2e`
— all green. `pnpm build` produces 28 tasks with no failures.

## Deliberately not done

| Item                                                            | Why                                                                                                          | What it needs                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| npm publication                                                 | External, irreversible, and the unscoped `maintainerkit` name belongs to another project                     | Human authorization, `@maintainerkit` scope registration, `NPM_TOKEN` |
| GitHub repository / org creation, Marketplace listing           | External actions                                                                                             | Human authorization                                                   |
| Enabling the release workflow's publish step                    | It ships as a dry run on purpose (ADR-0001, `GOVERNANCE.md`)                                                 | Maintainer decision after a release candidate is verified             |
| Live GitHub integration test against a real repository          | Would need a token and network in CI; the adapter is fully covered through fakes                             | A maintainer-run manual test before the first release                 |
| Docusaurus site                                                 | Plain Markdown in `docs/` renders on GitHub; a site build adds dependencies and a second copy of the content | A decision that a site is worth maintaining                           |
| Multi-provider AI beyond openai-compatible / anthropic / ollama | Diminishing value until the contract is exercised by users                                                   | A request with a concrete provider                                    |
| Web UI, auto-merge, auto-close, auto-label, comments            | Out of scope by design: the platform is read-only except for a gated check run (ADR-0004)                    | A new ADR, not a backlog item                                         |
| Adoption metrics, benchmark claims                              | Nothing has been adopted or benchmarked; inventing numbers would be dishonest                                | Real usage                                                            |

## Known limitations

- **Security posture from a local checkout is unknowable.** `MK-SEC-001`, `MK-AUD-008`, and `MK-AUD-009`
  return `skip` with a reason instead of guessing. Use `--repo owner/name` with a token.
- **`release` subject on the CLI.** `MK-REL-001` works through the engine and SDK; the CLI has no
  `--release <version>` flag yet (see `docs/ROADMAP.md`).
- **Issue rules.** `issues.*` is validated and carried in the snapshot, but no rule consumes it yet:
  `MK-PR-004` covers contributor requirements, and issue classification is advisory-only.
- **Windows.** Verified on Windows with Node 22.15; paths with spaces are handled through `file://` URLs.
  Linux is exercised by the CI definition, which has not yet run in a hosted environment.
- **Breaking-change detection in AI release notes** is prompt-level only; there is no deterministic
  semver inference.
- The Action bundle is committed by hand (`.gitignore` opts it back in). Changing Action source requires
  rebuilding and committing `dist/index.cjs`; CI does not check that the bundle is up to date.

## How this status was verified

```bash
corepack pnpm verify            # 351 passed, 1 skipped; 28 build tasks; lint and format clean
corepack pnpm test:e2e          # binary-level CLI tests
node packages/interfaces/cli/dist/bin.js validate
node packages/interfaces/cli/dist/bin.js check
node packages/interfaces/cli/dist/bin.js audit
node packages/interfaces/github-action/dist/index.cjs   # exits 2: no repository provided
```
