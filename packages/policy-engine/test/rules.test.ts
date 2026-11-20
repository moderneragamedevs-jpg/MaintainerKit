import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../src/evaluate.js";
import {
  FIXED_NOW,
  makeCheck,
  makeCommit,
  makeConfig,
  makePullRequest,
  makePullRequestSubject,
  makeReleaseSubject,
  makeRepository,
  makeRepositorySubject,
} from "./fixtures.js";
import type { RuleResult } from "../src/rules/types.js";

const evaluatePr = async (pr = makePullRequest(), config = makeConfig()) =>
  evaluatePolicy(makePullRequestSubject(pr), config, { now: FIXED_NOW });

const evaluateRepo = async (repository = makeRepository(), config = makeConfig()) =>
  evaluatePolicy(makeRepositorySubject(repository), config, { now: FIXED_NOW });

const byRule = (findings: { ruleId: string }[], ruleId: string) =>
  findings.filter((finding) => finding.ruleId === ruleId);

describe("MK-REPO-001 required repository files", () => {
  it("passes when every required file exists", async () => {
    const report = await evaluateRepo();
    const findings = byRule(report.findings, "MK-REPO-001");
    expect(findings.every((finding) => finding.status === "pass")).toBe(true);
    expect(findings).toHaveLength(5);
  });

  it("fails per missing file and offers remediation", async () => {
    const report = await evaluateRepo(makeRepository({ files: [{ path: "README.md" }] }));
    const failures = byRule(report.findings, "MK-REPO-001").filter((f) => f.status === "fail");
    expect(failures.map((finding) => finding.message)).toEqual(
      expect.arrayContaining([expect.stringContaining("LICENSE")]),
    );
    expect(failures[0]?.remediation).toBeTruthy();
    expect(report.summary.status).toBe("fail");
  });

  it("is case-insensitive so Windows and Linux checkouts agree", async () => {
    const repository = makeRepository({
      files: [
        { path: "readme.md" },
        { path: "license" },
        { path: "CONTRIBUTING.md" },
        { path: "SECURITY.md" },
        { path: "CODE_OF_CONDUCT.md" },
      ],
    });
    const report = await evaluateRepo(repository);
    expect(
      byRule(report.findings, "MK-REPO-001").every((finding) => finding.status === "pass"),
    ).toBe(true);
  });

  it("skips when no files are configured", async () => {
    const config = makeConfig({ specVersion: "1.0", repository: { requiredFiles: [] } });
    const report = await evaluateRepo(makeRepository(), config);
    expect(byRule(report.findings, "MK-REPO-001")[0]?.status).toBe("skip");
  });
});

describe("MK-PR-001 title convention", () => {
  it("passes a conventional title", async () => {
    const report = await evaluatePr();
    expect(byRule(report.findings, "MK-PR-001")[0]?.status).toBe("pass");
  });

  it("fails a non-conventional title with a remediation", async () => {
    const report = await evaluatePr(makePullRequest({ title: "Update stuff" }));
    const finding = byRule(report.findings, "MK-PR-001")[0];
    expect(finding?.status).toBe("fail");
    expect(finding?.remediation).toContain("feat");
    expect(finding?.evidence.map((entry) => entry.label)).toContain("title");
  });

  it("fails an unknown type and suggests an allowed one", async () => {
    const report = await evaluatePr(makePullRequest({ title: "feature: add thing" }));
    const finding = byRule(report.findings, "MK-PR-001")[0];
    expect(finding?.message).toContain("feature");
    expect(finding?.remediation).toContain("feat");
  });

  it("enforces the maximum length", async () => {
    const report = await evaluatePr(makePullRequest({ title: `feat: ${"x".repeat(90)}` }));
    const messages = byRule(report.findings, "MK-PR-001").map((finding) => finding.message);
    expect(messages.some((message) => message.includes("maximum"))).toBe(true);
  });

  it("requires a scope when configured", async () => {
    const config = makeConfig({
      specVersion: "1.0",
      pullRequests: { title: { convention: "conventional", requireScope: true } },
    });
    const report = await evaluatePr(makePullRequest({ title: "feat: no scope" }), config);
    expect(byRule(report.findings, "MK-PR-001")[0]?.message).toContain("scope");
  });

  it("skips when the convention is disabled", async () => {
    const config = makeConfig({
      specVersion: "1.0",
      pullRequests: { title: { convention: "none" } },
    });
    const report = await evaluatePr(makePullRequest({ title: "Anything goes" }), config);
    expect(byRule(report.findings, "MK-PR-001")[0]?.status).toBe("skip");
  });
});

