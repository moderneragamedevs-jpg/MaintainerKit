import { describe, expect, it } from "vitest";
import type { PullRequestSnapshot, PullRequestSource } from "@maintainerkit/core";
import { resolveConfig } from "@maintainerkit/contribspec";
import { MemoryAuditSink } from "@maintainerkit/audit";
import { renderJson, renderMarkdown, renderText, runCheck } from "@maintainerkit/workflow-engine";
import { GitHubRepositorySource } from "@maintainerkit/github";

/**
 * Cross-cutting security tests.
 *
 * These cover the guarantees that cannot be proven inside a single package: that credentials in
 * repository text cannot reach any output artifact, that the read-only adapter really is read-only,
 * and that the write gate fails closed.
 */

const NOW = new Date("2026-07-08T09:10:11.000Z");

const GITHUB_TOKEN = `ghp_${"a".repeat(36)}`;
const OPENAI_KEY = `sk-proj-${"b".repeat(32)}`;

function hostilePullRequest(): PullRequestSnapshot {
  return {
    number: 3,
    title: `feat: leak ${GITHUB_TOKEN}`,
    body: `## Summary\nToken: ${OPENAI_KEY}\n## Testing\nnone`,
    author: "contributor",
    authorAssociation: "NONE",
    baseRef: "main",
    headRef: "leak",
    isFork: true,
    isDraft: false,
    labels: [],
    commits: [{ sha: "c".repeat(40), message: `fix: ${GITHUB_TOKEN}`, signedOff: false }],
    checks: [],
    changedFiles: [`docs/${GITHUB_TOKEN}.md`],
  };
}

function source(): PullRequestSource {
  return {
    provider: "github",
    getRepository: async () => ({
      ref: { provider: "github", owner: "acme", name: "widget" },
      metadata: {},
      files: [{ path: "README.md" }],
    }),
    getPullRequest: async () => hostilePullRequest(),
  };
}

const config = resolveConfig({
  specVersion: "1.0",
  repository: { requiredFiles: [`${GITHUB_TOKEN}.md`] },
  pullRequests: {
    title: { convention: "conventional" },
    description: { minLength: 1000, requiredSections: ["Risk"] },
    checks: { required: [GITHUB_TOKEN] },
  },
});

describe("secret containment", () => {
  it("redacts credentials from every rendered artifact", async () => {
    const { report } = await runCheck({ source: source(), config, pullRequestNumber: 3, now: NOW });

    const artifacts = {
      json: renderJson(report),
      markdown: renderMarkdown(report),
      text: renderText(report),
    };

    for (const [name, artifact] of Object.entries(artifacts)) {
      expect(artifact, `${name} must not leak the GitHub token`).not.toContain(GITHUB_TOKEN);
      expect(artifact, `${name} must not leak the OpenAI key`).not.toContain(OPENAI_KEY);
    }
  });

  it("redacts credentials from audit events", async () => {
    const sink = new MemoryAuditSink();
    await runCheck({ source: source(), config, pullRequestNumber: 3, now: NOW, auditSink: sink });
    const serialised = JSON.stringify(sink.events);
    expect(serialised).not.toContain(GITHUB_TOKEN);
    expect(serialised).not.toContain(OPENAI_KEY);
  });

  it("keeps the token out of the report even when a rule echoes repository text", async () => {
    const { report } = await runCheck({ source: source(), config, pullRequestNumber: 3, now: NOW });
    const echoed = report.findings.some((finding) => finding.message.includes(GITHUB_TOKEN));
    expect(echoed).toBe(false);
  });
});

describe("read-only GitHub adapter", () => {
  it("exposes no mutating method", () => {
    const methods = new Set<string>();
    let prototype = GitHubRepositorySource.prototype as object | null;
    while (prototype && prototype !== Object.prototype) {
      for (const name of Object.getOwnPropertyNames(prototype)) methods.add(name);
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }

    const mutating = [...methods].filter((name) =>
      /^(create|update|delete|merge|close|label|comment|publish|push|put|post)/i.test(name),
    );
    expect(mutating.filter((name) => !name.startsWith("constructor"))).toEqual([]);
  });
});

describe("write gate", () => {
  it("fails closed when the environment variable is absent", async () => {
    const { writeGateFromEnv } = await import("@maintainerkit/github");
    expect(writeGateFromEnv({}, true).allowWrite).toBe(false);
  });

  it("refuses a truthy-looking but non-explicit value", async () => {
    const { writeGateFromEnv } = await import("@maintainerkit/github");
    for (const value of ["yes", "TRUE ", "on", "2"]) {
      expect(writeGateFromEnv({ MAINTAINERKIT_ALLOW_WRITE: value }, true).allowWrite).toBe(false);
    }
  });
});
