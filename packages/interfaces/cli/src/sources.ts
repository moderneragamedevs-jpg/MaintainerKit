import { resolve } from "node:path";
import { ExecutionError, UsageError, type RepositorySource } from "@maintainerkit/core";
import { createLocalRepository } from "@maintainerkit/git-integration";
import { GitHubRepositorySource } from "@maintainerkit/github";
import type { CliContext } from "./context.js";

export interface SourceFlags {
  path?: string;
  repo?: string;
  ref?: string;
}

export interface ResolvedSource {
  source: RepositorySource;
  kind: "local" | "github";
  owner?: string;
  name?: string;
}

const OWNER_REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

export function parseRepoFlag(value: string): { owner: string; name: string } {
  if (!OWNER_REPO.test(value)) {
    throw new UsageError(
      `--repo must be in the owner/name form, got "${value}".`,
      "Example: --repo acme/widget",
    );
  }
  const [owner, name] = value.split("/") as [string, string];
  return { owner, name };
}

/**
 * Chooses the provider: a local working tree (default) or the GitHub API.
 *
 * The decision is explicit rather than automatic: reading GitHub sends nothing, but it does need a
 * token and it observes different data (security posture), so the user should know which one ran.
 */
export async function resolveSource(
  context: CliContext,
  flags: SourceFlags,
  options: { requirePullRequests?: boolean } = {},
): Promise<ResolvedSource> {
  if (flags.repo) {
    const { owner, name } = parseRepoFlag(flags.repo);
    const source = await GitHubRepositorySource.create({
      owner,
      repo: name,
      ...(flags.ref ? { ref: flags.ref } : {}),
      ...(context.env.GITHUB_TOKEN ? { token: context.env.GITHUB_TOKEN } : {}),
    });
    return { source, kind: "github", owner, name };
  }

  if (
    flags.path &&
    flags.path.includes("/") &&
    !flags.path.startsWith(".") &&
    options.requirePullRequests
  ) {
    throw new ExecutionError(
      "Pull request checks need --repo owner/name.",
      "cli/missing-repo",
      "Local working trees have no pull requests. Use --repo with GITHUB_TOKEN for PR policies.",
    );
  }

  // Resolve against the injected cwd, not process.cwd(): the CLI must behave identically in tests,
  // embedded use, and a real shell.
  const local = await createLocalRepository({ root: resolve(context.cwd, flags.path ?? ".") });
  return { source: local, kind: "local" };
}
