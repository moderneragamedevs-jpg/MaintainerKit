import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ConfigError,
  ExitCode,
  UsageError,
  type PolicyFinding,
  type ReportEnvelope,
} from "@maintainerkit/core";
import { findConfigFile } from "@maintainerkit/contribspec";
import { explainRule, listRules } from "@maintainerkit/policy-engine";
import type { CliContext } from "../context.js";
import { requireConfig } from "../config.js";

export interface ExplainOptions {
  rule?: string;
  topic?: string;
  input?: string;
  finding?: string;
}

const EXIT_CODES = `Exit codes
  0  success: no finding at or above the failure threshold
  1  policy failure: findings at or above --fail-on (default: error)
  2  usage or configuration error: bad flags, invalid or unsupported ContribSpec
  3  execution or environment error: I/O, network, authentication, provider timeout

The threshold is set with --fail-on info|warning|error. Rule errors (a rule that crashes) always
fail the run, because a run that could not check everything must not report success.`;

const REPORT_SCHEMA = `Report format (schemaVersion "1")
  kind            "check" | "audit"
  subject         kind, label, repository identity, pullRequestNumber (when applicable)
  policyVersion   { specVersion } — null for audits, which use no policy document
  summary         pass/fail/skip/error counts, bySeverity, status, advisoryCount
  findings        deterministic policy results (ruleId, status, severity, evidence, remediation)
  advisories      AI suggestions, always separate, never counted in summary.status
  diagnostics     configuration and runtime notes that are not findings

Why two arrays: a policy decision must be reproducible and explainable. An AI suggestion cannot be
either, so it can never share a field with a policy result (ADR-0002).`;

const AI_TOPIC = `AI in MaintainerKit
  Optional. Disabled by default. All policy checks work without a provider.

  Providers: mock (offline), ollama (local), openai-compatible, anthropic.
  Configure: ai.enabled: true and ai.capabilities: [...] in ContribSpec, then pass --provider
  or set MAINTAINERKIT_AI_PROVIDER.

  Guarantees:
    - output is validated against a closed JSON Schema; invalid output is discarded whole
    - AI results are advisories: they never change a policy verdict, exit code, or check conclusion
    - repository text is treated as untrusted data, capped, and stripped of role markers
    - no AI provider can perform an operation; mutating operations require a human gate`;

const SECURITY_TOPIC = `Security model (summary)
  Trust boundaries:
    - repository content (titles, bodies, file contents, commits) is untrusted data
    - AI output is untrusted data
    - policy evaluation and write authorization are outside any model

  Defaults:
    - GitHub access is read-only; the one write operation (publishing a check run) requires both
      checks: write and MAINTAINERKIT_ALLOW_WRITE=true
    - the GitHub Action runs on pull_request, never pull_request_target, and never checks out
      untrusted head code
    - secrets are redacted at every sink

  Full model: docs/SECURITY_MODEL.md`;

const TOPICS: Record<string, string> = {
  "exit-codes": EXIT_CODES,
  reports: REPORT_SCHEMA,
  ai: AI_TOPIC,
  security: SECURITY_TOPIC,
};

function renderRules(context: CliContext): number {
  const rules = listRules();
  context.out(`MaintainerKit rules (${rules.length})\n\n`);

  // Widths come from the data: a fixed padding silently misaligns whenever a rule applies to more
  // subjects than the author expected.
  const idWidth = Math.max(2, ...rules.map((rule) => rule.id.length));
  const severityWidth = Math.max(8, ...rules.map((rule) => rule.defaultSeverity.length));
  const appliesWidth = Math.max(10, ...rules.map((rule) => rule.appliesTo.join(", ").length));

  context.out(
    `  ${"ID".padEnd(idWidth)}  ${"Severity".padEnd(severityWidth)}  ${"Applies to".padEnd(appliesWidth)}  Title\n`,
  );
  for (const rule of rules) {
    context.out(
      `  ${rule.id.padEnd(idWidth)}  ${rule.defaultSeverity.padEnd(severityWidth)}  ${rule.appliesTo.join(", ").padEnd(appliesWidth)}  ${rule.title}\n`,
    );
  }
  context.out("\nRun `maintainerkit explain --rule MK-PR-001` for details.\n");
  return ExitCode.Success;
}

