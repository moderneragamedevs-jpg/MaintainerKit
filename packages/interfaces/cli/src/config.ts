import { ConfigError, formatDiagnostics, type Diagnostic } from "@maintainerkit/core";
import { CONFIG_FILENAMES, loadContribSpec } from "@maintainerkit/contribspec";
import type { ResolvedConfig } from "@maintainerkit/contribspec";
import { getDefaultRegistry } from "@maintainerkit/policy-engine";
import type { CliContext } from "./context.js";

export interface LoadedCliConfig {
  path: string;
  checksum: string;
  resolved: ResolvedConfig;
  diagnostics: Diagnostic[];
}

/**
 * Loads a policy document for commands that require one.
 *
 * Missing files are a usage error with a concrete next step (`init`), not a stack trace. Invalid
 * documents print every diagnostic before failing, so a user can fix them in one pass.
 */
export async function requireConfig(
  context: CliContext,
  configPath: string | undefined,
): Promise<LoadedCliConfig> {
  const loaded = await loadContribSpec(configPath ?? context.cwd, {
    cwd: context.cwd,
    knownRuleIds: getDefaultRegistry().ids(),
  });

  if (!loaded.result.resolved) {
    const formatted = formatDiagnostics(
      loaded.result.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
      loaded.path,
    );
    throw new ConfigError(
      `${loaded.path} is not a valid ContribSpec document.\n${formatted}`,
      "config/invalid",
      "Fix the reported problems, or run `maintainerkit init` for a known-good starting point.",
    );
  }

  return {
    path: loaded.path,
    checksum: loaded.checksum,
    resolved: loaded.result.resolved,
    diagnostics: loaded.result.diagnostics,
  };
}

export function missingConfigMessage(cwd: string): string {
  return [
    `No ContribSpec document found in ${cwd}.`,
    `Looked for: ${CONFIG_FILENAMES.join(", ")}.`,
    "Run `maintainerkit init` to create one.",
  ].join("\n");
}
