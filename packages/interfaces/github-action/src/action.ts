import { readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ExitCode,
  UsageError,
  describeError,
  isMaintainerKitError,
  type PolicyFinding,
  type ReportEnvelope,
  type Severity,
} from "@maintainerkit/core";
import { loadValidContribSpec } from "@maintainerkit/contribspec";
import { getDefaultRegistry } from "@maintainerkit/policy-engine";
import {
  runCheck,
  buildCheckRunContent,
  renderMarkdown,
  renderText,
} from "@maintainerkit/workflow-engine";
import { JsonlAuditSink } from "@maintainerkit/audit";
import {
  GitHubRepositorySource,
  createGitHubWriter,
  publishCheckRun,
  writeGateFromEnv,
  type GitHubApiClient,
  type GitHubCheckPublisherApi,
} from "@maintainerkit/github";
import { createAdvisor } from "@maintainerkit/ai-advisor";

export interface ActionInputs {
  /** Path to the policy document, relative to the workspace. */
  config: string;
  /** owner/name; defaults to GITHUB_REPOSITORY. */
  repo?: string;
  /** Pull request number; defaults to the event payload. */
  pr?: number;
  /** Publish a check run (requires checks: write and the write gate). */
  publishChecks: boolean;
  failOn: Severity;
  /** JSONL audit trail path, relative to the workspace. Empty disables it. */
  auditLog?: string;
  /** Path for the JSON report, relative to the workspace. */
  reportOutput?: string;
  name: string;
  aiTimeoutSeconds?: number;
}

export interface ActionDeps {
  env: NodeJS.ProcessEnv;
  workspace?: string;
  client?: GitHubApiClient;
  publisher?: GitHubCheckPublisherApi;
  now?: Date;
  out?: (chunk: string) => void;
  err?: (chunk: string) => void;
}

export interface ActionResult {
  exitCode: number;
  report?: ReportEnvelope;
  checkRunUrl?: string;
  summary?: string;
}

interface EventPullRequest {
  number?: number;
  draft?: boolean;
  head?: { sha?: string; repo?: { full_name?: string } | null };
  base?: { repo?: { full_name?: string } | null };
}

interface GitHubEvent {
  pull_request?: EventPullRequest;
  number?: number;
  repository?: { full_name?: string };
}

const MAX_EVENT_BYTES = 2 * 1024 * 1024;

/** Reads the workflow event payload. Treated as untrusted input: size-capped and fully optional. */
export function readEventPayload(env: NodeJS.ProcessEnv): GitHubEvent {
  const path = env.GITHUB_EVENT_PATH;
  if (!path) return {};
  try {
    const raw = readFileSync(path);
    if (raw.byteLength > MAX_EVENT_BYTES) return {};
    const parsed: unknown = JSON.parse(raw.toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as GitHubEvent) : {};
  } catch {
    return {};
  }
}

function isForkFromEvent(event: GitHubEvent): boolean | undefined {
  const head = event.pull_request?.head?.repo?.full_name;
  const base = event.pull_request?.base?.repo?.full_name;
  if (!event.pull_request) return undefined;
  if (!head || !base) return true;
  return head !== base;
}

function findFailures(report: ReportEnvelope): PolicyFinding[] {
  return report.findings.filter(
    (finding) => finding.status === "fail" || finding.status === "error",
  );
}

/**
 * The GitHub Action entrypoint.
 *
 * Security posture (ADR-0004):
 * - analysis is API-based: no code from the pull request is checked out or executed
 * - the token is read from the environment and never printed
 * - publishing a check run requires `publish-checks: true` AND `MAINTAINERKIT_ALLOW_WRITE=true`
 * - a missing `checks: write` permission downgrades publishing to a warning, it does not break the run
 * - every result is written to the job summary and (optionally) to the audit trail
 */
