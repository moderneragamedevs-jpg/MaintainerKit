import { describe, expect, it, vi } from "vitest";
import type {
  PolicySubject,
  PullRequestSnapshot,
  PullRequestSource,
  RepositorySnapshot,
} from "@maintainerkit/core";
import { resolveConfig } from "@maintainerkit/contribspec";
import { MemoryAuditSink } from "@maintainerkit/audit";
import {
  buildCheckRunContent,
  renderJson,
  renderMarkdown,
  renderText,
  runAudit,
  runCheck,
  summarizeReport,
  type Advisor,
} from "../src/index.js";

const NOW = new Date("2026-06-07T08:09:10.000Z");

const repository: RepositorySnapshot = {
  // Intentionally does NOT contain CHANGELOG.md, so the required-file rule has something to report.
  ref: { provider: "filesystem", name: "widget" },
  metadata: {},
  files: [
    { path: "README.md", content: `# Widget\n\n${"Widget does a thing. ".repeat(20)}` },
    { path: "LICENSE", content: "Apache License\nVersion 2.0" },
    { path: "CONTRIBUTING.md", content: "# Contributing\n" },
    { path: "SECURITY.md", content: "# Security\n" },
    { path: "CODE_OF_CONDUCT.md", content: "# CoC\n" },
    { path: ".github/workflows/ci.yml", content: "on:\n  push:\n" },
    { path: ".github/dependabot.yml", content: "version: 2\n" },
  ],
  hasFile: (path) => repository.files.some((file) => file.path === path),
  async readFile(path) {
    const match = this.files.find((file) => file.path === path);
    return match?.content ?? null;
  },
};

const pullRequest: PullRequestSnapshot = {
  number: 9,
  title: "feat(core): add thing",
  body: "## Summary\nAdds a thing.\n\n## Testing\nRan the tests locally.",
  author: "octocat",
  authorAssociation: "CONTRIBUTOR",
  baseRef: "main",
  headRef: "feature/thing",
  isFork: true,
  isDraft: false,
  labels: [],
  commits: [{ sha: "a".repeat(40), message: "feat: thing", signedOff: true, verified: true }],
  checks: [{ name: "verify", status: "completed", conclusion: "success" }],
  changedFiles: ["src/x.ts"],
  linkedIssues: [],
};

function makeSource(options: { pullRequest?: PullRequestSnapshot } = {}): PullRequestSource {
  return {
    provider: "filesystem",
    getRepository: async () => repository,
    getPullRequest: async (number: number) => {
      if (!options.pullRequest) throw new Error("no pull request fixture");
      expect(number).toBe(options.pullRequest.number);
      return options.pullRequest;
    },
  };
}

const config = resolveConfig({
  specVersion: "1.0",
  repository: { requiredFiles: ["README.md", "CHANGELOG.md"] },
  pullRequests: {
    title: { convention: "conventional" },
    description: { minLength: 10 },
    checks: { required: ["verify"] },
  },
  release: {},
});

describe("runCheck", () => {
  it("evaluates repository policies and reports them", async () => {
    const result = await runCheck({ source: makeSource(), config, now: NOW });

    expect(result.report.kind).toBe("check");
    expect(result.report.subject.kind).toBe("repository");
    expect(result.report.subject.label).toBe("widget");
    expect(result.report.policyVersion.specVersion).toBe("1.0");
    expect(result.report.tool).toEqual({ name: "maintainerkit", version: "0.1.0" });
    expect(result.report.generatedAt).toBe("2026-06-07T08:09:10.000Z");
    expect(result.report.summary.status).toBe("fail");
    expect(result.report.findings.some((finding) => finding.message.includes("CHANGELOG.md"))).toBe(
      true,
    );
    expect(result.report.advisories).toEqual([]);
  });

  it("evaluates pull-request policies when a PR number is given", async () => {
    const result = await runCheck({
      source: makeSource({ pullRequest }),
      config,
      pullRequestNumber: 9,
      now: NOW,
    });

    expect(result.report.subject.kind).toBe("pull_request");
    expect(result.report.subject.label).toBe("widget/widget#9");
    expect(result.report.subject.pullRequestNumber).toBe(9);
    expect(result.report.findings.some((finding) => finding.ruleId === "MK-PR-001")).toBe(true);
  });

  it("fails with a typed error when the source cannot read pull requests", async () => {
    const source = { provider: "filesystem", getRepository: async () => repository };
    await expect(runCheck({ source, config, pullRequestNumber: 1, now: NOW })).rejects.toThrow(
      /cannot read pull requests/,
    );
  });

  it("emits ordered audit events to the sink", async () => {
    const sink = new MemoryAuditSink();
    const result = await runCheck({ source: makeSource(), config, now: NOW, auditSink: sink });

    expect(result.auditEvents.map((event) => event.type)).toEqual([
      "run.started",
      "policy.evaluated",
      "run.completed",
    ]);
    expect(sink.events).toHaveLength(3);
    expect(sink.events[1]?.policyVersion).toBe("1.0");
    expect(sink.events[1]?.output?.findings).toBe(result.report.summary.total);
    expect(sink.events[0]?.timestamp).toBe("2026-06-07T08:09:10.000Z");
  });

  it("records the fork flag in the audit event", async () => {
    const sink = new MemoryAuditSink();
    await runCheck({
      source: makeSource({ pullRequest }),
      config,
      pullRequestNumber: 9,
      now: NOW,
      auditSink: sink,
    });
    expect(sink.events[1]?.metadata?.fork).toBe(true);
  });
});