describe("MK-PR-002 description", () => {
  it("passes a complete description", async () => {
    const report = await evaluatePr();
    expect(byRule(report.findings, "MK-PR-002")[0]?.status).toBe("pass");
  });

  it("fails an empty description", async () => {
    const report = await evaluatePr(makePullRequest({ body: undefined }));
    const finding = byRule(report.findings, "MK-PR-002")[0];
    expect(finding?.status).toBe("fail");
    expect(finding?.message).toContain("no description");
  });

  it("reports every missing section at once", async () => {
    const report = await evaluatePr(
      makePullRequest({ body: "## Summary\nA reasonable summary of the change made here." }),
    );
    const finding = byRule(report.findings, "MK-PR-002")[0];
    expect(finding?.status).toBe("fail");
    expect(finding?.message).toContain("Testing");
  });

  it("does not count commented-out template text", async () => {
    const report = await evaluatePr(makePullRequest({ body: "<!-- ## Summary\n## Testing -->" }));
    expect(byRule(report.findings, "MK-PR-002")[0]?.status).toBe("fail");
  });

  it("requires a linked issue when configured", async () => {
    const config = makeConfig({
      specVersion: "1.0",
      pullRequests: { description: { requireLinkedIssue: true, minLength: 1 } },
    });
    const failing = await evaluatePr(
      makePullRequest({ body: "## Summary\nNo issue reference in this text." }),
      config,
    );
    expect(byRule(failing.findings, "MK-PR-002")[0]?.message).toContain(
      "does not reference an issue",
    );

    const passing = await evaluatePr(
      makePullRequest({ body: "## Summary\nCloses #7 and fixes the bug." }),
      config,
    );
    expect(byRule(passing.findings, "MK-PR-002")[0]?.status).toBe("pass");
  });
});

describe("MK-PR-003 required checks", () => {
  it("passes when the required check succeeded", async () => {
    const report = await evaluatePr();
    expect(byRule(report.findings, "MK-PR-003")[0]?.status).toBe("pass");
  });

  it("fails when the check is missing", async () => {
    const report = await evaluatePr(makePullRequest({ checks: [] }));
    expect(byRule(report.findings, "MK-PR-003")[0]?.message).toContain("has not reported");
  });

  it("fails when the check is still running", async () => {
    const report = await evaluatePr(
      makePullRequest({ checks: [makeCheck({ status: "in_progress", conclusion: undefined })] }),
    );
    expect(byRule(report.findings, "MK-PR-003")[0]?.message).toContain("still in_progress");
  });

  it("fails a failing conclusion", async () => {
    const report = await evaluatePr(
      makePullRequest({ checks: [makeCheck({ conclusion: "failure" })] }),
    );
    expect(byRule(report.findings, "MK-PR-003")[0]?.message).toContain("failure");
  });

  it("rejects skipped unless configured", async () => {
    const pr = makePullRequest({ checks: [makeCheck({ conclusion: "skipped" })] });
    expect((await evaluatePr(pr)).findings.find((f) => f.ruleId === "MK-PR-003")?.status).toBe(
      "fail",
    );

    const config = makeConfig({
      specVersion: "1.0",
      pullRequests: {
        checks: { required: ["verify"], acceptedConclusions: ["success", "skipped"] },
      },
    });
    const report = await evaluatePr(pr, config);
    expect(report.findings.find((f) => f.ruleId === "MK-PR-003")?.status).toBe("pass");
  });

  it("skips when no checks are configured", async () => {
    const config = makeConfig({ specVersion: "1.0", pullRequests: { checks: { required: [] } } });
    const report = await evaluatePr(makePullRequest({ checks: [] }), config);
    expect(byRule(report.findings, "MK-PR-003")[0]?.status).toBe("skip");
  });
});

describe("MK-PR-004 contributor requirements", () => {
  it("passes signed-off commits", async () => {
    const report = await evaluatePr();
    expect(byRule(report.findings, "MK-PR-004")[0]?.status).toBe("pass");
  });

  it("fails unsigned commits", async () => {
    const report = await evaluatePr(
      makePullRequest({ commits: [makeCommit({ signedOff: false, sha: "a".repeat(40) })] }),
    );
    expect(byRule(report.findings, "MK-PR-004")[0]?.message).toContain("Signed-off-by");
  });

  it("skips when commit data is unavailable", async () => {
    const report = await evaluatePr(makePullRequest({ commits: [] }));
    expect(byRule(report.findings, "MK-PR-004")[0]?.status).toBe("skip");
  });

  it("enforces the author association allow-list", async () => {
    const config = makeConfig({
      specVersion: "1.0",
      pullRequests: { contributor: { allowedAuthorAssociations: ["OWNER", "MEMBER"] } },
    });
    const report = await evaluatePr(makePullRequest({ authorAssociation: "NONE" }), config);
    expect(byRule(report.findings, "MK-PR-004")[0]?.message).toContain("not allowed");
  });

  it("skips the allow-list when the provider reports no association", async () => {
    const config = makeConfig({
      specVersion: "1.0",
      pullRequests: { contributor: { allowedAuthorAssociations: ["OWNER"] } },
    });
    const report = await evaluatePr(makePullRequest({ authorAssociation: undefined }), config);
    expect(byRule(report.findings, "MK-PR-004")[0]?.status).toBe("skip");
  });

  it("skips entirely when nothing is configured", async () => {
    const config = makeConfig({ specVersion: "1.0", pullRequests: { contributor: {} } });
    const report = await evaluatePr(makePullRequest({ commits: [] }), config);
    expect(byRule(report.findings, "MK-PR-004")[0]?.status).toBe("skip");
  });
});

