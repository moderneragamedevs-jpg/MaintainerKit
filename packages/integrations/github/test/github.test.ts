import { describe, expect, it, vi } from "vitest";
import { WriteNotAuthorizedError } from "@maintainerkit/core";
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
} from "../src/api-types.js";
import {
  extractLinkedIssues,
  GitHubRepositorySource,
  mapPullRequest,
  mapSecurityPosture,
  toAuthorAssociation,
  toCheckConclusion,
} from "../src/github-source.js";
import { mapGitHubError } from "../src/octokit-client.js";
import { publishCheckRun, writeGateFromEnv } from "../src/checks.js";

const repository: GitHubRepositoryPayload = {
  name: "widget",
  full_name: "acme/widget",
  private: false,
  archived: false,
  default_branch: "main",
  description: "A widget",
  license: { spdx_id: "Apache-2.0" },
  topics: ["oss"],
  created_at: "2020-01-01T00:00:00Z",
  pushed_at: "2026-01-01T00:00:00Z",
  stargazers_count: 12,
  html_url: "https://github.com/acme/widget",
  security_and_analysis: {
    secret_scanning: { status: "enabled" },
    secret_scanning_push_protection: { status: "disabled" },
  },
};

const tree: GitHubTreePayload = {
  sha: "tree-sha",
  truncated: false,
  tree: [
    { path: "README.md", type: "blob", size: 120 },
    { path: "src", type: "tree" },
    { path: "src/index.ts", type: "blob", size: 10 },
  ],
};

const pullRequest: GitHubPullRequestPayload = {
  number: 7,
  title: "feat(api): add endpoint",
  body: "## Summary\nAdds it.\n\nCloses #12 and relates to #99.",
  draft: false,
  state: "open",
  author_association: "CONTRIBUTOR",
  user: { login: "octocat" },
  base: { ref: "main", repo: { full_name: "acme/widget" } },
  head: { ref: "feature/x", sha: "head-sha", repo: { full_name: "octocat/widget" } },
  labels: [{ name: "enhancement" }],
  created_at: "2026-02-01T00:00:00Z",
  updated_at: "2026-02-02T00:00:00Z",
};

const commits: GitHubCommitPayload[] = [
  {
    sha: "a".repeat(40),
    commit: {
      message: "feat(api): add endpoint\n\nSigned-off-by: Octo Cat <octo@example.com>",
      verification: { verified: true },
    },
    author: { login: "octocat" },
  },
];

const checkRuns: GitHubCheckRunsPayload = {
  total_count: 2,
  check_runs: [
    { name: "verify", status: "completed", conclusion: "success", html_url: "https://example/1" },
    { name: "lint", status: "in_progress", conclusion: null },
  ],
};

const files: GitHubPullFilePayload[] = [
  { filename: "src/index.ts", status: "modified", additions: 5, deletions: 1 },
];

function fakeClient(overrides: Partial<GitHubApiClient> = {}): GitHubApiClient {
  return {
    getRepository: vi.fn(async () => repository),
    getTree: vi.fn(async () => tree),
    getFileContent: vi.fn(async (_o, _r, path) => (path === "README.md" ? "# Widget\n" : null)),
    getPullRequest: vi.fn(async () => pullRequest),
    listPullRequestCommits: vi.fn(async () => commits),
    listCheckRuns: vi.fn(async () => checkRuns),
    listPullRequestFiles: vi.fn(async () => files),
    getBranchProtection: vi.fn(
      async (): Promise<GitHubBranchProtectionPayload | "unknown" | null> => ({
        required_pull_request_reviews: { required_approving_review_count: 2 },
        required_signatures: { enabled: true },
      }),
    ),
    hasVulnerabilityAlerts: vi.fn(async () => true),
    ...overrides,
  };
}

