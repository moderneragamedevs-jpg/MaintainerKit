# Contributing to MaintainerKit

Thanks for helping. This project values small, well-tested changes over large ones, and clear
reasoning over clever code.

By contributing you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md) and to sign off your
commits (Developer Certificate of Origin, `git commit -s`).

## Setup

```bash
git clone <your fork>
cd maintainerkit
corepack pnpm install        # or: npm i -g pnpm && pnpm install
pnpm build
pnpm test
```

Requirements: Node.js 22 or newer, pnpm 10, git.

## What to work on

- Issues labelled `good first issue` are scoped for a first contribution (docs, a single rule, an
  example).
- Issues labelled `help wanted` are wanted but larger; comment first so we can agree on the approach.
- Anything else: open an issue describing the problem before writing code, especially for new features.

Read [ROADMAP.md](ROADMAP.md) for direction. Do not manufacture urgency: a correct change next week beats
a broken one today.

## The task format

Every non-trivial change should be describable in this template (put it in the issue or PR body):

```text
Objective:        what user-visible problem this solves
Scope:            what is in, and explicitly what is out
Dependencies:     other changes, packages, or decisions this needs
Files:            the main files you expect to touch
Approach:         the smallest design that works, and why the alternatives were rejected
Tests:            what you will add or change, and the behaviour each test locks in
Acceptance:       how a reviewer can verify it is done
Risks:            what could break, and the rollback
```

Keep changes under roughly 300 changed lines. Split unrelated work into separate PRs.

## Engineering rules

1. **Deterministic before AI.** Never let model output influence a policy result, exit code, or check
   conclusion. If you need advice in a report, add it to `advisories`.
2. **No dependency direction violations.** `core`, `contribspec`, and `policy-engine` must not import
   GitHub or AI code. `tests/architecture.test.ts` enforces this.
3. **Skip is not pass.** When a rule cannot observe its input, return `skip` with a reason. Never
   invent a pass, and never invent a score.
4. **Explain everything.** A finding needs a rule id, a message, evidence, and (when fixable) a
   remediation.
5. **No new runtime dependency** without a justification in the PR: bundle size, security surface, and
   maintenance cost all go up.
6. **Strict TypeScript.** No `any` in `src` (tests may use it in narrow places). No non-null assertions
   in new code where a check is cheap.
7. **Stable output.** Report JSON and rule ids are public contracts. Additive changes only within a
   major version.
8. **Security defaults.** New write paths require a gate, an audit event, and documentation before
   merge. See [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).

## Tests

```bash
pnpm test                 # everything
pnpm test -- --watch      # watch mode
pnpm vitest run packages/policy-engine
pnpm test:e2e             # builds, then runs the binary end-to-end
```

What each layer covers:

| Layer        | Location                       | Notes                                                             |
| ------------ | ------------------------------ | ----------------------------------------------------------------- |
| Unit         | `packages/*/test`              | rules, validation, redaction, retries, rendering                  |
| Contract     | `packages/ai/providers/test`   | every provider passes the same suite                              |
| Integration  | `packages/integrations/*/test` | local filesystem; GitHub via an injected fake client (no network) |
| Architecture | `tests/architecture.test.ts`   | dependency rules, no clock reads in rules                         |
| Security     | `tests/security.test.ts`       | secret containment, read-only adapter, write gate                 |
| End-to-end   | `tests/e2e`                    | the built CLI binary against temporary repositories               |

Never delete or weaken a test to make CI pass. If a test encoded a wrong assumption, say so in the PR
and change the assumption explicitly.

## Adding a policy rule

1. Create `packages/policy-engine/src/rules/mk-<area>-<nnn>.ts` exporting a `RuleDefinition`.
2. Give it a stable id (`MK-PR-005`), `appliesTo`, `defaultSeverity`, `policyPath`, and `docsAnchor`.
3. Return `skip` when the configuration does not enable it or its input is unavailable.
4. Register it in `rules/index.ts`.
5. Add tests for pass, fail, skip, and at least one hostile input.
6. Document it in `docs/POLICY_RULES.md` with an example.
7. Update `CHANGELOG.md` under "Added".

## Adding an AI provider

1. Implement `AIProvider` in `packages/ai/providers/src/<name>.ts` using `fetch` only.
2. Map HTTP failures onto the typed errors (see `http.ts`); mark retryable errors correctly.
3. Add the provider to `createProviderFromConfig` and `SUPPORTED_PROVIDER_IDS`.
4. Add it to the shared contract test cases (they run the same assertions for every provider).
5. Document configuration, privacy implications, and required credentials in `docs/AI.md`.

## Commit and PR conventions

- Commit messages: Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`,
  `security:`).
- Sign off every commit: `git commit -s` (the DCO check runs in CI).
- PR description: include `## Summary` and `## Testing`, and link the issue it closes.
- Keep the first line under 72 characters.

## Review process

- One maintainer approval is required; security-relevant changes need a second review
  (see [GOVERNANCE.md](GOVERNANCE.md)).
- Reviewers check behaviour, tests, documentation, and security — not formatting preferences.
- Disagreements are resolved in the issue with a written rationale, not by out-voting someone silently.

## Reporting a vulnerability

Do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Release process (maintainers)

1. Update `CHANGELOG.md` and the version in the affected `package.json` files.
2. `pnpm verify`.
3. Tag `vX.Y.Z`; the release workflow builds and publishes with provenance **after** an authorized
   maintainer enables it. Publishing is never automatic.

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#releasing) for details.