describe("MK-SEC-001 repository security", () => {
  const secureRepo = () =>
    makeRepository({
      security: {
        dependencyAlerts: true,
        secretScanning: true,
        branchProtection: true,
        requiredApprovals: 2,
      },
    });

  it("passes when every configured control is enabled", async () => {
    const report = await evaluateRepo(secureRepo());
    const findings = byRule(report.findings, "MK-SEC-001");
    expect(findings.every((finding) => finding.status === "pass")).toBe(true);
    expect(findings).toHaveLength(4);
  });

  it("fails a disabled control", async () => {
    const repository = secureRepo();
    repository.security = { ...repository.security, secretScanning: false };
    const report = await evaluateRepo(repository);
    const failure = byRule(report.findings, "MK-SEC-001").find(
      (finding) => finding.status === "fail",
    );
    expect(failure?.message).toContain("secret scanning");
    expect(failure?.remediation).toBeTruthy();
  });

  it("skips unknown posture instead of guessing", async () => {
    const repository = secureRepo();
    repository.security = {
      dependencyAlerts: "unknown",
      secretScanning: true,
      branchProtection: true,
      requiredApprovals: "unknown",
    };
    const report = await evaluateRepo(repository);
    const skipped = byRule(report.findings, "MK-SEC-001").filter(
      (finding) => finding.status === "skip",
    );
    expect(skipped.length).toBeGreaterThanOrEqual(2);
  });

  it("skips the whole rule for local sources without posture", async () => {
    const report = await evaluateRepo(makeRepository());
    expect(byRule(report.findings, "MK-SEC-001")[0]?.status).toBe("skip");
  });

  it("fails when approvals are below the configured minimum", async () => {
    const repository = secureRepo();
    repository.security = { ...repository.security, requiredApprovals: 0 };
    const report = await evaluateRepo(repository);
    expect(
      byRule(report.findings, "MK-SEC-001").some((finding) => finding.message.includes("approval")),
    ).toBe(true);
  });
});

describe("MK-REL-001 release readiness", () => {
  const changelog = {
    path: "CHANGELOG.md",
    content:
      "# Changelog\n\n## [Unreleased]\n\n- Something\n\n## [1.1.0] - 2026-01-01\n\n- Previous\n",
  };
  const versionFile = {
    path: "package.json",
    content: JSON.stringify({ name: "x", version: "1.1.0" }),
  };

  it("passes a consistent release", async () => {
    const repository = makeRepository({ files: [changelog, versionFile] });
    const report = await evaluatePolicy(
      makeReleaseSubject(repository, { version: "1.1.0" }),
      makeConfig(),
      { now: FIXED_NOW },
    );
    expect(byRule(report.findings, "MK-REL-001")[0]?.status).toBe("pass");
  });

  it("fails when the changelog is missing", async () => {
    const report = await evaluatePolicy(
      makeReleaseSubject(makeRepository({ files: [] }), { version: "1.1.0" }),
      makeConfig(),
      { now: FIXED_NOW },
    );
    expect(byRule(report.findings, "MK-REL-001").some((f) => f.message.includes("missing"))).toBe(
      true,
    );
  });

  it("fails when the version is absent from the changelog", async () => {
    const repository = makeRepository({ files: [changelog, versionFile] });
    const report = await evaluatePolicy(
      makeReleaseSubject(repository, { version: "2.0.0" }),
      makeConfig(),
      { now: FIXED_NOW },
    );
    expect(
      byRule(report.findings, "MK-REL-001").some((f) =>
        f.message.includes("no entry for version 2.0.0"),
      ),
    ).toBe(true);
  });

  it("fails when a version file disagrees", async () => {
    const repository = makeRepository({ files: [changelog, versionFile] });
    const report = await evaluatePolicy(
      makeReleaseSubject(repository, { version: "1.2.0" }),
      makeConfig(),
      { now: FIXED_NOW },
    );
    expect(
      byRule(report.findings, "MK-REL-001").some((f) =>
        f.message.includes("declares version 1.1.0"),
      ),
    ).toBe(true);
  });

  it("skips when no release requirements are configured", async () => {
    const config = makeConfig({ specVersion: "1.0", release: {} });
    const report = await evaluatePolicy(
      makeReleaseSubject(makeRepository(), { version: "1.1.0" }),
      config,
      { now: FIXED_NOW },
    );
    expect(byRule(report.findings, "MK-REL-001")[0]?.status).toBe("skip");
  });
});

