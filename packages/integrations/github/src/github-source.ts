import {
  ExecutionError,
  isSafeRelativePath,
  type AuthorAssociation,
  type CheckConclusion,
  type CheckRunSnapshot,
  type CheckStatus,
  type CommitSnapshot,
  type PullRequestSnapshot,
  type PullRequestSource,
  type RepositoryFile,
  type RepositorySnapshot,
  type SecurityPosture,
} from "@maintainerkit/core";
import type {
  GitHubApiClient,
  GitHubBranchProtectionPayload,
  GitHubCommitPayload,
  GitHubPullRequestPayload,
  GitHubRepositoryPayload,
} from "./api-types.js";
import { createGitHubClient } from "./octokit-client.js";

const OWNER_REPO = /^[A-Za-z0-9_.-]{1,100}$/;

export interface GitHubSourceOptions {
  owner: string;
  repo: string;
  /** Token. Falls back to GITHUB_TOKEN / GH_TOKEN. Never logged. */
  token?: string;
  /** Ref to read files from; defaults to the repository default branch. */
  ref?: string;
  /** Injected client (tests). When provided, no token is required. */
  client?: GitHubApiClient;
}

/** Signed-off-by trailer required by the DCO. */
const SIGN_OFF = /(^|\n)Signed-off-by:\s+.+<[^>]+>\s*(\n|$)/m;
const CLASSIC_CLOSING = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#([0-9]{1,9})/gi;
const ANY_ISSUE_REFERENCE = /(^|[^\w#])#([1-9][0-9]{0,8})\b/g;

const AUTHOR_ASSOCIATIONS = new Set<AuthorAssociation>([
  "OWNER",
  "MEMBER",
  "COLLABORATOR",
  "CONTRIBUTOR",
  "FIRST_TIME_CONTRIBUTOR",
  "FIRST_TIMER",
  "MANNEQUIN",
  "NONE",
]);

const CHECK_STATUSES = new Set<CheckStatus>(["queued", "in_progress", "completed", "unknown"]);
const CHECK_CONCLUSIONS = new Set<CheckConclusion>([
  "success",
  "failure",
  "neutral",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "stale",
  "unknown",
]);

export function toAuthorAssociation(value: string | undefined): AuthorAssociation {
  if (!value) return "unknown";
  const upper = value.toUpperCase() as AuthorAssociation;
  return AUTHOR_ASSOCIATIONS.has(upper) ? upper : "unknown";
}

export function toCheckStatus(value: string): CheckStatus {
  const normalised =
    value === "pending"
      ? "queued"
      : value === "requested" || value === "waiting"
        ? "queued"
        : value;
  return CHECK_STATUSES.has(normalised as CheckStatus) ? (normalised as CheckStatus) : "unknown";
}

export function toCheckConclusion(value: string | null): CheckConclusion {
  if (!value) return "unknown";
  return CHECK_CONCLUSIONS.has(value as CheckConclusion) ? (value as CheckConclusion) : "unknown";
}

/** Extracts issue numbers referenced by a PR body, closing keywords first. */
export function extractLinkedIssues(body: string | null | undefined): number[] {
  if (!body) return [];
  const found = new Set<number>();
  for (const match of body.matchAll(CLASSIC_CLOSING)) {
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > 0) found.add(value);
  }
  for (const match of body.matchAll(ANY_ISSUE_REFERENCE)) {
    const value = Number(match[2]);
    if (Number.isInteger(value) && value > 0) found.add(value);
  }
  return [...found].slice(0, 20);
}

export function mapSecurityPosture(
  repository: GitHubRepositoryPayload,
  protection: GitHubBranchProtectionPayload | "unknown" | null,
  vulnerabilityAlerts: boolean | "unknown",
): SecurityPosture {
  const secretScanningStatus = repository.security_and_analysis?.secret_scanning?.status;
  const pushProtectionStatus =
    repository.security_and_analysis?.secret_scanning_push_protection?.status;

  const toFlag = (status: string | undefined): boolean | "unknown" =>
    status === "enabled" ? true : status === "disabled" ? false : "unknown";

  const posture: SecurityPosture = {
    dependencyAlerts: vulnerabilityAlerts,
    secretScanning: toFlag(secretScanningStatus),
    pushProtection: toFlag(pushProtectionStatus),
  };

  if (protection === "unknown" || protection === null) {
    posture.branchProtection = protection === null ? false : "unknown";
    posture.requiredApprovals = "unknown";
    posture.signedCommitsRequired = "unknown";
    return posture;
  }

  posture.branchProtection = true;
  posture.requiredApprovals =
    protection.required_pull_request_reviews?.required_approving_review_count ?? 0;
  posture.signedCommitsRequired = protection.required_signatures?.enabled === true;
  return posture;
}

/**
 * GitHub read-only adapter.
 *
 * Guarantees:
 * - every call is a GET; this class has no write capability at all
 * - fork pull requests are flagged, and no code from the head ref is fetched or executed
 * - file reads never escape the repository path space
 */
export class GitHubRepositorySource implements PullRequestSource {
  readonly provider = "github";
  readonly #client: GitHubApiClient;
  readonly #owner: string;
  readonly #repo: string;
  readonly #ref?: string;

  constructor(options: GitHubSourceOptions & { client: GitHubApiClient }) {
    this.#client = options.client;
    this.#owner = options.owner;
    this.#repo = options.repo;
    this.#ref = options.ref;
  }

  static async create(options: GitHubSourceOptions): Promise<GitHubRepositorySource> {
    if (!OWNER_REPO.test(options.owner) || !OWNER_REPO.test(options.repo)) {
      throw new ExecutionError(
        `Invalid repository identifier "${options.owner}/${options.repo}".`,
        "github/invalid-repository",
        "Use the owner/name form, e.g. --repo acme/widget.",
      );
    }

    if (options.client) return new GitHubRepositorySource({ ...options, client: options.client });

    const token = options.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    if (!token) {
      throw new ExecutionError(
        "A GitHub token is required to read a remote repository.",
        "github/no-token",
        "Set GITHUB_TOKEN (read-only access is enough), or run against a local path instead.",
      );
    }

    const client = await createGitHubClient(token, {
      ...(process.env.GITHUB_API_URL ? { baseUrl: process.env.GITHUB_API_URL } : {}),
    });
    return new GitHubRepositorySource({ ...options, client });
  }

  async getRepository(): Promise<RepositorySnapshot> {
    const repository = await this.#client.getRepository(this.#owner, this.#repo);
    const ref = this.#ref ?? repository.default_branch;
    const tree = await this.#client.getTree(this.#owner, this.#repo, ref);

    const files: RepositoryFile[] = tree.tree
      .filter((entry) => entry.type === "blob" && isSafeRelativePath(entry.path))
      .map((entry) => ({
        path: entry.path,
        ...(entry.size === undefined ? {} : { sizeBytes: entry.size }),
      }));

    const byPath = new Set(files.map((file) => file.path.toLowerCase()));

    // Security posture is best-effort: a token without these scopes must not fail the whole audit.
    let protection: GitHubBranchProtectionPayload | "unknown" | null = "unknown";
    try {
      protection = await this.#client.getBranchProtection(
        this.#owner,
        this.#repo,
        repository.default_branch,
      );
    } catch {
      protection = "unknown";
    }

    let vulnerabilityAlerts: boolean | "unknown" = "unknown";
    try {
      vulnerabilityAlerts = await this.#client.hasVulnerabilityAlerts(this.#owner, this.#repo);
    } catch {
      vulnerabilityAlerts = "unknown";
    }

    return {
      ref: {
        provider: "github",
        owner: this.#owner,
        name: repository.name,
        ...(repository.html_url ? { url: repository.html_url } : {}),
        defaultBranch: repository.default_branch,
      },
      metadata: {
        ...(repository.description ? { description: repository.description } : {}),
        ...(repository.license?.spdx_id ? { licenseSpdx: repository.license.spdx_id } : {}),
        archived: repository.archived,
        visibility: repository.private ? "private" : "public",
        ...(repository.topics ? { topics: repository.topics } : {}),
        ...(repository.created_at ? { createdAt: repository.created_at } : {}),
        ...(repository.pushed_at ? { pushedAt: repository.pushed_at } : {}),
        ...(repository.stargazers_count === undefined
          ? {}
          : { stars: repository.stargazers_count }),
      },
      files,
      security: mapSecurityPosture(repository, protection, vulnerabilityAlerts),
      hasFile: (path: string) => byPath.has(path.replace(/\\/g, "/").toLowerCase()),
      readFile: async (path: string) => {
        if (!isSafeRelativePath(path)) return null;
        if (!byPath.has(path.toLowerCase())) return null;
        return this.#client.getFileContent(this.#owner, this.#repo, path, ref);
      },
    };
  }

  async getPullRequest(number: number): Promise<PullRequestSnapshot> {
    if (!Number.isInteger(number) || number <= 0) {
      throw new ExecutionError(
        `Invalid pull request number "${number}".`,
        "github/invalid-pull-request",
        "Pass a positive integer, e.g. --pr 42.",
      );
    }

    const pullRequest = await this.#client.getPullRequest(this.#owner, this.#repo, number);
    const [commits, checks, files] = await Promise.all([
      this.#client.listPullRequestCommits(this.#owner, this.#repo, number),
      this.#client.listCheckRuns(this.#owner, this.#repo, pullRequest.head.sha).catch(() => ({
        total_count: 0,
        check_runs: [],
      })),
      this.#client.listPullRequestFiles(this.#owner, this.#repo, number).catch(() => []),
    ]);

    return mapPullRequest(pullRequest, commits, checks.check_runs, files);
  }
}

