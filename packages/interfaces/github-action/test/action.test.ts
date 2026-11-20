import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageError } from "@maintainerkit/core";
import type {
  GitHubApiClient,
  GitHubBranchProtectionPayload,
  GitHubCheckPublisherApi,
  GitHubPullRequestPayload,
  GitHubRepositoryPayload,
} from "@maintainerkit/github";
import { parseActionInputs, readEventPayload, runAction, type ActionInputs } from "../src/index.js";

let workspace: string;
let stdout: string;
let stderr: string;

const NOW = new Date("2026-04-05T06:07:08.000Z");

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "maintainerkit-action-"));
  stdout = "";
  stderr = "";
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const repositoryPayload: GitHubRepositoryPayload = {
  name: "widget",
  full_name: "acme/widget",
  private: false,
  archived: false,
  default_branch: "main",
  description: "A widget",
  license: { spdx_id: "Apache-2.0" },
  html_url: "https://github.com/acme/widget",
  security_and_analysis: {
    secret_scanning: { status: "enabled" },
    secret_scanning_push_protection: { status: "enabled" },
  },
};

const pullRequestPayload: GitHubPullRequestPayload = {
  number: 11,
  title: "Update stuff",
  body: "no sections here",
  draft: false,
  state: "open",
  author_association: "CONTRIBUTOR",
  user: { login: "octocat" },
  base: { ref: "main", repo: { full_name: "acme/widget" } },
  head: { ref: "patch-1", sha: "head-sha-123", repo: { full_name: "octocat/widget" } },
  labels: [],
};

function fakeClient(overrides: Partial<GitHubApiClient> = {}): GitHubApiClient {
  return {
    getRepository: vi.fn(async () => repositoryPayload),
    getTree: vi.fn(async () => ({
      sha: "tree",
      truncated: false,
      tree: [
        { path: "README.md", type: "blob", size: 10 },
        { path: "LICENSE", type: "blob", size: 10 },
      ],
    })),
    getFileContent: vi.fn(async (_o, _r, path) =>
      path === "LICENSE" ? "Apache License\nVersion 2.0" : "# Widget",
    ),
    getPullRequest: vi.fn(async () => pullRequestPayload),
    listPullRequestCommits: vi.fn(async () => [
      { sha: "a".repeat(40), commit: { message: "update", verification: { verified: false } } },
    ]),
    listCheckRuns: vi.fn(async () => ({ total_count: 0, check_runs: [] })),
    listPullRequestFiles: vi.fn(async () => [
      { filename: "src/x.ts", status: "modified", additions: 1, deletions: 0 },
    ]),
    getBranchProtection: vi.fn(
      async (): Promise<GitHubBranchProtectionPayload | "unknown" | null> => ({
        required_pull_request_reviews: { required_approving_review_count: 1 },
      }),
    ),
    hasVulnerabilityAlerts: vi.fn(async () => true),
    ...overrides,
  };
}

const policy = `specVersion: "1.0"
repository:
  requiredFiles: [README.md, LICENSE]
pullRequests:
  title:
    convention: conventional
  description:
    minLength: 20
    requiredSections: [Summary]
  checks:
    required: [verify]
`;

async function writeEvent(payload: unknown): Promise<string> {
  const path = join(workspace, "event.json");
  await writeFile(path, JSON.stringify(payload), "utf8");
  return path;
}

function baseInputs(overrides: Partial<ActionInputs> = {}): ActionInputs {
  return {
    config: "maintainerkit.yml",
    repo: "acme/widget",
    publishChecks: false,
    failOn: "error",
    auditLog: "audit.jsonl",
    name: "MaintainerKit",
    ...overrides,
  };
}

async function run(
  inputs: ActionInputs,
  env: NodeJS.ProcessEnv = {},
  deps: { client?: GitHubApiClient; publisher?: GitHubCheckPublisherApi } = {},
) {
  return runAction(inputs, {
    env: { PATH: process.env.PATH, GITHUB_STEP_SUMMARY: join(workspace, "summary.md"), ...env },
    workspace,
    now: NOW,
    out: (chunk) => {
      stdout += chunk;
    },
    err: (chunk) => {
      stderr += chunk;
    },
    ...deps,
  });
}

