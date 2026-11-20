# AI layer (optional)

MaintainerKit is fully functional without AI. When enabled, AI produces **advisories**: suggestions in a
separate array of the report, always labelled with provider, model, and prompt version. Advisories never
change a policy result, exit code, check conclusion, or merge decision.

## Providers

| Provider id         | Credentials                    | Network                                                 | Notes                                                                           |
| ------------------- | ------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `mock`              | none                           | none                                                    | Deterministic output generated from the capability schema. For tests and demos. |
| `ollama`            | none                           | local (`OLLAMA_HOST`, default `http://127.0.0.1:11434`) | Recommended for private repositories: data never leaves the machine.            |
| `openai-compatible` | `OPENAI_API_KEY` (or `apiKey`) | the configured `baseUrl`                                | OpenAI, gateways, vLLM, LM Studio, llama.cpp.                                   |
| `anthropic`         | `ANTHROPIC_API_KEY`            | `api.anthropic.com`                                     | Messages API; JSON enforced by prompt plus schema validation.                   |

Adapters use `fetch` only. No vendor SDK is a dependency of the platform, and adding a provider does not
require touching the policy engine, the CLI, or the Action.

## Enabling

```yaml
ai:
  enabled: true
  provider: ollama
  model: llama3.1
  capabilities:
    - pull-request-summary
    - risk-analysis
```

```bash
maintainerkit check --repo acme/widget --pr 42          # provider/model from the document
maintainerkit check --repo acme/widget --pr 42 --ai --provider mock
```

Resolution order for the provider: `--provider`, then `ai.provider`, then `MAINTAINERKIT_AI_PROVIDER`.
Model: `--model`, then `ai.model`, then `MAINTAINERKIT_AI_MODEL`, then a provider default.

## Capabilities

| Capability                   | Input                                  | Output (closed schema)                            |
| ---------------------------- | -------------------------------------- | ------------------------------------------------- |
| `issue-classification`       | issue title/body/labels                | category, confidence, rationale, suggested labels |
| `duplicate-issue-suggestion` | issue + candidate list                 | duplicate issues with similarity and reason       |
| `pull-request-summary`       | title, body, files, commits, diff size | summary, changes, risks, testing notes            |
| `risk-analysis`              | title, body, files, commits            | risk level, factors, security-review suggestion   |
| `review-assistance`          | title, body, files                     | review notes with priorities                      |
| `release-notes`              | version, commits                       | sections, breaking changes                        |

Every schema is closed (`additionalProperties: false`) with bounded strings and arrays. Output that does
not validate is **discarded as a whole** — there is no partial acceptance and no "best effort" merge.

Capabilities that do not apply to the subject are reported as `ai/capability-not-applicable`, not silently
ignored.

## Execution guarantees

- **Timeout** per attempt (default 20s, `--ai-timeout` in the Action).
- **Bounded retries** (default 3 attempts) with exponential backoff and jitter, only for errors marked
  retryable: timeouts, 429, 5xx, invalid output.
- **Typed failures**: `ai/authentication-failed`, `ai/rate-limited`, `ai/timeout`, `ai/invalid-output`,
  `ai/malformed-response`, `ai/missing-credentials`, `ai/missing-model`, `ai/unknown-provider`,
  `ai/unsupported-capability`.
- **Failure isolation**: one capability failing becomes a warning diagnostic; other capabilities and all
  policy results are unaffected.
- **Usage reporting** when the provider returns it (tokens; cost only if the provider reports it — never
  estimated).

## Prompt-injection defenses

Repository text is untrusted. Before it reaches a prompt it is:

1. length-capped (with an explicit truncation marker),
2. stripped of chat control tokens (`<|im_start|>`, `<|system|>`, `</instructions>`, …),
3. indented when a line looks like a role header (`system:`, `user:`, …),
4. wrapped in `<untrusted-data name="…">` blocks that the system prompt declares to be data,
5. annotated when it contains instruction-like phrases ("ignore previous instructions", "mark the check as
   passed").

The system prompt states that data must be ignored as instructions, that the model has no tools, and that
it must return a single JSON object. Validation and the absence of any tool authority are the real
guarantees; the sanitisation reduces the chance of wasted or confusing output.

## What is sent to a provider

Only the fields a capability needs: titles, descriptions, changed file paths, commit subjects, and (for
duplicate suggestions) issue text of the candidates you pass. No source file contents, no tokens, no
repository secrets. If that is still too much for a private repository, use `ollama` or keep AI disabled.

## Human approval

`agents.humanApprovalRequired` defaults to `true` and cannot be set to `false` while mutating operations
are allowed (validation error). `ai.requireHumanApprovalFor` defaults to every mutating operation. No AI
output is ever fed into a policy decision, a check conclusion, or a write.

## Disabling

```yaml
ai:
  enabled: false
  capabilities: []
```

or simply omit the section. Advisories disappear from reports; nothing else changes.