describe("GitHub repository mapping", () => {
  it("maps metadata, files, and security posture", async () => {
    const source = await GitHubRepositorySource.create({
      owner: "acme",
      repo: "widget",
      client: fakeClient(),
    });
    const snapshot = await source.getRepository();

    expect(snapshot.ref).toEqual({
      provider: "github",
      owner: "acme",
      name: "widget",
      url: "https://github.com/acme/widget",
      defaultBranch: "main",
    });
    expect(snapshot.metadata.licenseSpdx).toBe("Apache-2.0");
    expect(snapshot.metadata.visibility).toBe("public");
    expect(snapshot.files.map((file) => file.path)).toEqual(["README.md", "src/index.ts"]);
    expect(snapshot.security).toEqual({
      dependencyAlerts: true,
      secretScanning: true,
      pushProtection: false,
      branchProtection: true,
      requiredApprovals: 2,
      signedCommitsRequired: true,
    });
  });

  it("reads only safe, existing paths and never calls the API for others", async () => {
    const client = fakeClient();
    const source = await GitHubRepositorySource.create({ owner: "acme", repo: "widget", client });
    const snapshot = await source.getRepository();

    expect(await snapshot.readFile?.("README.md")).toBe("# Widget\n");
    expect(await snapshot.readFile?.("../secrets")).toBeNull();
    expect(await snapshot.readFile?.("missing.md")).toBeNull();
    expect(client.getFileContent).toHaveBeenCalledTimes(1);
  });

  it("marks unknown posture when protection cannot be read", async () => {
    const client = fakeClient({ getBranchProtection: vi.fn(async () => "unknown") });
    const source = await GitHubRepositorySource.create({ owner: "acme", repo: "widget", client });
    const snapshot = await source.getRepository();
    expect(snapshot.security?.branchProtection).toBe("unknown");
    expect(snapshot.security?.requiredApprovals).toBe("unknown");
  });

  it("marks unprotected branches as false", () => {
    const posture = mapSecurityPosture(repository, null, true);
    expect(posture.branchProtection).toBe(false);
    expect(posture.requiredApprovals).toBe("unknown");
  });

  it("does not fail the snapshot when posture calls throw", async () => {
    const client = fakeClient({
      getBranchProtection: vi.fn(async () => {
        throw new Error("nope");
      }),
      hasVulnerabilityAlerts: vi.fn(async () => {
        throw new Error("nope");
      }),
    });
    const source = await GitHubRepositorySource.create({ owner: "acme", repo: "widget", client });
    const snapshot = await source.getRepository();
    expect(snapshot.security?.branchProtection).toBe("unknown");
    expect(snapshot.security?.dependencyAlerts).toBe("unknown");
  });

  it("rejects invalid repository identifiers before any call", async () => {
    await expect(
      GitHubRepositorySource.create({
        owner: "acme/../evil",
        repo: "widget",
        client: fakeClient(),
      }),
    ).rejects.toThrow(/Invalid repository identifier/);
  });

  it("requires a token when no client is injected", async () => {
    const originalToken = process.env.GITHUB_TOKEN;
    const originalGh = process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    try {
      await expect(
        GitHubRepositorySource.create({ owner: "acme", repo: "widget" }),
      ).rejects.toThrow(/token is required/);
    } finally {
      if (originalToken) process.env.GITHUB_TOKEN = originalToken;
      if (originalGh) process.env.GH_TOKEN = originalGh;
    }
  });
});

describe("GitHub pull request mapping", () => {
  it("marks fork pull requests and maps commits, checks, files", async () => {
    const source = await GitHubRepositorySource.create({
      owner: "acme",
      repo: "widget",
      client: fakeClient(),
    });
    const pr = await source.getPullRequest(7);

    expect(pr.isFork).toBe(true);
    expect(pr.author).toBe("octocat");
    expect(pr.authorAssociation).toBe("CONTRIBUTOR");
    expect(pr.commits[0]?.signedOff).toBe(true);
    expect(pr.commits[0]?.verified).toBe(true);
    expect(pr.checks).toEqual([
      {
        name: "verify",
        status: "completed",
        conclusion: "success",
        detailsUrl: "https://example/1",
      },
      { name: "lint", status: "in_progress", conclusion: "unknown" },
    ]);
    expect(pr.changedFiles).toEqual(["src/index.ts"]);
    expect(pr.additions).toBe(5);
    expect(pr.deletions).toBe(1);
    expect(pr.linkedIssues).toEqual([12, 99]);
  });

  it("treats a same-repository branch as not a fork", async () => {
    const notFork = mapPullRequest(
      { ...pullRequest, head: { ...pullRequest.head, repo: { full_name: "acme/widget" } } },
      commits,
      [],
      [],
    );
    expect(notFork.isFork).toBe(false);
  });

  it("treats a deleted head repository as a fork", async () => {
    const deleted = mapPullRequest(
      { ...pullRequest, head: { ...pullRequest.head, repo: null } },
      [],
      [],
      [],
    );
    expect(deleted.isFork).toBe(true);
  });

  it("maps merged state", () => {
    expect(
      mapPullRequest({ ...pullRequest, merged: true, state: "closed" }, [], [], []).state,
    ).toBe("merged");
  });

  it("does not fail when the check-run API is unavailable", async () => {
    const client = fakeClient({
      listCheckRuns: vi.fn(async () => {
        throw new Error("403");
      }),
    });
    const source = await GitHubRepositorySource.create({ owner: "acme", repo: "widget", client });
    const pr = await source.getPullRequest(7);
    expect(pr.checks).toEqual([]);
  });

  it("rejects invalid pull request numbers", async () => {
    const source = await GitHubRepositorySource.create({
      owner: "acme",
      repo: "widget",
      client: fakeClient(),
    });
    await expect(source.getPullRequest(0)).rejects.toThrow(/Invalid pull request number/);
    await expect(source.getPullRequest(-3)).rejects.toThrow();
  });
});