describe("input parsing", () => {
  it("applies documented defaults", () => {
    const inputs = parseActionInputs({});
    expect(inputs).toMatchObject({
      config: "maintainerkit.yml",
      publishChecks: false,
      failOn: "error",
      name: "MaintainerKit",
      auditLog: "maintainerkit-audit.jsonl",
    });
    expect(inputs.pr).toBeUndefined();
  });

  it("reads GitHub-provided INPUT_ variables", () => {
    const inputs = parseActionInputs({
      INPUT_CONFIG: "config/policy.yml",
      INPUT_PR: "42",
      INPUT_PUBLISH_CHECKS: "true",
      INPUT_FAIL_ON: "warning",
      INPUT_REPORT_OUTPUT: "out/report.json",
      INPUT_AI_TIMEOUT: "30",
    });
    expect(inputs).toMatchObject({
      config: "config/policy.yml",
      pr: 42,
      publishChecks: true,
      failOn: "warning",
      reportOutput: "out/report.json",
      aiTimeoutSeconds: 30,
    });
  });

  it("rejects invalid values with usage errors", () => {
    expect(() => parseActionInputs({ INPUT_FAIL_ON: "sometimes" })).toThrow(UsageError);
    expect(() => parseActionInputs({ INPUT_PR: "abc" })).toThrow(UsageError);
  });
});

describe("event payload reading", () => {
  it("returns an empty object for a missing or malformed payload", async () => {
    expect(readEventPayload({})).toEqual({});
    const path = await writeEvent(null);
    expect(readEventPayload({ GITHUB_EVENT_PATH: path })).toEqual({});
    await writeFile(path, "not json", "utf8");
    expect(readEventPayload({ GITHUB_EVENT_PATH: path })).toEqual({});
  });
});