export async function runAction(inputs: ActionInputs, deps: ActionDeps): Promise<ActionResult> {
  const out = deps.out ?? ((chunk: string) => process.stdout.write(chunk));
  const err = deps.err ?? ((chunk: string) => process.stderr.write(chunk));
  const workspace = deps.workspace ?? deps.env.GITHUB_WORKSPACE ?? process.cwd();
  const now = deps.now ?? new Date();
  const event = readEventPayload(deps.env);

  const repoFullName = inputs.repo ?? deps.env.GITHUB_REPOSITORY ?? event.repository?.full_name;
  if (!repoFullName || !repoFullName.includes("/")) {
    err("error: no repository was provided (set the repo input or GITHUB_REPOSITORY).\n");
    return { exitCode: ExitCode.UsageError };
  }
  const [owner, name] = repoFullName.split("/") as [string, string];

  const prNumber = inputs.pr ?? event.pull_request?.number ?? (event.number as number | undefined);
  const headSha = event.pull_request?.head?.sha ?? deps.env.GITHUB_SHA;
  const isFork = isForkFromEvent(event);

  try {
    const loaded = await loadValidContribSpec(resolve(workspace, inputs.config), {
      knownRuleIds: getDefaultRegistry().ids(),
    });

    const source = await GitHubRepositorySource.create({
      owner,
      repo: name,
      ...(deps.env.GITHUB_TOKEN ? { token: deps.env.GITHUB_TOKEN } : {}),
      ...(deps.client ? { client: deps.client } : {}),
    });

    const providerId = deps.env.MAINTAINERKIT_AI_PROVIDER ?? loaded.resolved.ai.provider;
    const advisor =
      loaded.resolved.ai.enabled && providerId && loaded.resolved.ai.capabilities.length > 0
        ? createAdvisor({
            providerId,
            ...(loaded.resolved.ai.model ? { model: loaded.resolved.ai.model } : {}),
            capabilities: loaded.resolved.ai.capabilities,
            ...(inputs.aiTimeoutSeconds ? { timeoutMs: inputs.aiTimeoutSeconds * 1000 } : {}),
            now,
          })
        : undefined;

    const auditSink = inputs.auditLog
      ? new JsonlAuditSink(resolve(workspace, inputs.auditLog))
      : undefined;

    const { report } = await runCheck({
      source,
      config: loaded.resolved,
      ...(prNumber === undefined ? {} : { pullRequestNumber: prNumber }),
      failOn: inputs.failOn,
      now,
      diagnostics: loaded.result.diagnostics,
      ...(advisor ? { advisor } : {}),
      ...(auditSink ? { auditSink } : {}),
      actor: { kind: "action", ...(deps.env.GITHUB_ACTOR ? { id: deps.env.GITHUB_ACTOR } : {}) },
      workflow: {
        name: inputs.name,
        ...(deps.env.GITHUB_RUN_ID ? { runId: deps.env.GITHUB_RUN_ID } : {}),
        ...(deps.env.GITHUB_EVENT_NAME ? { trigger: deps.env.GITHUB_EVENT_NAME } : {}),
        ...(isFork === undefined ? {} : { fork: isFork }),
      },
    });

    out(`${renderText(report)}\n`);

    const markdown = renderMarkdown(report);
    const summaryPath = deps.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      try {
        appendFileSync(summaryPath, `${markdown}\n`, "utf8");
      } catch (error) {
        err(`warning: could not write the job summary: ${describeError(error).message}\n`);
      }
    }

    if (inputs.reportOutput) {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      const path = resolve(workspace, inputs.reportOutput);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      out(`Report written to ${path}\n`);
    }

    let checkRunUrl: string | undefined;
    const gate = writeGateFromEnv(deps.env, inputs.publishChecks);
    if (inputs.publishChecks && prNumber !== undefined && headSha) {
      if (!gate.allowWrite) {
        err(
          "notice: check-run publishing was requested but the write gate is closed " +
            "(set MAINTAINERKIT_ALLOW_WRITE=true in the workflow). No write was attempted.\n",
        );
      } else {
        try {
          const publisher =
            deps.publisher ??
            (await createGitHubWriter(
              deps.env.GITHUB_TOKEN,
              deps.env.GITHUB_API_URL ? { baseUrl: deps.env.GITHUB_API_URL } : {},
            ));
          const content = buildCheckRunContent({ name: inputs.name, report });
          const published = await publishCheckRun(
            publisher,
            { owner, repo: name },
            {
              name: inputs.name,
              headSha,
              title: content.title,
              summary: content.summary,
              ...(content.text ? { text: content.text } : {}),
              conclusion: content.conclusion,
            },
            { ...gate, now },
          );
          checkRunUrl = published.url;
          out(`Published check run${published.url ? `: ${published.url}` : ""}\n`);
        } catch (error) {
          const described = describeError(error);
          if (described.code === "github/forbidden") {
            err(
              "warning: could not publish the check run (missing checks: write). " +
                "The policy result is still reported below.\n",
            );
          } else {
            err(`warning: check-run publishing failed: ${described.message}\n`);
          }
        }
      }
    } else if (inputs.publishChecks) {
      err(
        "notice: publish-checks was requested but no pull request head SHA is available; skipping.\n",
      );
    }

    const failures = findFailures(report);
    if (inputs.auditLog && failures.length > 0) {
      out(
        `${failures.length} finding(s) require attention; see the job summary for remediation.\n`,
      );
    }

    return {
      exitCode: report.summary.status === "pass" ? ExitCode.Success : ExitCode.PolicyFailure,
      report,
      ...(checkRunUrl ? { checkRunUrl } : {}),
      summary: markdown,
    };
  } catch (error) {
    if (isMaintainerKitError(error)) {
      err(`error: ${error.message}\n`);
      if (error.hint) err(`hint: ${error.hint}\n`);
      return { exitCode: error.exitCode };
    }
    err(`error: ${describeError(error).message}\n`);
    return { exitCode: ExitCode.ExecutionError };
  }
}