describe("advisory isolation", () => {
  it("includes advisories without changing the policy verdict", async () => {
    const advisor: Advisor = async () => ({
      advisories: [
        {
          id: "adv-1",
          capability: "risk-analysis",
          provider: "mock",
          model: "mock-1",
          promptVersion: "1",
          title: "Touches authentication",
          summary: "The change modifies login code; request a security review.",
          confidence: 0.7,
          createdAt: NOW.toISOString(),
        },
      ],
    });

    const baseline = await runCheck({ source: makeSource(), config, now: NOW });
    const withAdvisor = await runCheck({ source: makeSource(), config, now: NOW, advisor });

    expect(withAdvisor.report.advisories).toHaveLength(1);
    // Same verdict and counts; only the advisory counter differs.
    expect({ ...withAdvisor.report.summary, advisoryCount: 0 }).toEqual(baseline.report.summary);
    expect(withAdvisor.report.summary.advisoryCount).toBe(1);
  });

  it("turns an advisor failure into a warning diagnostic, never a failure", async () => {
    const advisor: Advisor = async () => {
      throw new Error("provider timed out");
    };
    const result = await runCheck({ source: makeSource(), config, now: NOW, advisor });
    expect(result.report.diagnostics[0]?.code).toBe("ai/advisor-failed");
    expect(result.report.diagnostics[0]?.severity).toBe("warning");
    expect(result.report.summary.status).toBe("fail"); // due to repository findings, not the advisor
    expect(result.report.findings.some((finding) => finding.message.includes("provider"))).toBe(
      false,
    );
  });

  it("passes the evaluated subject to the advisor", async () => {
    const advisor = vi.fn<Advisor>(async () => ({ advisories: [] }));
    await runCheck({
      source: makeSource({ pullRequest }),
      config,
      pullRequestNumber: 9,
      now: NOW,
      advisor,
    });
    const subject = advisor.mock.calls[0]?.[0].subject as PolicySubject;
    expect(subject.kind).toBe("pull_request");
    expect(subject.pullRequest?.number).toBe(9);
  });
});

describe("runAudit", () => {
  it("produces an audit report without a policy version", async () => {
    const result = await runAudit({ source: makeSource(), now: NOW });
    expect(result.report.kind).toBe("audit");
    expect(result.report.policyVersion.specVersion).toBeNull();
    expect(result.report.findings.length).toBeGreaterThanOrEqual(9);
    expect(result.report.summary.status).toBe("pass");
  });

  it("emits audit events", async () => {
    const result = await runAudit({ source: makeSource(), now: NOW });
    expect(result.auditEvents.map((event) => event.type)).toEqual([
      "run.started",
      "audit.completed",
      "run.completed",
    ]);
  });
});

describe("rendering", () => {
  it("renders plain text with actionable findings first", async () => {
    const { report } = await runCheck({ source: makeSource(), config, now: NOW });
    const text = renderText(report);
    expect(text).toContain("MaintainerKit policy check");
    expect(text).toContain("Findings requiring attention");
    expect(text).toContain("[FAIL error] MK-REPO-001");
    expect(text).toContain("fix:");
    expect(text).toContain("Result: FAIL");
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it("mentions skipped checks without --verbose", async () => {
    const { report } = await runCheck({ source: makeSource(), config, now: NOW });
    const text = renderText(report);
    expect(text).toContain("skipped");
  });

  it("renders JSON that round-trips", async () => {
    const { report } = await runCheck({ source: makeSource(), config, now: NOW });
    expect(JSON.parse(renderJson(report))).toEqual(report);
  });

  it("renders Markdown with escaped table cells", async () => {
    const { report } = await runCheck({ source: makeSource(), config, now: NOW });
    const markdown = renderMarkdown(report);
    expect(markdown).toContain("## MaintainerKit policy check");
    expect(markdown).toContain("| Rule | Severity | Finding |");
    expect(markdown).toContain("<details>");
    expect(markdown).toContain("</details>");
  });

  it("escapes HTML and pipes coming from untrusted messages", async () => {
    const hostileConfig = resolveConfig({
      specVersion: "1.0",
      repository: { requiredFiles: ["<img src=x onerror=alert(1)>.md", "a|b.md"] },
    });
    const { report } = await runCheck({ source: makeSource(), config: hostileConfig, now: NOW });
    const markdown = renderMarkdown(report);
    expect(markdown).not.toContain("<img src=x");
    expect(markdown).not.toContain("a|b.md |");
  });

  it("builds check-run content with the right conclusion", async () => {
    const failing = await runCheck({ source: makeSource(), config, now: NOW });
    const failContent = buildCheckRunContent({ name: "MaintainerKit", report: failing.report });
    expect(failContent.conclusion).toBe("failure");
    expect(failContent.title).toContain("need attention");
    expect(failContent.text).toContain("MK-REPO-001");

    const passing = await runAudit({ source: makeSource(), now: NOW });
    const passContent = buildCheckRunContent({
      name: "MaintainerKit audit",
      report: passing.report,
    });
    expect(passContent.conclusion).toBe("success");
    expect(passContent.text).toBe("");
  });

  it("summarizes a report for audit events", async () => {
    const { report } = await runCheck({ source: makeSource(), config, now: NOW });
    expect(summarizeReport(report)).toEqual({
      status: "fail",
      findings: report.summary.total,
      failed: report.summary.fail + report.summary.error,
      bySeverity: report.summary.bySeverity,
    });
  });
});
