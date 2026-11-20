import { resolve } from "node:path";
import { ExitCode, UsageError, type Severity } from "@maintainerkit/core";
import { JsonlAuditSink } from "@maintainerkit/audit";
import { runCheck } from "@maintainerkit/workflow-engine";
import type { CliContext } from "../context.js";
import { requireConfig } from "../config.js";
import { createAdvisor } from "@maintainerkit/ai-advisor";
import { emitReport } from "../write.js";
import { resolveSource } from "../sources.js";
import { resolveFormatFlag } from "./audit.js";

export interface CheckCommandOptions {
  path?: string;
  repo?: string;
  ref?: string;
  pr?: number;
  config?: string;
  format?: string;
  output?: string;
  auditLog?: string;
  failOn?: string;
  dryRun?: boolean;
  verbose?: boolean;
  ai?: boolean;
  provider?: string;
  model?: string;
  aiTimeout?: number;
  json?: boolean;
}

function parseFailOn(value: string | undefined): Severity {
  const candidate = value ?? "error";
  if (candidate === "info" || candidate === "warning" || candidate === "error") return candidate;
  throw new UsageError(
    `Unknown --fail-on "${candidate}".`,
    "Use one of: info, warning, error (default: error).",
  );
}

/**
 * Evaluates policies for a repository or a pull request.
 *
 * Order of operations matters for the security model: the source is resolved (read-only), the policy
 * engine runs deterministically, and only then may an advisor be consulted. Nothing here can write to
 * GitHub — publishing a check run is the Action's job, behind its own gate.
 */
export async function runCheckCommand(
  context: CliContext,
  options: CheckCommandOptions,
): Promise<number> {
  const format = resolveFormatFlag(options);
  const failOn = parseFailOn(options.failOn);
  const config = await requireConfig(context, options.config);

  if (options.pr !== undefined && !options.repo) {
    throw new UsageError(
      "--pr requires --repo owner/name.",
      "Pull requests only exist on a provider. Run repository-only checks with --path .",
    );
  }

  const { source } = await resolveSource(context, options, {
    requirePullRequests: options.pr !== undefined,
  });

  const aiEnabled = options.ai === true || config.resolved.ai.enabled === true;
  const providerId =
    options.provider ?? config.resolved.ai.provider ?? context.env.MAINTAINERKIT_AI_PROVIDER;
  const capabilities = config.resolved.ai.capabilities;

  let advisor = undefined;
  if (aiEnabled && providerId) {
    advisor = createAdvisor({
      providerId,
      ...((options.model ?? config.resolved.ai.model)
        ? { model: options.model ?? config.resolved.ai.model }
        : {}),
      capabilities,
      ...(options.aiTimeout ? { timeoutMs: options.aiTimeout * 1000 } : {}),
      now: context.now(),
    });
  }

  const auditSink = options.auditLog
    ? new JsonlAuditSink(resolve(context.cwd, options.auditLog))
    : undefined;

  const diagnostics = [...config.diagnostics];
  if (aiEnabled && !providerId) {
    diagnostics.push({
      code: "ai/missing-provider",
      severity: "warning",
      message: "AI was requested but no provider is configured; advisories were skipped.",
      path: "/ai/provider",
      hint: "Set ai.provider in ContribSpec, pass --provider, or set MAINTAINERKIT_AI_PROVIDER.",
    });
  }

  const { report } = await runCheck({
    source,
    config: config.resolved,
    ...(options.pr === undefined ? {} : { pullRequestNumber: options.pr }),
    failOn,
    dryRun: options.dryRun ?? false,
    now: context.now(),
    diagnostics,
    ...(advisor ? { advisor } : {}),
    ...(auditSink ? { auditSink } : {}),
    workflow: {
      name: "cli-check",
      ...(options.pr === undefined ? {} : { trigger: `pull_request:${options.pr}` }),
    },
  });

  await emitReport(context, report, {
    format,
    ...(options.output ? { output: options.output } : {}),
    ...(options.verbose === undefined ? {} : { verbose: options.verbose }),
  });

  if (options.dryRun) {
    // stderr in every format, including json, so stdout stays machine-parseable.
    context.err("Dry run: no write operations were attempted (the CLI never writes to GitHub).\n");
  }

  return report.summary.status === "pass" ? ExitCode.Success : ExitCode.PolicyFailure;
}
