/**
 * Minimal, explicit view of the GitHub REST API used by MaintainerKit.
 *
 * The policy engine never sees these types. Adapters implement this interface over Octokit, and
 * tests implement it in memory — which is why the GitHub path is testable without network access.
 */
export interface GitHubRepositoryPayload {
  name: string;
  full_name: string;
  private: boolean;
  archived: boolean;
  default_branch: string;
  description: string | null;
  license: { spdx_id: string | null } | null;
  topics?: string[];
  created_at?: string;
  pushed_at?: string;
  stargazers_count?: number;
  html_url?: string;
  security_and_analysis?: {
    secret_scanning?: { status?: string };
    secret_scanning_push_protection?: { status?: string };
  };
}

export interface GitHubPullRequestPayload {
  number: number;
  title: string;
  body: string | null;
  draft: boolean;
  state: string;
  merged?: boolean;
  author_association?: string;
  created_at?: string;
  updated_at?: string;
  user: { login: string } | null;
  base: { ref: string; repo: { full_name: string } | null };
  head: { ref: string; sha: string; repo: { full_name: string } | null };
  labels?: { name: string }[];
}

export interface GitHubCommitPayload {
  sha: string;
  commit: {
    message: string;
    verification?: { verified?: boolean } | null;
  };
  author?: { login?: string } | null;
}

export interface GitHubCheckRunsPayload {
  total_count: number;
  check_runs: {
    name: string;
    status: string;
    conclusion: string | null;
    html_url?: string;
  }[];
}

export interface GitHubPullFilePayload {
  filename: string;
  status: string;
  additions?: number;
  deletions?: number;
}

export interface GitHubTreePayload {
  sha: string;
  truncated: boolean;
  tree: { path: string; type: string; size?: number }[];
}

export interface GitHubBranchProtectionPayload {
  required_pull_request_reviews?: {
    required_approving_review_count?: number;
  } | null;
  required_signatures?: { enabled?: boolean } | null;
}

/** The read surface MaintainerKit needs. Every method is read-only by construction. */
export interface GitHubApiClient {
  getRepository(owner: string, repo: string): Promise<GitHubRepositoryPayload>;
  getTree(owner: string, repo: string, ref: string): Promise<GitHubTreePayload>;
  getFileContent(owner: string, repo: string, path: string, ref?: string): Promise<string | null>;
  getPullRequest(owner: string, repo: string, number: number): Promise<GitHubPullRequestPayload>;
  listPullRequestCommits(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GitHubCommitPayload[]>;
  listCheckRuns(owner: string, repo: string, ref: string): Promise<GitHubCheckRunsPayload>;
  listPullRequestFiles(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GitHubPullFilePayload[]>;
  /** null = not protected (404); "unknown" = protection not readable with this token (403). */
  getBranchProtection(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<GitHubBranchProtectionPayload | "unknown" | null>;
  hasVulnerabilityAlerts(owner: string, repo: string): Promise<boolean | "unknown">;
}

/** Write surface, separated so it cannot be reached by accident from a read-only code path. */
export interface GitHubCheckPublisherApi {
  createCheckRun(
    owner: string,
    repo: string,
    parameters: {
      name: string;
      head_sha: string;
      status: "completed";
      conclusion: "success" | "failure" | "neutral";
      output: { title: string; summary: string; text?: string };
      completed_at: string;
    },
  ): Promise<{ id: number; html_url?: string }>;
}