describe("normalisation helpers", () => {
  it("maps author associations and falls back to unknown", () => {
    expect(toAuthorAssociation("owner")).toBe("OWNER");
    expect(toAuthorAssociation("NONE")).toBe("NONE");
    expect(toAuthorAssociation("WEIRD")).toBe("unknown");
    expect(toAuthorAssociation(undefined)).toBe("unknown");
  });

  it("maps check conclusions and statuses safely", () => {
    expect(toCheckConclusion("success")).toBe("success");
    expect(toCheckConclusion("exploded")).toBe("unknown");
    expect(toCheckConclusion(null)).toBe("unknown");
  });

  it("extracts issue references from a body", () => {
    expect(extractLinkedIssues("Fixes #1, closes #2 and mentions #3")).toEqual([1, 2, 3]);
    expect(extractLinkedIssues("no references here")).toEqual([]);
    expect(extractLinkedIssues(undefined)).toEqual([]);
    expect(extractLinkedIssues("#0 invalid")).toEqual([]);
  });
});

describe("error mapping", () => {
  it("maps 401 to an authentication error with a hint and no token echo", () => {
    try {
      mapGitHubError({ status: 401, message: "Bad credentials" }, "reading repo");
      throw new Error("expected throw");
    } catch (error) {
      const typed = error as { code?: string; hint?: string; message: string };
      expect(typed.code).toBe("github/authentication-failed");
      expect(typed.hint).toContain("GITHUB_TOKEN");
      expect(typed.message).not.toContain("Bad credentials");
    }
  });

  it("maps exhausted rate limits with the reset time", () => {
    try {
      mapGitHubError(
        {
          status: 403,
          response: {
            headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1767225600" },
          },
        },
        "listing files",
      );
      throw new Error("expected throw");
    } catch (error) {
      const typed = error as { code?: string; message: string };
      expect(typed.code).toBe("github/rate-limited");
      expect(typed.message).toContain("2026-01-01T00:00:00.000Z");
    }
  });

  it("maps 403 permission failures", () => {
    expect(() => mapGitHubError({ status: 403 }, "x")).toThrowError(/403/);
    try {
      mapGitHubError({ status: 403 }, "x");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("github/forbidden");
    }
  });

  it("maps server errors as transient", () => {
    try {
      mapGitHubError({ status: 503 }, "x");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("github/server-error");
    }
  });

  it("maps unknown failures without leaking internals", () => {
    try {
      mapGitHubError(new Error("socket hang up"), "x");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("github/request-failed");
      expect((error as Error).message).toContain("socket hang up");
    }
  });
});

describe("check publishing gate", () => {
  const content = {
    name: "MaintainerKit",
    headSha: "abc123",
    title: "MaintainerKit policy check",
    summary: "1 failed",
    conclusion: "failure" as const,
  };

  it("refuses to publish without explicit authorization", async () => {
    const client: GitHubCheckPublisherApi = {
      createCheckRun: vi.fn(async () => ({ id: 1 })),
    };
    await expect(
      publishCheckRun(client, { owner: "acme", repo: "widget" }, content, { allowWrite: false }),
    ).rejects.toBeInstanceOf(WriteNotAuthorizedError);
    expect(client.createCheckRun).not.toHaveBeenCalled();
  });

  it("publishes when authorized", async () => {
    const client: GitHubCheckPublisherApi = {
      createCheckRun: vi.fn(async () => ({ id: 99, html_url: "https://example/check/99" })),
    };
    const result = await publishCheckRun(client, { owner: "acme", repo: "widget" }, content, {
      allowWrite: true,
      now: new Date("2026-03-04T05:06:07.000Z"),
    });
    expect(result).toEqual({ id: 99, url: "https://example/check/99" });
    expect(client.createCheckRun).toHaveBeenCalledWith(
      "acme",
      "widget",
      expect.objectContaining({
        status: "completed",
        conclusion: "failure",
        completed_at: "2026-03-04T05:06:07.000Z",
      }),
    );
  });

  it("opens the gate only for explicit environment values", () => {
    expect(writeGateFromEnv({ MAINTAINERKIT_ALLOW_WRITE: "true" }, true).allowWrite).toBe(true);
    expect(writeGateFromEnv({ MAINTAINERKIT_ALLOW_WRITE: "1" }, true).allowWrite).toBe(true);
    expect(writeGateFromEnv({ MAINTAINERKIT_ALLOW_WRITE: "yes" }, true).allowWrite).toBe(false);
    expect(writeGateFromEnv({}, true).allowWrite).toBe(false);
    expect(writeGateFromEnv({ MAINTAINERKIT_ALLOW_WRITE: "true" }, false).allowWrite).toBe(false);
  });
});
