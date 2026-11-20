# MaintainerKit — Architecture

## 1. Layering

```
interfaces/            cli, github-action, sdk          (adapters, I/O, exit codes)
workflow-engine        orchestration: check / audit / report pipelines
  ├── policy-engine    deterministic rules over neutral snapshots
  ├── audit            event model, redaction, JSONL/Markdown sinks
  └── ai-core          optional advisory providers (never policy authority)
domain/core            provider-neutral contracts, report types, errors
contribspec            policy document: schema, loader, validation, migration
integrations           git (local FS) and github (Octokit) → core snapshots
```

Dependency rule (enforced by review and by `tests/architecture`):

- `core`, `contribspec`, `policy-engine` **must not** import `octokit`, `@maintainerkit/github`, or any AI package.
- `policy-engine` **must not** import `audit` or AI packages.
- Only `integrations/github` may import `octokit`.
- AI results are typed as `AdvisoryFinding`; policy results as `PolicyFinding`. They are never merged
  into the same field, and no rule may read AI output.

## 2. Neutral snapshot model (the key seam)

Every provider produces the same shapes, so the engine never sees a vendor API:

```ts
interface RepositorySnapshot {
  ref: RepositoryRef; // provider, owner, name, url, defaultBranch
  files: { path: string; sizeBytes?: number }[]; // presence + optional content
  readFile?(path: string): Promise<string | null>;
  metadata: { description?; licenseSpdx?; archived?; visibility?; topics? };
  security?: { dependencyAlerts?; secretScanning?; branchProtection?; requiredApprovals? };
}

interface PullRequestSnapshot {
  number;
  title;
  body?;
  author;
  authorAssociation?;
  baseRef;
  headRef;
  isFork;
  isDraft;
  state?;
  labels: string[];
  commits: { sha; message; signedOff }[];
  checks: { name; status; conclusion? }[];
  changedFiles: string[];
  additions?;
  deletions?;
}
```

`security` fields are `boolean | "unknown"`. Unknown never silently passes: it produces
`status: "skipped"` with an explicit reason, so a report never claims more certainty than it has.

## 3. ContribSpec and evaluation

```
maintainerkit.yml (YAML)
  → parse (yaml) → structural check (JSON Schema via Ajv 2020-12)
  → semantic check (cross-field invariants, version compatibility)
  → ResolvedConfig (defaults applied, policy version recorded)
  → policy-engine rules (pure, deterministic, no clock/network)
  → EvaluationReport { findings, summary, policyVersion, subject }
  → renderers: text | json | markdown; audit events; optional check run
```

Rules receive `RuleContext { spec, subject, options: { dryRun, now } }` and return
`{ ruleId, status: pass|fail|skip|error, severity, message, evidence[], remediation?, policyPath? }`.
`now` is injected, never read from the clock inside a rule, so tests are deterministic.

## 4. Exit codes

| Code | Meaning                                                                                |
| ---- | -------------------------------------------------------------------------------------- |
| 0    | Success; no finding at or above the failure threshold                                  |
| 1    | Policy findings at or above `--fail-on` (default `error`)                              |
| 2    | Usage, configuration, or validation error (bad flags, invalid/unsupported ContribSpec) |
| 3    | Execution/environment error (I/O, network, authentication, provider timeout)           |

Documents and tests use this table as the single source of truth.

## 5. Reports

Stable JSON envelope (`schemaVersion: "1"`) with `kind: "check" | "audit" | "report"`. Consumers can
depend on it; additive fields are non-breaking, renames are not.

## 6. AI boundary

`ai-core` defines `AIProvider`, `AIRequest`, `AIResult`, `AICapability`, a registry, retries/timeouts,
and a mock provider. Adapters (`openai-compatible`, `anthropic`, `ollama`) are `fetch`-based and live in
`ai-providers`. All responses must validate against a JSON Schema; invalid output is a typed failure,
never a partial success. Untrusted repository text is wrapped as data, truncated, and stripped of
control markers; prompts state that embedded instructions must be ignored. Nothing an AI returns can
change a policy result, and any mutating follow-up requires explicit human approval.

## 7. Testing strategy

- Unit tests per package (rules, validation, redaction, retry logic).
- Contract tests shared by all AI providers (in-memory `fetch` double).
- GitHub tests with mocked Octokit (`nock`-free; injected client interface) — no network.
- CLI tests via in-process command execution plus one built-binary smoke test.
- Architecture test that greps imports to enforce the dependency rule.
- Security tests: secret redaction, fork PR handling, injection-shaped AI responses, config fuzzing.