async function renderFinding(
  context: CliContext,
  input: string,
  findingId: string,
): Promise<number> {
  const path = resolve(context.cwd, input);
  let report: ReportEnvelope;
  try {
    report = JSON.parse(await readFile(path, "utf8")) as ReportEnvelope;
  } catch (error) {
    throw new ConfigError(
      `Could not read report ${path}: ${error instanceof Error ? error.message : String(error)}`,
      "explain/unreadable-report",
    );
  }

  const finding = [...(report.findings ?? []), ...(report.advisories ?? [])].find(
    (entry) =>
      (entry as PolicyFinding).id === findingId || (entry as { id?: string }).id === findingId,
  );

  if (!finding) {
    throw new UsageError(
      `No finding with id "${findingId}" in ${path}.`,
      `Available ids: ${
        (report.findings ?? [])
          .map((entry) => entry.id)
          .slice(0, 10)
          .join(", ") || "(none)"
      }`,
    );
  }

  const typed = finding as PolicyFinding;
  context.out(`Finding ${findingId}\n\n`);
  context.out(`  rule:        ${typed.ruleId ?? "(advisory)"}\n`);
  if (typed.ruleTitle) context.out(`  title:       ${typed.ruleTitle}\n`);
  if (typed.status) context.out(`  status:      ${typed.status}\n`);
  if (typed.severity) context.out(`  severity:    ${typed.severity}\n`);
  if (typed.message) context.out(`  message:     ${typed.message}\n`);
  if (typed.policyPath) context.out(`  policy path: ${typed.policyPath}\n`);
  if (typed.evidence?.length) {
    context.out("  evidence:\n");
    for (const evidence of typed.evidence)
      context.out(`    - ${evidence.label}: ${evidence.value}\n`);
  }
  if (typed.remediation) context.out(`  remediation: ${typed.remediation}\n`);
  if (typed.docsUrl) context.out(`  docs:        ${typed.docsUrl}\n`);
  return ExitCode.Success;
}

/**
 * Explains rules, report shape, exit codes, and individual findings.
 *
 * `explain` is the answer to "why did this fail?" without reading source code, which is the whole
 * point of a deterministic policy engine.
 */
export async function runExplainCommand(
  context: CliContext,
  options: ExplainOptions,
): Promise<number> {
  if (options.finding) {
    if (!options.input) {
      throw new UsageError(
        "--finding needs --input <report.json>.",
        "Point at the report that contains the finding.",
      );
    }
    return renderFinding(context, options.input, options.finding);
  }

  if (options.rule) {
    const configPath = await findConfigFile(context.cwd);
    const config = configPath ? await requireConfig(context, configPath) : undefined;
    let explanation;
    try {
      explanation = explainRule(options.rule, config?.resolved);
    } catch {
      throw new UsageError(
        `Unknown rule "${options.rule}".`,
        `Known rules: ${listRules()
          .map((rule) => rule.id)
          .join(", ")}.`,
      );
    }

    context.out(`${explanation.id} — ${explanation.title}\n\n`);
    context.out(`  ${explanation.description}\n\n`);
    context.out(`  applies to:        ${explanation.appliesTo.join(", ")}\n`);
    context.out(`  default severity:  ${explanation.defaultSeverity}\n`);
    context.out(
      `  effective severity:${" "}${explanation.effectiveSeverity}${explanation.enabled ? "" : " (disabled by configuration)"}\n`,
    );
    context.out(`  policy path:       ${explanation.policyPath}\n`);
    context.out(`  how to fix:        ${explanation.remediationHint}\n`);
    context.out(`  docs:              ${explanation.docsUrl}\n`);
    return ExitCode.Success;
  }

  const topic = options.topic;
  if (topic) {
    const body = TOPICS[topic];
    if (!body) {
      throw new UsageError(
        `Unknown topic "${topic}".`,
        `Available topics: ${Object.keys(TOPICS).join(", ")}.`,
      );
    }
    context.out(`${body}\n`);
    return ExitCode.Success;
  }

  return renderRules(context);
}
