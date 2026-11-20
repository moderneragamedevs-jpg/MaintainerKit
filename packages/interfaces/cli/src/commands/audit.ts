import { resolve } from "node:path";
import { ExitCode, UsageError } from "@maintainerkit/core";
import { JsonlAuditSink } from "@maintainerkit/audit";
import { runAudit as runAuditWorkflow } from "@maintainerkit/workflow-engine";
import type { CliContext } from "./../context.js";
import { isOutputFormat, type OutputFormat } from "./../output.js";
import { emitReport } from "./../write.js";
import { resolveSource } from "./../sources.js";

export interface AuditCommandOptions {
  path?: string;
  repo?: string;
  ref?: string;
  format?: string;
  output?: string;
  auditLog?: string;
  verbose?: boolean;
  json?: boolean;
}

export function resolveFormatFlag(options: { format?: string; json?: boolean }): OutputFormat {
  if (options.json) return "json";
  const format = options.format ?? "text";
  if (!isOutputFormat(format)) {
    throw new UsageError(`Unknown --format "${format}".`, "Use one of: text, json, markdown.");
  }
  return format;
}

export async function runAuditCommand(
  context: CliContext,
  options: AuditCommandOptions,
): Promise<number> {
  const format = resolveFormatFlag(options);
  const { source } = await resolveSource(context, options);

  const auditSink = options.auditLog
    ? new JsonlAuditSink(resolve(context.cwd, options.auditLog))
    : undefined;

  const { report, auditEvents } = await runAuditWorkflow({
    source,
    now: context.now(),
    ...(auditSink ? { auditSink } : {}),
  });

  await emitReport(context, report, {
    format,
    ...(options.output ? { output: options.output } : {}),
    ...(options.verbose === undefined ? {} : { verbose: options.verbose }),
  });

  if (auditSink && format !== "json") {
    context.err(
      `\n${auditEvents.length} audit event(s) written to ${resolve(context.cwd, options.auditLog ?? "")}\n`,
    );
  }

  return report.summary.status === "pass" ? ExitCode.Success : ExitCode.PolicyFailure;
}
