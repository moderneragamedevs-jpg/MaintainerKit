import { ExitCode, formatDiagnostics } from "@maintainerkit/core";
import { loadContribSpec } from "@maintainerkit/contribspec";
import { getDefaultRegistry } from "@maintainerkit/policy-engine";
import type { CliContext } from "../context.js";

export interface ValidateOptions {
  path?: string;
  config?: string;
  json?: boolean;
}

export interface ValidateResult {
  valid: boolean;
  path: string;
  policyVersion: string | null;
  checksum: string;
  diagnostics: { severity: string; code: string; message: string; path: string; hint?: string }[];
  rulesEnabled: number;
}

/** Validates the policy document without evaluating any policy. */
export async function runValidate(context: CliContext, options: ValidateOptions): Promise<number> {
  const loaded = await loadContribSpec(options.config ?? options.path ?? context.cwd, {
    cwd: context.cwd,
    knownRuleIds: getDefaultRegistry().ids(),
  });

  const errors = loaded.result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const warnings = loaded.result.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "warning",
  );
  const valid = errors.length === 0;

  if (options.json) {
    const payload: ValidateResult = {
      valid,
      path: loaded.path,
      policyVersion: loaded.result.document?.specVersion ?? null,
      checksum: loaded.checksum,
      diagnostics: loaded.result.diagnostics.map((diagnostic) => ({
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
        path: diagnostic.path,
        ...(diagnostic.hint ? { hint: diagnostic.hint } : {}),
      })),
      rulesEnabled: valid ? getDefaultRegistry().ids().length : 0,
    };
    context.out(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (valid) {
    context.out(
      `Valid ContribSpec ${loaded.result.document?.specVersion ?? "(unknown version)"}\n`,
    );
    context.out(`  file:     ${loaded.path}\n`);
    context.out(`  checksum: ${loaded.checksum}\n`);
    context.out(`  rules:    ${getDefaultRegistry().ids().length} available\n`);
    if (warnings.length > 0) context.out(`\n${formatDiagnostics(warnings, loaded.path)}\n`);
  } else {
    context.err(`${formatDiagnostics(errors, loaded.path)}\n`);
    if (warnings.length > 0) context.err(`${formatDiagnostics(warnings, loaded.path)}\n`);
    context.err("Validation failed. See docs/CONTRIBSPEC.md for the field reference.\n");
  }

  if (!valid) return ExitCode.UsageError;
  return ExitCode.Success;
}
