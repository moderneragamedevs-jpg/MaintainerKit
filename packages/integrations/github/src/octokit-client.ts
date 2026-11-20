import { ExecutionError } from "@maintainerkit/core";
import type {
  GitHubApiClient,
  GitHubBranchProtectionPayload,
  GitHubCheckPublisherApi,
  GitHubCheckRunsPayload,
  GitHubCommitPayload,
  GitHubPullFilePayload,
  GitHubPullRequestPayload,
  GitHubRepositoryPayload,
  GitHubTreePayload,
} from "./api-types.js";

export const USER_AGENT = "maintainerkit/0.1.0";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_CONTENT_BYTES = 256 * 1024;

interface HttpErrorLike {
  status?: number;
  message?: string;
  response?: { headers?: Record<string, string>; status?: number };
}

function isHttpError(error: unknown): error is HttpErrorLike {
  return typeof error === "object" && error !== null && "status" in error;
}

/**
 * Translates GitHub failures into actionable MaintainerKit errors.
 *
 * Never includes the token (or the request headers) in the message: error text ends up in CI logs.
 */
export function mapGitHubError(error: unknown, context: string): never {
  if (isHttpError(error)) {
    const status = error.status ?? error.response?.status;
    const headers = error.response?.headers ?? {};
    const rateLimitRemaining = headers["x-ratelimit-remaining"];

    if (status === 401) {
      throw new ExecutionError(
        `GitHub authentication failed while ${context}.`,
        "github/authentication-failed",
        "The token is missing, expired, or invalid. Set GITHUB_TOKEN to a token with read access to this repository.",
      );
    }

    if (status === 403 && rateLimitRemaining === "0") {
      const reset = headers["x-ratelimit-reset"];
      const resetHint = reset
        ? ` Rate limit resets at ${new Date(Number(reset) * 1000).toISOString()}.`
        : "";
      throw new ExecutionError(
        `GitHub rate limit exhausted while ${context}.${resetHint}`,
        "github/rate-limited",
        "Wait for the reset, or authenticate with a token to raise the limit.",
      );
    }

    if (status === 403) {
      throw new ExecutionError(
        `GitHub refused the request while ${context} (403).`,
        "github/forbidden",
        "The token lacks a required permission or the resource is restricted. See docs/GITHUB_INTEGRATION.md for the permission table.",
      );
    }

    if (typeof status === "number" && status >= 500) {
      throw new ExecutionError(
        `GitHub returned ${status} while ${context}.`,
        "github/server-error",
        "This is usually transient; retry later.",
        error,
      );
    }

    throw new ExecutionError(
      `GitHub request failed while ${context} (${status ?? "unknown"}).`,
      "github/request-failed",
      undefined,
      error,
    );
  }

  throw new ExecutionError(
    `GitHub request failed while ${context}: ${error instanceof Error ? error.message : String(error)}`,
    "github/request-failed",
    undefined,
    error,
  );
}

function decodeBase64(content: string): string {
  const normalised = content.replace(/\n/g, "");
  return Buffer.from(normalised, "base64").toString("utf8");
}

/**
 * Octokit-backed client. Tokens are held privately and only ever passed to Octokit's auth option.
 */
