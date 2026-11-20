import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ConfigError,
  ExecutionError,
  ExitCode,
  UsageError,
  type ReportEnvelope,
} from "@maintainerkit/core";
import { JsonlAuditSink, formatAuditEvent, type AuditEvent } from "@maintainerkit/audit";
import type { CliContext } from "../context.js";
import { type OutputFormat } from "../output.js";
import { emitReport } from "../write.js";
import { resolveFormatFlag } from "./audit.js";

export interface ReportCommandOptions {
  input?: string;
  auditLog?: string;
  format?: string;
  output?: string;
  verbose?: boolean;
  json?: boolean;
}

function assertReportShape(value: unknown, path: string): ReportEnvelope {
  if (!value || typeof value !== "object") {
    throw new ConfigError(
      `${path} is not a MaintainerKit report (expected a JSON object).`,
      "report/invalid",
    );
  }
  const report = value as Partial<ReportEnvelope>;
  if (report.kind !== "check" && report.kind !== "audit") {
    throw new ConfigError(
      `${path} is not a MaintainerKit report (missing or unknown "kind").`,
      "report/invalid",
      'Expected "check" or "audit".',
    );
  }
  if (!Array.isArray(report.findings) || !report.summary || !report.subject) {
    throw new ConfigError(
      `${path} is missing required report fields (findings, summary, subject).`,
      "report/invalid",
    );
  }
  return report as ReportEnvelope;
}

function renderEventTimeline(events: readonly AuditEvent[], format: OutputFormat): string {
  if (format === "json") return `${JSON.stringify({ events }, null, 2)}\n`;
  if (format === "markdown") {
    const lines = [
      "## MaintainerKit audit trail",
      "",
      "| Timestamp | Type | Status | Detail |",
      "| --- | --- | --- | --- |",
    ];
    for (const event of events) {
      const detail = [
        event.repository
          ? `${event.repository.owner ?? ""}/${event.repository.name}`.replace(/^\//, "")
          : "",
        event.policyVersion ? `policy ${event.policyVersion}` : "",
        event.output ? `${event.output.findings} finding(s), ${event.output.failed} failed` : "",
        event.provider ? `provider ${event.provider.id}` : "",
      ]
        .filter(Boolean)
        .join("; ");
      lines.push(`| ${event.timestamp} | ${event.type} | ${event.status} | ${detail} |`);
    }
    return `${lines.join("\n")}\n`;
  }

  const lines = [`MaintainerKit audit trail (${events.length} event(s))`, ""];
  for (const event of events) lines.push(`  ${formatAuditEvent(event)}`);
  if (events.length === 0) lines.push("  (no events)");
  return `${lines.join("\n")}\n`;
}

/**
 * Re-renders a saved report, or prints an audit trail.
 *
 * Reports are the stable artifact: CI saves the JSON and humans render Markdown from it later, so
 * formatting changes never require re-running the checks.
 */
export async function runReportCommand(
  context: CliContext,
  options: ReportCommandOptions,
): Promise<number> {
  const format = resolveFormatFlag(options);

  if (!options.input && !options.auditLog) {
    throw new UsageError(
      "report needs --input <report.json> or --audit-log <audit.jsonl>.",
      "Generate a report first: maintainerkit check --format json --output report.json",
    );
  }

  if (options.input && options.auditLog) {
    throw new UsageError(
      "Use either --input or --audit-log, not both.",
      "Re-render a report with --input, or inspect events with --audit-log.",
    );
  }

  if (options.input) {
    const path = resolve(context.cwd, options.input);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      throw new ExecutionError(
        `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
        "report/unreadable",
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ConfigError(
        `${path} is not valid JSON.`,
        "report/invalid-json",
        "Pass a report written with --format json.",
      );
    }

    const report = assertReportShape(parsed, path);
    await emitReport(context, report, {
      format,
      ...(options.output ? { output: options.output } : {}),
      ...(options.verbose === undefined ? {} : { verbose: options.verbose }),
    });
    // Rendering is not evaluation: the verdict travels in the report, not in this exit code.
    return ExitCode.Success;
  }

  const path = resolve(context.cwd, options.auditLog as string);
  const events = await new JsonlAuditSink(path).read();
  const rendered = renderEventTimeline(events, format);
  context.out(rendered);
  // An empty or missing trail is not an error condition for a reporting command.
  return ExitCode.Success;
}

export { assertReportShape, renderEventTimeline };
