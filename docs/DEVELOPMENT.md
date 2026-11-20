# Development guide

## Requirements

- Node.js 22 or newer (see `.nvmrc`)
- pnpm 10 via corepack (`corepack pnpm …` works without a global install)
- git

## Setup

```bash
corepack pnpm install
corepack pnpm build
corepack pnpm test
```

## Workspace map

| Package                          | Responsibility                                        | May depend on                           |
| -------------------------------- | ----------------------------------------------------- | --------------------------------------- |
| `@maintainerkit/core`            | contracts, reports, errors, exit codes                | nothing                                 |
| `@maintainerkit/contribspec`     | schema, loader, validation, migration                 | core                                    |
| `@maintainerkit/policy-engine`   | 7 rules, registry, evaluator                          | core, contribspec                       |
| `@maintainerkit/audit`           | events, redaction, 9 health checks                    | core                                    |
| `@maintainerkit/workflow-engine` | check/audit orchestration, renderers                  | core, contribspec, policy-engine, audit |
| `@maintainerkit/git-integration` | local working tree adapter                            | core                                    |
| `@maintainerkit/github`          | Octokit read adapter, gated publisher                 | core                                    |
| `@maintainerkit/ai-core`         | provider contract, mock, validation, retries          | core                                    |
| `@maintainerkit/ai-providers`    | fetch adapters (openai-compatible, anthropic, ollama) | core, ai-core                           |
| `@maintainerkit/ai-prompts`      | injection-resistant prompt builders                   | core, ai-core                           |
| `@maintainerkit/ai-advisor`      | turns provider output into advisories                 | core, ai-core, ai-providers, ai-prompts |
| `@maintainerkit/cli`             | commands, output, exit codes                          | everything                              |
| `@maintainerkit/sdk`             | facade + stable re-exports                            | lower layers                            |
| `@maintainerkit/github-action`   | Action entrypoint (bundled)                           | lower layers                            |

`tests/architecture.test.ts` enforces the left column. If your change needs a new import direction, update
the ADR first — do not relax the test.

## Commands

```bash
corepack pnpm build             # turbo run build (topological)
corepack pnpm test              # vitest, all packages + root suites
corepack pnpm typecheck         # turbo run typecheck (no emit)
corepack pnpm lint              # eslint (flat config)
corepack pnpm format            # prettier --write
corepack pnpm format:check      # prettier --check
corepack pnpm test:e2e          # build, then run the CLI binary end-to-end
corepack pnpm verify            # build + typecheck + lint + tests + format check
```

Run a single package's tests:

```bash
corepack pnpm vitest run packages/policy-engine
corepack pnpm vitest run packages/ai/providers -t "openai-compatible"
```

## How the build works

- Every package builds with `tsc` (ESM, NodeNext, `.js` import specifiers).
- Turborepo builds dependencies first (`dependsOn: ["^build"]`); package `exports` point at `dist`.
- Vitest resolves `@maintainerkit/*` to `src` via aliases, so tests never need a build.
- The ContribSpec schema is embedded as TypeScript (`src/schema.generated.ts`) so bundling and publishing
  need no JSON asset. Regenerate with:

```bash
node packages/contribspec/scripts/generate-schema.mjs
```

This writes both the TS module and `schemas/contribspec-1.0.schema.json`. A test asserts they agree.

- The GitHub Action is bundled by esbuild into `packages/interfaces/github-action/dist/index.cjs` because a
  runner executes the checked-out file without installing dependencies. That one file is committed (see
  `.gitignore`); rebuild it with `corepack pnpm --filter @maintainerkit/github-action run build` after
  changing Action code, and commit the bundle in the same pull request.

## Testing philosophy

Cover behaviour, not lines. Every rule needs pass / fail / skip cases and at least one hostile input.
Every provider passes the same contract suite. GitHub is always mocked through `GitHubApiClient`; no test
touches the network. Security-relevant behaviour (redaction, gates, injection handling) has a dedicated
test in `tests/security.test.ts`.

Deterministic tests: inject `now` (`new Date("…")`), pass fixed snapshots, avoid `Date.now()` assertions.
Timing-sensitive tests (timeouts, retries) inject `sleep` where possible.

## Adding things

- **Rule:** `packages/policy-engine/src/rules/`, register in `rules/index.ts`, document in
  `docs/POLICY_RULES.md`, test in `packages/policy-engine/test`.
- **Health check:** `packages/audit/src/checks.ts`, document in `docs/AUDIT_CHECKS.md`.
- **ContribSpec field:** edit the JSON schema, regenerate, update `src/types.ts`, `resolve.ts` defaults,
  `docs/CONTRIBSPEC.md`, and add validation tests.
- **AI provider:** implement `AIProvider` with `fetch`, map errors, register in the factory, add the shared
  contract case, document in `docs/AI.md`.
- **CLI command:** add a file under `src/commands`, wire it in `program.ts`, document in `docs/CLI.md`, and
  add in-process tests with `createContext`.

## Releasing

1. Update `CHANGELOG.md` (Keep a Changelog) and the version in the affected packages.
2. `corepack pnpm verify`.
3. Commit, tag `vX.Y.Z`, push the tag.
4. `.github/workflows/release.yml` builds and verifies artifacts on the tag. **Publishing to npm happens
   only when a maintainer intentionally enables it** and the `NPM_TOKEN` secret exists; the workflow
   defaults to `--dry-run`. No package has been published yet.
5. Announce the release with the changelog entry and any breaking changes.

Reproducibility: the lockfile is committed, CI uses `--frozen-lockfile`, and release jobs rebuild from the
tag rather than from a working directory.

## Documentation

Documentation is plain Markdown in `docs/`, which renders on GitHub and in any editor. It is not a
separate site build: there is no docs generator to install, no build step to break, and no second copy of
the content to drift. Start at [docs/README.md](README.md).

## Troubleshooting

| Symptom                                    | Fix                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| `Cannot find module '@maintainerkit/core'` | `corepack pnpm build` (dist is missing)                                |
| Tests pass but the CLI does not            | rebuild; tests read `src`, the CLI reads `dist`                        |
| `ERR_PNPM_OUTDATED_LOCKFILE`               | `corepack pnpm install --no-frozen-lockfile`, then commit the lockfile |
| esbuild missing for the Action build       | `corepack pnpm install` (it is a dev dependency of the action package) |
