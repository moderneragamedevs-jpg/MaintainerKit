import { describe, expect, it } from "vitest";
import type { PolicySubject, PullRequestSnapshot } from "@maintainerkit/core";
import { MockAIProvider } from "@maintainerkit/ai-core";
import { APPLICABLE_CAPABILITIES, createAdvisor, produceAdvisories } from "../src/index.js";

const pullRequest: PullRequestSnapshot = {
  number: 5,
  title: "feat(api): add endpoint",
  body: "## Summary\nAdds an endpoint.",
  author: "octocat",
  baseRef: "main",
  headRef: "feature/api",
  isFork: true,
  isDraft: false,
  labels: [],
  commits: [{ sha: "a".repeat(40), message: "feat(api): add endpoint" }],
  checks: [],
  changedFiles: ["src/api.ts"],
  additions: 10,
  deletions: 2,
};

const prSubject: PolicySubject = {
  kind: "pull_request",
  label: "acme/widget#5",
  repository: {
    ref: { provider: "github", owner: "acme", name: "widget" },
    metadata: {},
    files: [{ path: "src/api.ts" }],
  },
  pullRequest,
};

const repoSubject: PolicySubject = {
  kind: "repository",
  label: "acme/widget",
  repository: {
    ref: { provider: "github", owner: "acme", name: "widget" },
    metadata: {},
    files: [],
  },
};

describe("applicability", () => {
  it("declares capabilities per subject kind", () => {
    expect(APPLICABLE_CAPABILITIES.pull_request).toContain("pull-request-summary");
    expect(APPLICABLE_CAPABILITIES.repository).toEqual([]);
  });
});

describe("produceAdvisories", () => {
  it("produces validated advisories for a pull request", async () => {
    const outcome = await produceAdvisories(
      { subject: prSubject },
      {
        providerId: "mock",
        model: "mock-1",
        capabilities: ["pull-request-summary", "risk-analysis"],
        now: new Date("2026-01-01T00:00:00.000Z"),
      },
    );

    expect(outcome.diagnostics).toEqual([]);
    expect(outcome.advisories).toHaveLength(2);
    expect(outcome.advisories.map((advisory) => advisory.provider)).toEqual(["mock", "mock"]);
    expect(outcome.advisories[0]?.capability).toBe("pull-request-summary");
    expect(outcome.advisories[0]?.createdAt).toBe("2026-01-01T00:00:00.000Z");
    // Advisories carry no policy status/severity: they cannot be mistaken for findings.
    expect(outcome.advisories[0]).not.toHaveProperty("status");
    expect(outcome.advisories[0]).not.toHaveProperty("severity");
  });

  it("reports capabilities that do not apply to the subject", async () => {
    const outcome = await produceAdvisories(
      { subject: repoSubject },
      { providerId: "mock", capabilities: ["pull-request-summary"] },
    );
    expect(outcome.advisories).toEqual([]);
    expect(outcome.diagnostics[0]?.code).toBe("ai/capability-not-applicable");
    expect(outcome.diagnostics[0]?.severity).toBe("warning");
  });

  it("isolates capability failures into diagnostics", async () => {
    const outcome = await produceAdvisories(
      { subject: prSubject },
      {
        providerId: "mock",
        capabilities: ["pull-request-summary", "risk-analysis"],
        provider: new MockAIProvider({ responder: () => "not json" }),
        maxAttempts: 1,
      },
    );
    expect(outcome.advisories).toEqual([]);
    expect(outcome.diagnostics).toHaveLength(2);
    expect(
      outcome.diagnostics.every((diagnostic) => diagnostic.code === "ai/capability-failed"),
    ).toBe(true);
  });

  it("warns when AI is requested with no capabilities", async () => {
    const outcome = await produceAdvisories(
      { subject: prSubject },
      { providerId: "mock", capabilities: [] },
    );
    expect(outcome.diagnostics[0]?.code).toBe("ai/no-capabilities");
  });

  it("reports an unknown provider as a capability failure, not a crash", async () => {
    const outcome = await produceAdvisories(
      { subject: prSubject },
      { providerId: "does-not-exist", capabilities: ["pull-request-summary"] },
    );
    expect(outcome.advisories).toEqual([]);
    expect(outcome.diagnostics[0]?.code).toBe("ai/provider-misconfigured");
    expect(outcome.diagnostics[0]?.message).toContain("Unknown AI provider");
  });
});

describe("createAdvisor", () => {
  it("returns a workflow-compatible callback", async () => {
    const advisor = createAdvisor({ providerId: "mock", capabilities: ["pull-request-summary"] });
    const outcome = await advisor({ subject: prSubject });
    expect(outcome.advisories).toHaveLength(1);
    expect(outcome.diagnostics).toEqual([]);
  });
});