interface RawCheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  html_url?: string;
}

export function mapPullRequest(
  pullRequest: GitHubPullRequestPayload,
  commits: readonly GitHubCommitPayload[],
  checkRuns: readonly RawCheckRun[],
  files: readonly { filename: string; additions?: number; deletions?: number }[],
): PullRequestSnapshot {
  const baseFullName = pullRequest.base.repo?.full_name;
  const headFullName = pullRequest.head.repo?.full_name;
  const isFork =
    headFullName === undefined || headFullName === null || headFullName !== baseFullName;

  const mappedCommits: CommitSnapshot[] = commits.map((commit) => ({
    sha: commit.sha,
    message: commit.commit.message,
    signedOff: SIGN_OFF.test(commit.commit.message),
    verified: commit.commit.verification?.verified === true,
    ...(commit.author?.login ? { authorLogin: commit.author.login } : {}),
  }));

  const mappedChecks: CheckRunSnapshot[] = checkRuns.map((run) => ({
    name: run.name,
    status: toCheckStatus(run.status),
    conclusion: toCheckConclusion(run.conclusion),
    ...(run.html_url ? { detailsUrl: run.html_url } : {}),
  }));

  const additions = files.reduce((total, file) => total + (file.additions ?? 0), 0);
  const deletions = files.reduce((total, file) => total + (file.deletions ?? 0), 0);

  const state: PullRequestSnapshot["state"] =
    pullRequest.merged === true
      ? "merged"
      : pullRequest.state === "closed"
        ? "closed"
        : pullRequest.state === "open"
          ? "open"
          : "unknown";

  return {
    number: pullRequest.number,
    title: pullRequest.title,
    ...(pullRequest.body ? { body: pullRequest.body } : {}),
    author: pullRequest.user?.login ?? "unknown",
    authorAssociation: toAuthorAssociation(pullRequest.author_association),
    baseRef: pullRequest.base.ref,
    headRef: pullRequest.head.ref,
    isFork,
    isDraft: pullRequest.draft,
    state,
    labels: (pullRequest.labels ?? []).map((label) => label.name),
    commits: mappedCommits,
    checks: mappedChecks,
    changedFiles: files.map((file) => file.filename),
    ...(files.length > 0 ? { additions, deletions } : {}),
    linkedIssues: extractLinkedIssues(pullRequest.body),
    ...(pullRequest.created_at ? { createdAt: pullRequest.created_at } : {}),
    ...(pullRequest.updated_at ? { updatedAt: pullRequest.updated_at } : {}),
  };
}
