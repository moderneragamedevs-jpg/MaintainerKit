# Report format

Reports are the stable artifact of a run. CLI, GitHub Action, and SDK all produce the same envelope, so
anything that reads one reads all three.

## Stability

- `schemaVersion` is `"1"`. Within version 1, fields are added but never renamed or removed.
- Findings keep `ruleId` and `id` stable across runs for the same subject, which makes reports diffable.
- Consumers should ignore unknown fields.

## Envelope

```ts
interface ReportEnvelope {
  schemaVersion: "1";
  kind: "check" | "audit";
  generatedAt: string; // ISO-8601
  tool: { name: "maintainerkit"; version: string };
  policyVersion: { specVersion: string | null }; // null for audits
  subject: {
    kind: "repository" | "pull_request" | "release";
    label: string; // e.g. "acme/widget#42"
    repository: RepositoryRef; // provider, owner, name, url?, defaultBranch?
    pullRequestNumber?: number;
  };
  summary: ReportSummary;
  findings: PolicyFinding[]; // deterministic
  advisories: AdvisoryFinding[]; // AI, never authoritative
  diagnostics: Diagnostic[]; // config and runtime notes, not findings
  audit?: { eventLogPath?: string; eventCount: number };
}
```

### Summary

```ts
interface ReportSummary {
  total: number;
  pass: number;
  fail: number;
  skip: number;
  error: number; // rules that could not run
  bySeverity: { info: number; warning: number; error: number };
  status: "pass" | "fail";
  worstSeverity?: "info" | "warning" | "error";
  advisoryCount: number;
}
```

`status` is computed from policy findings only: a `fail` at or above the threshold, or any `error`,
makes it `fail`. Advisories are counted for visibility and can never change it.

### Finding

```ts
interface PolicyFinding {
  id: string; // "<ruleId>:<subjectKey>[#n]"
  ruleId: string; // e.g. "MK-PR-001"
  ruleTitle: string;
  status: "pass" | "fail" | "skip" | "error";
  severity: "info" | "warning" | "error";
  message: string;
  evidence: { label: string; value: string }[];
  remediation?: string;
  policyPath?: string; // JSON Pointer into ContribSpec
  docsUrl?: string;
  subjectKind: "repository" | "pull_request" | "release";
}
```

### Advisory

```ts
interface AdvisoryFinding {
  id: string;
  capability: string; // e.g. "risk-analysis"
  provider: string; // e.g. "ollama"
  model: string;
  promptVersion: string; // prompt contract version
  title: string;
  summary: string;
  confidence?: number; // 0..1, only when the model reports it
  items?: { label: string; detail: string }[];
  createdAt: string;
}
```

Advisories have no `status` and no `severity`. That is intentional: a suggestion must never be
mistaken for a verdict.

## Example (abbreviated)

```json
{
  "schemaVersion": "1",
  "kind": "check",
  "generatedAt": "2026-01-02T03:04:05.000Z",
  "tool": { "name": "maintainerkit", "version": "0.1.0" },
  "policyVersion": { "specVersion": "1.0" },
  "subject": {
    "kind": "pull_request",
    "label": "acme/widget#42",
    "repository": {
      "provider": "github",
      "owner": "acme",
      "name": "widget",
      "defaultBranch": "main"
    },
    "pullRequestNumber": 42
  },
  "summary": {
    "total": 6,
    "pass": 3,
    "fail": 1,
    "skip": 2,
    "error": 0,
    "bySeverity": { "info": 0, "warning": 0, "error": 4 },
    "status": "fail",
    "worstSeverity": "error",
    "advisoryCount": 0
  },
  "findings": [
    {
      "id": "MK-PR-001:pr-42",
      "ruleId": "MK-PR-001",
      "ruleTitle": "Pull request title follows the configured convention",
      "status": "fail",
      "severity": "error",
      "message": "Title \"Update stuff\" is not a Conventional Commits title.",
      "evidence": [{ "label": "title", "value": "Update stuff" }],
      "remediation": "Use \"<type>(<scope>): <subject>\" with a type from: feat, fix, docs, …",
      "policyPath": "/pullRequests/title",
      "docsUrl": "docs/POLICY_RULES.md#mk-pr-001--pull-request-title",
      "subjectKind": "pull_request"
    }
  ],
  "advisories": [],
  "diagnostics": []
}
```

## Redaction

Reports pass through the redaction layer before they are returned, so a token that appeared in a PR
title, commit message, or file path is replaced with `***REDACTED***` in `message`, `evidence`,
`remediation`, and diagnostics. Markdown rendering additionally escapes HTML so repository text cannot
inject markup into a comment or check run.

## Rendering

| Format   | Function                          | Use                                                            |
| -------- | --------------------------------- | -------------------------------------------------------------- |
| text     | `renderText(report, { verbose })` | terminal and CI logs: no colour, no emoji, stable under `diff` |
| markdown | `renderMarkdown(report)`          | comments, job summaries, saved reports                         |
| json     | `renderJson(report)`              | machine consumption                                            |

`buildCheckRunContent(report)` derives a GitHub check run: a short public summary, up to 20 findings with
remediation, and a `success`/`failure` conclusion taken from `summary.status`.

## Audit trail

`--audit-log <file>` appends one redacted JSON object per event:

```json
{
  "id": "evt_…",
  "timestamp": "2026-01-02T03:04:05.000Z",
  "type": "policy.evaluated",
  "status": "failure",
  "actor": { "kind": "cli" },
  "repository": { "provider": "github", "owner": "acme", "name": "widget" },
  "policyVersion": "1.0",
  "output": {
    "status": "fail",
    "findings": 6,
    "failed": 1,
    "bySeverity": { "info": 0, "warning": 0, "error": 4 }
  },
  "metadata": { "rules": "MK-REPO-001,MK-PR-001,…", "fork": true }
}
```

Event types: `run.started`, `validation.completed`, `policy.evaluated`, `audit.completed`, `ai.requested`,
`ai.completed`, `ai.failed`, `write.requested`, `write.blocked`, `run.completed`, `run.failed`.
`maintainerkit report --audit-log <file>` renders the same trail as a table or timeline.