describe("action run", () => {
  it("evaluates pull-request policies and fails the job", async () => {
    await writeFile(join(workspace, "maintainerkit.yml"), policy, "utf8");
    const eventPath = await writeEvent({
      pull_request: {
        number: 11,
        head: { sha: "head-sha-123", repo: { full_name: "octocat/widget" } },
        base: { repo: { full_name: "acme/widget" } },
      },
    });

    const result = await run(
      baseInputs(),
      { GITHUB_EVENT_PATH: eventPath, GITHUB_TOKEN: "token", GITHUB_REPOSITORY: "acme/widget" },
      { client: fakeClient() },
    );

    expect(result.exitCode).toBe(1);
    expect(result.report?.subject.kind).toBe("pull_request");
    expect(
      result.report?.findings.some(
        (finding) => finding.ruleId === "MK-PR-001" && finding.status === "fail",
      ),
    ).toBe(true);
    expect(stdout).toContain("MaintainerKit policy check");
  });

  it("writes the job summary and the audit trail", async () => {
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "maintainerkit.yml"), policy, "utf8");
    const eventPath = await writeEvent({
      pull_request: {
        number: 11,
        head: { sha: "sha", repo: { full_name: "a/b" } },
        base: { repo: { full_name: "a/c" } },
      },
    });

    await run(
      baseInputs(),
      { GITHUB_EVENT_PATH: eventPath, GITHUB_TOKEN: "token" },
      { client: fakeClient() },
    );

    expect(await readFile(join(workspace, "summary.md"), "utf8")).toContain(
      "## MaintainerKit policy check",
    );
    const events = (await readFile(join(workspace, "audit.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; metadata?: Record<string, unknown> });
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "policy.evaluated",
      "run.completed",
    ]);
    expect(events[1]?.metadata?.fork).toBe(true);
  });

  it("never publishes a check run by default", async () => {
    await writeFile(join(workspace, "maintainerkit.yml"), policy, "utf8");
    const publisher: GitHubCheckPublisherApi = { createCheckRun: vi.fn(async () => ({ id: 1 })) };
    await run(baseInputs(), { GITHUB_TOKEN: "token" }, { client: fakeClient(), publisher });
    expect(publisher.createCheckRun).not.toHaveBeenCalled();
  });

  it("publishes a check run only when the write gate is open", async () => {
    await writeFile(join(workspace, "maintainerkit.yml"), policy, "utf8");
    const eventPath = await writeEvent({
      pull_request: { number: 11, head: { sha: "head-sha-123" } },
    });
    const publisher: GitHubCheckPublisherApi = {
      createCheckRun: vi.fn(async () => ({ id: 77, html_url: "https://example/check/77" })),
    };

    const closed = await run(
      baseInputs({ publishChecks: true }),
      { GITHUB_EVENT_PATH: eventPath, GITHUB_TOKEN: "token" },
      { client: fakeClient(), publisher },
    );
    expect(publisher.createCheckRun).not.toHaveBeenCalled();
    expect(closed.exitCode).toBe(1);
    expect(stderr).toContain("write gate is closed");

    const open = await run(
      baseInputs({ publishChecks: true }),
      { GITHUB_EVENT_PATH: eventPath, GITHUB_TOKEN: "token", MAINTAINERKIT_ALLOW_WRITE: "true" },
      { client: fakeClient(), publisher },
    );
    expect(publisher.createCheckRun).toHaveBeenCalledTimes(1);
    expect(publisher.createCheckRun).toHaveBeenCalledWith(
      "acme/widget".split("/")[0],
      "widget",
      expect.objectContaining({
        head_sha: "head-sha-123",
        conclusion: "failure",
        status: "completed",
      }),
    );
    expect(open.checkRunUrl).toBe("https://example/check/77");
  });

  it("downgrades a missing checks: write permission to a warning", async () => {
    await writeFile(join(workspace, "maintainerkit.yml"), policy, "utf8");
    const eventPath = await writeEvent({ pull_request: { number: 11, head: { sha: "sha" } } });
    const publisher: GitHubCheckPublisherApi = {
      createCheckRun: vi.fn(async () => {
        throw Object.assign(new Error("forbidden"), { status: 403 });
      }),
    };
    // The publisher throws an untyped error here; the action must not crash either way.
    const result = await run(
      baseInputs({ publishChecks: true }),
      { GITHUB_EVENT_PATH: eventPath, GITHUB_TOKEN: "token", MAINTAINERKIT_ALLOW_WRITE: "true" },
      { client: fakeClient(), publisher },
    );
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain("warning:");
  });

  it("fails with a usage code when the policy document is invalid", async () => {
    await writeFile(join(workspace, "maintainerkit.yml"), 'specVersion: "2.0"\n', "utf8");
    const result = await run(baseInputs(), { GITHUB_TOKEN: "token" }, { client: fakeClient() });
    expect(result.exitCode).toBe(2);
    expect(stderr).toContain("error:");
  });

  it("fails with a usage code when no repository is known", async () => {
    const result = await run(baseInputs({ repo: undefined }), {}, { client: fakeClient() });
    expect(result.exitCode).toBe(2);
    expect(stderr).toContain("no repository");
  });

  it("evaluates repository policies when the event has no pull request", async () => {
    await writeFile(join(workspace, "maintainerkit.yml"), policy, "utf8");
    const result = await run(baseInputs(), { GITHUB_TOKEN: "token" }, { client: fakeClient() });
    expect(result.report?.subject.kind).toBe("repository");
    expect(result.exitCode).toBe(0);
  });

  it("adds AI advisories without changing the verdict", async () => {
    await writeFile(
      join(workspace, "maintainerkit.yml"),
      `${policy}ai:
  enabled: true
  provider: mock
  capabilities: [risk-analysis]
`,
      "utf8",
    );
    const eventPath = await writeEvent({ pull_request: { number: 11, head: { sha: "sha" } } });
    const baseline = await run(
      baseInputs({ auditLog: undefined }),
      { GITHUB_EVENT_PATH: eventPath, GITHUB_TOKEN: "token" },
      { client: fakeClient() },
    );
    const withAi = await run(
      baseInputs({ auditLog: undefined }),
      { GITHUB_EVENT_PATH: eventPath, GITHUB_TOKEN: "token" },
      { client: fakeClient() },
    );

    expect(withAi.report?.advisories.length).toBe(1);
    expect(withAi.report?.summary.status).toBe(baseline.report?.summary.status);
    expect(withAi.exitCode).toBe(baseline.exitCode);
  });

  it("writes the JSON report when requested", async () => {
    await writeFile(join(workspace, "maintainerkit.yml"), policy, "utf8");
    await run(
      baseInputs({ reportOutput: "out/report.json" }),
      { GITHUB_TOKEN: "token" },
      { client: fakeClient() },
    );
    const report = JSON.parse(await readFile(join(workspace, "out", "report.json"), "utf8")) as {
      kind: string;
    };
    expect(report.kind).toBe("check");
  });

  it("never prints the token", async () => {
    await writeFile(join(workspace, "maintainerkit.yml"), policy, "utf8");
    const token = `ghp_${"z".repeat(36)}`;
    await run(baseInputs(), { GITHUB_TOKEN: token }, { client: fakeClient() });
    expect(stdout).not.toContain(token);
    expect(stderr).not.toContain(token);
  });
});
