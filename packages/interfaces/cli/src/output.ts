import { redact } from "@maintainerkit/audit";

export type OutputFormat = "text" | "json" | "markdown";

export const OUTPUT_FORMATS: readonly OutputFormat[] = ["text", "json", "markdown"] as const;

export function isOutputFormat(value: string): value is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(value);
}

export interface Writers {
  out: (chunk: string) => void;
  err: (chunk: string) => void;
}

/**
 * Prints human text. In JSON mode, progress/diagnostic text goes to stderr so stdout stays parseable —
 * a rule that matters for CI pipelines that pipe the CLI into `jq`.
 */
export function info(writers: Writers, message: string, format: OutputFormat = "text"): void {
  if (format === "json") writers.err(`${message}\n`);
  else writers.out(`${message}\n`);
}

export function warn(writers: Writers, message: string): void {
  writers.err(`${message}\n`);
}

/** All rendered output passes through redaction: reports can embed repository text of unknown origin. */
export function sanitiseOutput(rendered: string): string {
  return redact(rendered);
}

export function exitCodeFromStatus(status: "pass" | "fail"): 0 | 1 {
  return status === "pass" ? 0 : 1;
}

/** CSV-ish list used in `explain` and `doctor` output. */
export function formatList(items: readonly string[]): string {
  return items.length === 0 ? "(none)" : items.join(", ");
}
