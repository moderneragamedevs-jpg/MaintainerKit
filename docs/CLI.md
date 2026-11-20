# Command-line interface

The CLI works with no AI provider, no GitHub token, and no network access for local commands.

```bash
maintainerkit <command> [options]
```

## Commands

| Command    | Purpose                                                    | Needs a ContribSpec?    | Needs a token?       |
| ---------- | ---------------------------------------------------------- | ----------------------- | -------------------- |
| `init`     | Create a policy document and a read-only CI workflow       | No                      | No                   |
| `validate` | Validate the document (schema + semantics)                 | Yes (must exist)        | No                   |
| `doctor`   | Diagnose the environment                                   | No (reports if missing) | No (unless `--repo`) |
| `audit`    | Repository health checks                                   | No                      | Only with `--repo`   |
| `check`    | Evaluate policies                                          | Yes                     | Only with `--repo`   |
| `report`   | Re-render a saved report or audit trail                    | No                      | No                   |
| `explain`  | Explain rules, findings, exit codes, reports, AI, security | No                      | No                   |

## Exit codes

| Code | Meaning                                                                        |
| ---- | ------------------------------------------------------------------------------ |
| `0`  | Success: no finding at or above the failure threshold                          |
| `1`  | Policy failure: findings at or above `--fail-on` (default `error`)             |
| `2`  | Usage or configuration error: bad flags, invalid or unsupported ContribSpec    |
| `3`  | Execution or environment error: I/O, network, authentication, provider timeout |

A rule that crashes produces an `error` finding and fails the run: a run that could not check
everything must not report success. `explain exit-codes` prints the same table.

## `init`

```bash
maintainerkit init [directory] [--config <file>] [--strict] [--force] [--no-workflow]
```

Creates `maintainerkit.yml` (commented, validated, AI disabled) and `.github/workflows/maintainerkit.yml`
(read-only, `pull_request`, `contents: read`). Never overwrites without `--force`; never runs `git init`.

`--strict` enables DCO sign-off, issue templates, and the GitHub security checks.

## `validate`

```bash
maintainerkit validate [path] [--config <file>] [--json]
```

Prints every error with a JSON Pointer (`/pullRequests/title/maxLength`) and a hint. Warnings do not
change the exit code.

`--json` payload:

```json
{
  "valid": true,
  "path": "/repo/maintainerkit.yml",
  "policyVersion": "1.0",
  "checksum": "sha256:881166e0480f6a59",
  "diagnostics": [
    {
      "severity": "warning",
      "code": "contribspec/newer-minor",
      "message": "…",
      "path": "/specVersion"
    }
  ],
  "rulesEnabled": 7
}
```

## `doctor`

```bash
maintainerkit doctor [--json] [--repo owner/name] [--offline]
```

Checks: Node.js version, policy document presence and validity, git working tree, `GITHUB_TOKEN`
presence (**never** the value), AI configuration, and the write gate. With `--repo` and a token it also
verifies API access. Exits `2` for an invalid configuration, `3` for an unsupported runtime, `0`
otherwise.

## `audit`

```bash
maintainerkit audit [--path <dir>] [--repo owner/name] [--ref <ref>]
                    [--format text|json|markdown] [--output <file>]
                    [--audit-log <file>] [--verbose] [--json]
```

Nine documented checks ([AUDIT_CHECKS.md](AUDIT_CHECKS.md)). Exits `1` when an error-severity check
fails.

## `check`

```bash
maintainerkit check [--path <dir>] [--repo owner/name] [--ref <ref>] [--pr <number>]
                    [--config <file>] [--fail-on info|warning|error]
                    [--format text|json|markdown] [--output <file>] [--audit-log <file>]
                    [--dry-run] [--verbose]
                    [--ai] [--provider <id>] [--model <name>] [--ai-timeout <seconds>]
```

- Without `--pr`: evaluates the rules that apply to a repository.
- With `--pr` (requires `--repo`): evaluates pull-request rules for that PR.
- `--dry-run`: reports only. The CLI never writes to GitHub, so this is a statement of intent for
  pipelines; it also prints that no write was attempted.
- `--ai`: enables advisories for this run. Without a provider, the report gains a warning diagnostic and
  the verdict is unchanged.
- `--fail-on warning`: makes warning-severity findings fail the run.

## `report`

```bash
maintainerkit report --input <report.json>      # re-render a report
maintainerkit report --audit-log <audit.jsonl>  # summarise an audit trail
                    [--format text|json|markdown] [--output <file>] [--verbose]
```

`report` renders; it does not re-evaluate. Its exit code is `0` when rendering succeeds — the verdict is
inside the report. Exactly one of `--input`/`--audit-log` is required.

## `explain`

```bash
maintainerkit explain                       # list rules
maintainerkit explain --rule MK-PR-001      # one rule, with the effective severity from config
maintainerkit explain exit-codes            # exit code table
maintainerkit explain reports               # report contract
maintainerkit explain ai                    # AI guarantees
maintainerkit explain security              # security boundaries
maintainerkit explain --input report.json --finding 'MK-REPO-001:repository#1'
```

Finding ids come from the report itself (`findings[].id`). A repository-level rule evaluated against a local
path yields ids like `MK-REPO-001:repository#1`; a pull-request rule yields `MK-PR-001:pr-42`. If an id is
wrong, `explain` lists the ids that do exist instead of failing silently.

This is how a user answers "why did this fail?" without reading source code.

## Global behaviour

- `--help` and `--version` exit `0`.
- `--json` is shorthand for `--format json`.
- In JSON mode, stdout contains **only** JSON; progress and notes go to stderr, so
  `maintainerkit check --json | jq .` always works.
- All output is redacted: a token that appears in a PR title never reaches the terminal.
- Unknown flags and commands exit `2` with a suggestion.

## Recipes

**Local pre-push check**

```bash
maintainerkit validate && maintainerkit check --fail-on warning
```

**CI gate with an artifact**

```bash
maintainerkit check --repo "$GITHUB_REPOSITORY" --pr "$PR" \
  --format json --output maintainerkit-report.json \
  --audit-log maintainerkit-audit.jsonl
```

**Render a saved report for a human**

```bash
maintainerkit report --input maintainerkit-report.json --format markdown
```

**Explain a failure from a downloaded report**

```bash
maintainerkit explain --input maintainerkit-report.json --finding 'MK-PR-003:pr-42'
```

Use the ids printed in the report; `explain` suggests the available ids when one does not match.

**Advisories with a local model**

```bash
maintainerkit check --repo acme/widget --pr 42 --ai --provider ollama --model llama3.1
```
