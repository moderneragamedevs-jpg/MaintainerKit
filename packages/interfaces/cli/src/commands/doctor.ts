import { ExitCode } from "@maintainerkit/core";
import { findConfigFile, loadContribSpec } from "@maintainerkit/contribspec";
import { getDefaultRegistry } from "@maintainerkit/policy-engine";
import { readGitContext } from "@maintainerkit/git-integration";
import type { CliContext } from "../context.js";
import { parseRepoFlag } from "../sources.js";

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  title: string;
  status: DoctorStatus;
  detail: string;
  hint?: string;
}

export interface DoctorOptions {
  json?: boolean;
  repo?: string;
  offline?: boolean;
}

function nodeMajor(version: string): number {
  return Number(version.replace(/^v/, "").split(".")[0] ?? "0");
}

/**
 * Environment diagnostics.
 *
 * Deliberately reports *presence* of secrets, never values, and never performs a network call unless
 * `--repo` is given and `--offline` is not.
 */
export async function runDoctor(context: CliContext, options: DoctorOptions): Promise<number> {
  const checks: DoctorCheck[] = [];

  const major = nodeMajor(process.version);
  checks.push({
    id: "runtime.node",
    title: "Node.js version",
    status: major >= 22 ? "pass" : "fail",
    detail: `${process.version} (requires >= 22)`,
    ...(major >= 22
      ? {}
      : { hint: "Upgrade Node.js. MaintainerKit targets the current LTS line." }),
  });

  const configPath = await findConfigFile(context.cwd);
  if (!configPath) {
    checks.push({
      id: "config.present",
      title: "ContribSpec document",
      status: "warn",
      detail: "none found",
      hint: "Run `maintainerkit init` to create maintainerkit.yml. Local audits work without one.",
    });
  } else {
    const loaded = await loadContribSpec(configPath, { knownRuleIds: getDefaultRegistry().ids() });
    const errors = loaded.result.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error",
    );
    checks.push({
      id: "config.valid",
      title: "ContribSpec validity",
      status: errors.length === 0 ? "pass" : "fail",
      detail:
        errors.length === 0
          ? `${loaded.path} (version ${loaded.result.document?.specVersion ?? "unknown"})`
          : `${errors.length} error(s): ${errors.map((error) => error.code).join(", ")}`,
      ...(errors.length === 0
        ? {}
        : { hint: "Run `maintainerkit validate` for the full diagnostic list." }),
    });

    const warnings = loaded.result.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "warning",
    );
    if (warnings.length > 0) {
      checks.push({
        id: "config.warnings",
        title: "ContribSpec warnings",
        status: "warn",
        detail: warnings.map((warning) => warning.code).join(", "),
      });
    }
  }

  const git = await readGitContext(context.cwd);
  checks.push({
    id: "git.repository",
    title: "Git working tree",
    status: git.isGitRepository ? "pass" : "warn",
    detail: git.isGitRepository
      ? `${git.branch ?? "detached HEAD"}${git.remoteUrl ? ` → ${git.remoteUrl}` : ""}`
      : "not a git repository",
    ...(git.isGitRepository
      ? {}
      : { hint: "Initialize a repository if you intend to open pull requests." }),
  });

  const hasToken = Boolean(context.env.GITHUB_TOKEN || context.env.GH_TOKEN);
  checks.push({
    id: "github.token",
    title: "GitHub token",
    status: hasToken ? "pass" : "warn",
    detail: hasToken ? "present (value not shown)" : "not set",
    ...(hasToken
      ? {}
      : { hint: "Set GITHUB_TOKEN to run PR checks or read repository security settings." }),
  });

  if (options.repo && !options.offline) {
    if (!hasToken) {
      checks.push({
        id: "github.connectivity",
        title: "GitHub connectivity",
        status: "warn",
        detail: "skipped: no token",
      });
    } else {
      try {
        parseRepoFlag(options.repo);
        const { GitHubRepositorySource } = await import("@maintainerkit/github");
        const { owner, name } = parseRepoFlag(options.repo);
        const source = await GitHubRepositorySource.create({
          owner,
          repo: name,
          token: context.env.GITHUB_TOKEN ?? context.env.GH_TOKEN,
        });
        const repository = await source.getRepository();
        checks.push({
          id: "github.connectivity",
          title: "GitHub connectivity",
          status: "pass",
          detail: `${options.repo} reachable (${repository.files.length} files on ${repository.ref.defaultBranch ?? "default branch"})`,
        });
      } catch (error) {
        checks.push({
          id: "github.connectivity",
          title: "GitHub connectivity",
          status: "fail",
          detail: error instanceof Error ? error.message : String(error),
          hint: "Check the token scopes and repository name.",
        });
      }
    }
  }

  const providerId = context.env.MAINTAINERKIT_AI_PROVIDER;
  const hasAiKey = Boolean(
    context.env.OPENAI_API_KEY || context.env.ANTHROPIC_API_KEY || context.env.OLLAMA_HOST,
  );
  checks.push({
    id: "ai.configuration",
    title: "AI provider (optional)",
    status: providerId ? "pass" : "warn",
    detail: providerId
      ? `${providerId}${hasAiKey ? " with credentials" : " (no credentials detected)"}`
      : "not configured; policy checks do not need it",
  });

  const writeGate = (context.env.MAINTAINERKIT_ALLOW_WRITE ?? "").toLowerCase() === "true";
  checks.push({
    id: "security.write-gate",
    title: "Write gate",
    status: writeGate ? "warn" : "pass",
    detail: writeGate
      ? "MAINTAINERKIT_ALLOW_WRITE=true (mutating operations permitted where configured)"
      : "closed (read-only)",
    ...(writeGate
      ? { hint: "Keep the gate closed unless a workflow deliberately publishes check runs." }
      : {}),
  });

  const failed = checks.filter((check) => check.status === "fail");
  const warned = checks.filter((check) => check.status === "warn");

  if (options.json) {
    context.out(
      `${JSON.stringify(
        {
          checks,
          summary: {
            pass: checks.length - failed.length - warned.length,
            warn: warned.length,
            fail: failed.length,
          },
        },
        null,
        2,
      )}\n`,
    );
  } else {
    context.out("MaintainerKit doctor\n");
    context.out("===================\n");
    for (const check of checks) {
      context.out(`  [${check.status.toUpperCase()}] ${check.title}: ${check.detail}\n`);
      if (check.hint && check.status !== "pass") context.out(`         hint: ${check.hint}\n`);
    }
    context.out(
      `\n${checks.length - failed.length - warned.length} passed, ${warned.length} warning(s), ${failed.length} failure(s)\n`,
    );
  }

  const runtimeFailure = failed.some((check) => check.id === "runtime.node");
  if (runtimeFailure) return ExitCode.ExecutionError;
  if (failed.some((check) => check.id.startsWith("config."))) return ExitCode.UsageError;
  return ExitCode.Success;
}
