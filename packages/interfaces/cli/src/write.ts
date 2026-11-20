import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ReportEnvelope } from "@maintainerkit/core";
import { renderJson, renderMarkdown, renderText } from "@maintainerkit/workflow-engine";
import type { CliContext } from "./context.js";
import { sanitiseOutput, type OutputFormat } from "./output.js";

export interface EmitOptions {
  format: OutputFormat;
  output?: string;
  verbose?: boolean;
}

export function renderReport(report: ReportEnvelope, options: EmitOptions): string {
  const rendered =
    options.format === "json"
      ? renderJson(report)
      : options.format === "markdown"
        ? renderMarkdown(report)
        : renderText(report, {
            ...(options.verbose === undefined ? {} : { verbose: options.verbose }),
          });
  return sanitiseOutput(rendered);
}

/** Writes the report to stdout and, optionally, to a file. */
export async function emitReport(
  context: CliContext,
  report: ReportEnvelope,
  options: EmitOptions,
): Promise<void> {
  const rendered = renderReport(report, options);
  context.out(rendered);

  if (options.output) {
    const path = resolve(context.cwd, options.output);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, rendered, "utf8");
    // Keep stdout parseable in JSON mode.
    if (options.format === "json") context.err(`Report written to ${path}\n`);
    else context.out(`\nReport written to ${path}\n`);
  }
}