describe("evaluation contract", () => {
  it("is deterministic for identical inputs", async () => {
    const first = await evaluatePr(makePullRequest({ title: "bad title" }));
    const second = await evaluatePr(makePullRequest({ title: "bad title" }));
    expect(second.findings).toEqual(first.findings);
    expect(second.summary).toEqual(first.summary);
  });

  it("does not evaluate pull-request rules for a repository subject", async () => {
    const report = await evaluateRepo();
    expect(report.findings.some((finding) => finding.ruleId.startsWith("MK-PR"))).toBe(false);
    expect(report.evaluatedRuleIds).toEqual(["MK-REPO-001", "MK-SEC-001"]);
  });

  it("respects disabled rules without emitting findings", async () => {
    const config = makeConfig({
      specVersion: "1.0",
      rules: { "MK-PR-001": { enabled: false } },
    });
    const report = await evaluatePr(makePullRequest({ title: "not conventional" }), config);
    expect(byRule(report.findings, "MK-PR-001")).toHaveLength(0);
    expect(report.disabledRuleIds).toContain("MK-PR-001");
  });

  it("turns a rule exception into an error finding rather than throwing", async () => {
    const registry = new (await import("../src/rules/registry.js")).PolicyRegistry([
      {
        id: "MK-PR-999",
        title: "Explodes",
        description: "test rule",
        appliesTo: ["pull_request"],
        defaultSeverity: "error",
        policyPath: "/",
        docsAnchor: "#test",
        evaluate(): RuleResult {
          throw new Error("boom");
        },
      },
    ]);
    const report = await evaluatePolicy(makePullRequestSubject(), makeConfig(), {
      now: FIXED_NOW,
      registry,
    });
    expect(report.findings[0]?.status).toBe("error");
    expect(report.findings[0]?.message).toContain("boom");
    expect(report.summary.status).toBe("fail");
  });

  it("treats a rule that returns nothing as an error", async () => {
    const { PolicyRegistry } = await import("../src/rules/registry.js");
    const registry = new PolicyRegistry([
      {
        id: "MK-PR-998",
        title: "Silent",
        description: "test rule",
        appliesTo: ["pull_request"],
        defaultSeverity: "error",
        policyPath: "/",
        docsAnchor: "#test",
        evaluate: () => [],
      },
    ]);
    const report = await evaluatePolicy(makePullRequestSubject(), makeConfig(), {
      now: FIXED_NOW,
      registry,
    });
    expect(report.findings[0]?.status).toBe("error");
  });

  it("applies severity overrides from configuration", async () => {
    const config = makeConfig({
      specVersion: "1.0",
      rules: { "MK-PR-001": { severity: "info" } },
    });
    const report = await evaluatePr(makePullRequest({ title: "bad" }), config);
    expect(byRule(report.findings, "MK-PR-001")[0]?.severity).toBe("info");
    expect(report.summary.status).toBe("pass");
  });

  it("fails on warnings only when the threshold asks for it", async () => {
    const config = makeConfig({
      specVersion: "1.0",
      rules: { "MK-PR-001": { severity: "warning" } },
    });
    const pr = makePullRequest({ title: "bad" });
    const lenient = await evaluatePolicy(makePullRequestSubject(pr), config, { now: FIXED_NOW });
    expect(lenient.summary.status).toBe("pass");

    const strict = await evaluatePolicy(makePullRequestSubject(pr), config, {
      now: FIXED_NOW,
      failOn: "warning",
    });
    expect(strict.summary.status).toBe("fail");
  });

  it("carries stable ids and policy paths on every finding", async () => {
    const report = await evaluatePr(makePullRequest({ title: "bad", body: "" }));
    for (const finding of report.findings) {
      expect(finding.id.startsWith(`${finding.ruleId}:`)).toBe(true);
      expect(finding.policyPath.startsWith("/")).toBe(true);
      expect(finding.docsUrl).toContain("docs/POLICY_RULES.md#");
      // Skips may explain themselves in the message; every actual verdict must show its evidence.
      if (finding.status !== "skip") expect(finding.evidence.length).toBeGreaterThan(0);
    }
  });

  it("produces machine-stable subject identity", async () => {
    const report = await evaluatePr();
    expect(report.subject).toEqual({
      kind: "pull_request",
      label: "acme/widget#42",
      repository: { provider: "github", owner: "acme", name: "widget", defaultBranch: "main" },
      pullRequestNumber: 42,
    });
    expect(report.policyVersion).toBe("1.0");
  });
});
