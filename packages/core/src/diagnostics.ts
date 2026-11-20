import { maxSeverity } from "./severity.js";

/**
 * Structured validation feedback for configuration and input documents.
 *
 * `path` uses RFC 6901 JSON Pointer so editors and scripts can point at the exact node
 * (`/pullRequests/title/maxLength`).
 */
export interface Diagnostic {
  /** Stable, machine-readable code, e.g. `contribspec/unknown-version`. */
  code: string;
  severity: "error" | "warning";
  message: string;
  path: string;
  hint?: string;
}

export function pointer(...segments: (string | number)[]): string {
  if (segments.length === 0) return "";
  return segments
    .map((segment) => `/${String(segment).replace(/~/g, "~0").replace(/\//g, "~1")}`)
    .join("");
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

export function worstDiagnosticSeverity(
  diagnostics: readonly Diagnostic[],
): "error" | "warning" | undefined {
  const worst = maxSeverity(diagnostics.map((diagnostic) => diagnostic.severity));
  return worst === "error" || worst === "warning" ? worst : undefined;
}

/**
 * Human-readable rendering used by the CLI. Deliberately plain text (no colour) so it is stable in
 * logs, CI, and tests; the CLI adds colour separately if it wants to.
 */
export function formatDiagnostics(diagnostics: readonly Diagnostic[], sourceId?: string): string {
  if (diagnostics.length === 0) return "";
  const header = sourceId
    ? `${sourceId}: ${diagnostics.length} problem(s)`
    : `${diagnostics.length} problem(s)`;
  const lines = diagnostics.map((diagnostic) => {
    const where = diagnostic.path === "" ? "(root)" : diagnostic.path;
    const hint = diagnostic.hint ? `\n    hint: ${diagnostic.hint}` : "";
    return `  ${diagnostic.severity} [${diagnostic.code}] at ${where}: ${diagnostic.message}${hint}`;
  });
  return [header, ...lines].join("\n");
}