/** Parses action inputs from the environment GitHub Actions provides. */
export function parseActionInputs(env: NodeJS.ProcessEnv): ActionInputs {
  const value = (key: string): string | undefined => {
    // GitHub sets INPUT_<NAME> with hyphens preserved, but many workflows (and every shell) use
    // underscores. Accept both spellings so the Action is not surprising to debug.
    const upper = key.toUpperCase();
    const raw = env[`INPUT_${upper}`] ?? env[`INPUT_${upper.replace(/-/g, "_")}`];
    const trimmed = raw?.trim();
    return trimmed ? trimmed : undefined;
  };
  const flag = (key: string, fallback: boolean): boolean => {
    const raw = value(key)?.toLowerCase();
    if (raw === undefined) return fallback;
    return raw === "true" || raw === "1" || raw === "yes";
  };

  const failOn = value("fail-on") ?? "error";
  if (failOn !== "info" && failOn !== "warning" && failOn !== "error") {
    throw new UsageError(`Invalid fail-on input "${failOn}".`, "Use info, warning, or error.");
  }

  const prRaw = value("pr");
  const pr = prRaw ? Number.parseInt(prRaw, 10) : undefined;
  if (prRaw && (!Number.isInteger(pr) || (pr as number) <= 0)) {
    throw new UsageError(
      `Invalid pr input "${prRaw}".`,
      "Pass a positive pull request number or leave it empty.",
    );
  }

  const aiTimeoutRaw = value("ai-timeout");
  const aiTimeout = aiTimeoutRaw ? Number.parseInt(aiTimeoutRaw, 10) : undefined;

  return {
    config: value("config") ?? "maintainerkit.yml",
    ...(value("repo") ? { repo: value("repo") as string } : {}),
    ...(pr ? { pr } : {}),
    publishChecks: flag("publish-checks", false),
    failOn,
    auditLog: value("audit-log") ?? "maintainerkit-audit.jsonl",
    ...(value("report-output") ? { reportOutput: value("report-output") as string } : {}),
    name: value("name") ?? "MaintainerKit",
    ...(aiTimeout && Number.isInteger(aiTimeout) ? { aiTimeoutSeconds: aiTimeout } : {}),
  };
}