export class OctokitGitHubClient implements GitHubApiClient, GitHubCheckPublisherApi {
  readonly #octokit: {
    request: (route: string, parameters?: Record<string, unknown>) => Promise<{ data: unknown }>;
  };

  private constructor(octokit: {
    request: (route: string, parameters?: Record<string, unknown>) => Promise<{ data: unknown }>;
  }) {
    this.#octokit = octokit;
  }

  /** Creates a client. Octokit is imported lazily so commands that stay local never load it. */
  static async create(
    token: string | undefined,
    options: { baseUrl?: string } = {},
  ): Promise<OctokitGitHubClient> {
    const { Octokit } = await import("octokit");
    const octokit = new Octokit({
      ...(token ? { auth: token } : {}),
      userAgent: USER_AGENT,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      request: { timeout: REQUEST_TIMEOUT_MS },
    }) as unknown as {
      request: (route: string, parameters?: Record<string, unknown>) => Promise<{ data: unknown }>;
    };
    return new OctokitGitHubClient(octokit);
  }

  async getRepository(owner: string, repo: string): Promise<GitHubRepositoryPayload> {
    try {
      const { data } = await this.#octokit.request("GET /repos/{owner}/{repo}", { owner, repo });
      return data as GitHubRepositoryPayload;
    } catch (error) {
      mapGitHubError(error, `reading repository ${owner}/${repo}`);
    }
  }

  async getTree(owner: string, repo: string, ref: string): Promise<GitHubTreePayload> {
    try {
      const { data } = await this.#octokit.request(
        "GET /repos/{owner}/{repo}/git/trees/{tree_sha}",
        {
          owner,
          repo,
          tree_sha: ref,
          recursive: "1",
        },
      );
      return data as GitHubTreePayload;
    } catch (error) {
      mapGitHubError(error, `listing files in ${owner}/${repo}@${ref}`);
    }
  }

  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<string | null> {
    try {
      const { data } = await this.#octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
        owner,
        repo,
        path,
        ...(ref ? { ref } : {}),
      });
      if (Array.isArray(data)) return null;
      const file = data as { content?: string; encoding?: string; size?: number };
      if (file.size !== undefined && file.size > MAX_CONTENT_BYTES) return null;
      if (!file.content || file.encoding !== "base64") return null;
      return decodeBase64(file.content);
    } catch (error) {
      if (isHttpError(error) && (error.status === 404 || error.response?.status === 404))
        return null;
      mapGitHubError(error, `reading ${path} in ${owner}/${repo}`);
    }
  }

  async getPullRequest(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GitHubPullRequestPayload> {
    try {
      const { data } = await this.#octokit.request(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}",
        {
          owner,
          repo,
          pull_number: number,
        },
      );
      return data as GitHubPullRequestPayload;
    } catch (error) {
      mapGitHubError(error, `reading pull request #${number}`);
    }
  }

  async listPullRequestCommits(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GitHubCommitPayload[]> {
    try {
      const { data } = await this.#octokit.request(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}/commits",
        { owner, repo, pull_number: number, per_page: 250 },
      );
      return data as GitHubCommitPayload[];
    } catch (error) {
      mapGitHubError(error, `reading commits of pull request #${number}`);
    }
  }

  async listCheckRuns(owner: string, repo: string, ref: string): Promise<GitHubCheckRunsPayload> {
    try {
      const { data } = await this.#octokit.request(
        "GET /repos/{owner}/{repo}/commits/{ref}/check-runs",
        { owner, repo, ref, per_page: 100 },
      );
      return data as GitHubCheckRunsPayload;
    } catch (error) {
      mapGitHubError(error, `reading check runs for ${ref}`);
    }
  }

  async listPullRequestFiles(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GitHubPullFilePayload[]> {
    try {
      const { data } = await this.#octokit.request(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
        { owner, repo, pull_number: number, per_page: 300 },
      );
      return data as GitHubPullFilePayload[];
    } catch (error) {
      mapGitHubError(error, `reading changed files of pull request #${number}`);
    }
  }

  async getBranchProtection(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<GitHubBranchProtectionPayload | "unknown" | null> {
    try {
      const { data } = await this.#octokit.request(
        "GET /repos/{owner}/{repo}/branches/{branch}/protection",
        { owner, repo, branch },
      );
      return data as GitHubBranchProtectionPayload;
    } catch (error) {
      if (isHttpError(error)) {
        const status = error.status ?? error.response?.status;
        // 404: the branch is unprotected (or the branch/token cannot see it).
        if (status === 404) return null;
        // 403: protection exists but this token may not read it. "unknown" is honest here.
        if (status === 403) return "unknown";
      }
      mapGitHubError(error, `reading branch protection for ${branch}`);
    }
  }

  async hasVulnerabilityAlerts(owner: string, repo: string): Promise<boolean | "unknown"> {
    try {
      await this.#octokit.request("GET /repos/{owner}/{repo}/vulnerability-alerts", {
        owner,
        repo,
      });
      return true;
    } catch (error) {
      if (isHttpError(error)) {
        const status = error.status ?? error.response?.status;
        if (status === 404) return false;
        if (status === 403) return "unknown";
      }
      mapGitHubError(error, "reading vulnerability alert settings");
    }
  }

  async createCheckRun(
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
  ): Promise<{ id: number; html_url?: string }> {
    try {
      const { data } = await this.#octokit.request("POST /repos/{owner}/{repo}/check-runs", {
        owner,
        repo,
        ...parameters,
      });
      const run = data as { id: number; html_url?: string };
      return { id: run.id, ...(run.html_url ? { html_url: run.html_url } : {}) };
    } catch (error) {
      mapGitHubError(error, "publishing a check run");
    }
  }
}

export async function createGitHubClient(
  token: string | undefined,
  options: { baseUrl?: string } = {},
): Promise<OctokitGitHubClient> {
  return OctokitGitHubClient.create(token, options);
}

/**
 * Creates a write-capable client. Only check-run publishing is exposed on it, and the caller must
 * still pass the write gate; this function does not authorize anything by itself.
 */
export async function createGitHubWriter(
  token: string | undefined,
  options: { baseUrl?: string } = {},
): Promise<GitHubCheckPublisherApi> {
  if (!token) {
    throw new ExecutionError(
      "A GitHub token with checks: write is required to publish a check run.",
      "github/no-token",
      "Set GITHUB_TOKEN. In a pull_request workflow, grant checks: write explicitly.",
    );
  }
  return OctokitGitHubClient.create(token, options);
}
