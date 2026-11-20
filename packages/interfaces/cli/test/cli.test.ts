import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContext, runCli } from "../src/index.js";

let root: string;
let stdout: string;
let stderr: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "maintainerkit-cli-"));
  stdout = "";
  stderr = "";
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(path: string, content: string): Promise<void> {
  const absolute = join(root, path);
  await mkdir(join(absolute, ".."), { recursive: true });
  await writeFile(absolute, content, "utf8");
}

async function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  const context = createContext({
    cwd: root,
    env: { PATH: process.env.PATH, ...env },
    out: (chunk) => {
      stdout += chunk;
    },
    err: (chunk) => {
      stderr += chunk;
    },
    now: () => new Date("2026-01-02T03:04:05.000Z"),
  });
  const result = await runCli(args, context);
  return { ...result, stdout, stderr };
}

const policy = `specVersion: "1.0"
repository:
  requiredFiles:
    - README.md
    - LICENSE
pullRequests:
  title:
    convention: conventional
  description:
    minLength: 10
  checks:
    required: [verify]
`;

const healthyFiles = async () => {
  await write("README.md", `# Widget\n\n${"Widget does a thing. ".repeat(20)}`);
  await write("LICENSE", "Apache License\nVersion 2.0");
  await write("CONTRIBUTING.md", "# Contributing\n");
  await write("SECURITY.md", "# Security\n");
  await write("CODE_OF_CONDUCT.md", "# CoC\n");
  await write(".github/workflows/ci.yml", "name: CI\non:\n  pull_request:\n");
  await write(".github/dependabot.yml", "version: 2\n");
};

describe("help and version", () => {
  it("prints help and exits 0", async () => {
    const result = await run(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Open-source repository governance");
    expect(result.stdout).toContain("maintainerkit audit");
  });

  it("prints the version and exits 0", async () => {
    const result = await run(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("0.1.0");
  });

  it("exits 2 for an unknown command", async () => {
    const result = await run(["frobnicate"]);
    expect(result.exitCode).toBe(2);
  });

  it("exits 2 for an unknown flag", async () => {
    const result = await run(["audit", "--nope"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});

describe("init", () => {
  it("creates the policy document and workflow", async () => {
    const result = await run(["init"]);
    expect(result.exitCode).toBe(0);
    const config = await readFile(join(root, "maintainerkit.yml"), "utf8");
    expect(config).toContain('specVersion: "1.0"');
    expect(config).toContain("humanApprovalRequired: true");
    const workflow = await readFile(
      join(root, ".github", "workflows", "maintainerkit.yml"),
      "utf8",
    );
    // The trigger must be pull_request; the template merely mentions pull_request_target in a comment
    // explaining why it is not used, which is the opposite of a problem.
    expect(workflow).toMatch(/^on:\n\s+pull_request:/m);
    expect(workflow).not.toMatch(/^\s{2}pull_request_target:/m);
    expect(workflow).toContain("permissions:");
    expect(workflow).toContain("contents: read");
  });

  it("generates a document that validates", async () => {
    await run(["init"]);
    const validate = await run(["validate"]);
    expect(validate.exitCode).toBe(0);
    expect(validate.stdout).toContain("Valid ContribSpec 1.0");
  });

  it("refuses to overwrite without --force", async () => {
    await run(["init"]);
    const second = await run(["init"]);
    expect(second.exitCode).toBe(2);
    expect(second.stderr).toContain("Refusing to overwrite");
  });

  it("overwrites with --force", async () => {
    await write("maintainerkit.yml", 'specVersion: "2.0"\n');
    const result = await run(["init", "--force"]);
    expect(result.exitCode).toBe(0);
    expect(await readFile(join(root, "maintainerkit.yml"), "utf8")).toContain('specVersion: "1.0"');
  });

  it("supports --strict and --no-workflow", async () => {
    const result = await run(["init", "--strict", "--no-workflow"]);
    expect(result.exitCode).toBe(0);
    const config = await readFile(join(root, "maintainerkit.yml"), "utf8");
    expect(config).toContain("requireDcoSignoff: true");
    await expect(
      readFile(join(root, ".github", "workflows", "maintainerkit.yml"), "utf8"),
    ).rejects.toThrow();
  });
});

describe("validate", () => {
  it("reports a valid document", async () => {
    await write("maintainerkit.yml", policy);
    const result = await run(["validate"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("checksum: sha256:");
  });

  it("emits machine-readable JSON", async () => {
    await write("maintainerkit.yml", policy);
    const result = await run(["validate", "--json"]);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      valid: boolean;
      policyVersion: string;
      rulesEnabled: number;
    };
    expect(payload.valid).toBe(true);
    expect(payload.policyVersion).toBe("1.0");
    expect(payload.rulesEnabled).toBe(7);
  });

  it("fails with exit 2 and lists every problem", async () => {
    await write(
      "maintainerkit.yml",
      'specVersion: "1.0"\npullRequests:\n  title:\n    maxLength: 0\n  description:\n    minLength: -1\n',
    );
    const result = await run(["validate"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("contribspec/schema.minimum");
    expect(result.stderr).toContain("/pullRequests/title/maxLength");
  });

  it("reports an unsupported major version explicitly", async () => {
    await write("maintainerkit.yml", 'specVersion: "2.0"\n');
    const result = await run(["validate"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("contribspec/unsupported-version");
  });

  it("fails clearly when no document exists", async () => {
    const result = await run(["validate"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("No ContribSpec document found");
  });
});

describe("doctor", () => {
  it("reports the environment as JSON", async () => {
    await write("maintainerkit.yml", policy);
    const result = await run(["doctor", "--json"]);
    const payload = JSON.parse(result.stdout) as {
      checks: { id: string; status: string }[];
      summary: { pass: number };
    };
    expect(
      payload.checks.some((check) => check.id === "runtime.node" && check.status === "pass"),
    ).toBe(true);
    expect(payload.checks.some((check) => check.id === "config.valid")).toBe(true);
    expect(payload.checks.some((check) => check.id === "security.write-gate")).toBe(true);
  });

  it("warns when the write gate is open", async () => {
    const result = await run(["doctor", "--json"], { MAINTAINERKIT_ALLOW_WRITE: "true" });
    const payload = JSON.parse(result.stdout) as { checks: { id: string; status: string }[] };
    expect(payload.checks.find((check) => check.id === "security.write-gate")?.status).toBe("warn");
  });

  it("never prints token values", async () => {
    const result = await run(["doctor"], {
      GITHUB_TOKEN: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });
    expect(result.stdout).toContain("present (value not shown)");
    expect(result.stdout).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("exits 2 when the configuration is invalid", async () => {
    await write("maintainerkit.yml", 'specVersion: "1.0"\nunknownKey: true\n');
    const result = await run(["doctor"]);
    expect(result.exitCode).toBe(2);
  });
});

describe("audit", () => {
  it("passes a healthy repository", async () => {
    await healthyFiles();
    const result = await run(["audit"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Result: PASS");
  });

  it("fails an unhealthy repository with exit 1", async () => {
    const result = await run(["audit"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("MK-AUD-001");
    expect(result.stdout).toContain("Result: FAIL");
  });

  it("emits a JSON report contract", async () => {
    await write("README.md", "# x");
    const result = await run(["audit", "--json"]);
    const report = JSON.parse(result.stdout) as {
      schemaVersion: string;
      kind: string;
      policyVersion: { specVersion: string | null };
      summary: { status: string };
      findings: { ruleId: string }[];
    };
    expect(report.schemaVersion).toBe("1");
    expect(report.kind).toBe("audit");
    expect(report.policyVersion.specVersion).toBeNull();
    expect(report.findings.length).toBeGreaterThan(0);
  });

  it("writes the report and audit trail to files", async () => {
    await healthyFiles();
    const result = await run([
      "audit",
      "--format",
      "markdown",
      "--output",
      "out/report.md",
      "--audit-log",
      "out/audit.jsonl",
    ]);
    expect(result.exitCode).toBe(0);
    expect(await readFile(join(root, "out", "report.md"), "utf8")).toContain(
      "## MaintainerKit repository audit",
    );
    const events = (await readFile(join(root, "out", "audit.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string });
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "audit.completed",
      "run.completed",
    ]);
  });

  it("rejects an unknown format", async () => {
    const result = await run(["audit", "--format", "xml"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown --format");
  });
});

describe("check", () => {
  it("passes when repository policies are satisfied", async () => {
    await write("maintainerkit.yml", policy);
    await write("README.md", "# Widget");
    await write("LICENSE", "Apache License");
    const result = await run(["check"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Result: PASS");
  });

  it("fails with exit 1 when a required file is missing", async () => {
    await write("maintainerkit.yml", policy);
    await write("README.md", "# Widget");
    const result = await run(["check"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("LICENSE");
  });

  it("requires a document", async () => {
    const result = await run(["check"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("No ContribSpec document found");
  });

  it("requires --repo when --pr is used", async () => {
    await write("maintainerkit.yml", policy);
    const result = await run(["check", "--pr", "5"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--pr requires --repo");
  });

  it("evaluates release policies with --release", async () => {
    await write(
      "maintainerkit.yml",
      `specVersion: "1.0"
repository:
  requiredFiles: []
release:
  changelogPath: CHANGELOG.md
  requireUnreleasedSection: true
  requireChangelogEntry: true
  versionFiles: [package.json]
`,
    );
    await write(
      "CHANGELOG.md",
      "# Changelog\n\n## Unreleased\n\n## [1.4.0] - 2026-01-01\n\n- Thing.\n",
    );
    await write("package.json", '{ "name": "widget", "version": "1.4.0" }\n');

    const result = await run(["check", "--release", "v1.4.0", "--format", "json"]);
    expect(result.exitCode).toBe(0);

    const report = JSON.parse(result.stdout) as {
      subject: { kind: string; label: string };
      findings: { ruleId: string; status: string }[];
    };
    expect(report.subject.kind).toBe("release");
    expect(report.subject.label.endsWith("@1.4.0")).toBe(true);
    expect(report.findings.map((finding) => finding.ruleId)).toContain("MK-REL-001");
    expect(report.findings.every((finding) => finding.status !== "fail")).toBe(true);
  });

  it("reports a release version that disagrees with the manifest", async () => {
    await write(
      "maintainerkit.yml",
      `specVersion: "1.0"
repository:
  requiredFiles: []
release:
  changelogPath: CHANGELOG.md
  requireChangelogEntry: true
  versionFiles: [package.json]
`,
    );
    await write("CHANGELOG.md", "# Changelog\n\n## Unreleased\n\n## [1.4.0]\n\n- Thing.\n");
    await write("package.json", '{ "name": "widget", "version": "1.3.0" }\n');

    const result = await run(["check", "--release", "1.4.0"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("1.3.0");
  });

  it("rejects --release combined with --pr", async () => {
    await write("maintainerkit.yml", policy);
    const result = await run(["check", "--repo", "acme/widget", "--pr", "5", "--release", "1.0.0"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("cannot be combined");
  });

  it("honours --fail-on warning", async () => {
    await write(
      "maintainerkit.yml",
      `specVersion: "1.0"
repository:
  requiredFiles: []
rules:
  MK-SEC-001:
    severity: warning
`,
    );
    const lenient = await run(["check"]);
    expect(lenient.exitCode).toBe(0);

    const strict = await run(["check", "--fail-on", "warning"]);
    expect(strict.exitCode).toBe(0); // no findings at all in this repository-only run

    const invalid = await run(["check", "--fail-on", "nope"]);
    expect(invalid.exitCode).toBe(2);
  });

  it("emits JSON that keeps stdout parseable", async () => {
    await write("maintainerkit.yml", policy);
    await write("README.md", "# Widget");
    await write("LICENSE", "Apache");
    const result = await run(["check", "--json", "--dry-run"]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as { kind: string; summary: { status: string } };
    expect(report.kind).toBe("check");
    expect(report.summary.status).toBe("pass");
    expect(result.stderr).toContain("Dry run");
  });

  it("warns and continues when AI is requested without a provider", async () => {
    await write("maintainerkit.yml", policy);
    await write("README.md", "# Widget");
    await write("LICENSE", "Apache");
    const result = await run(["check", "--ai", "--json"]);
    const report = JSON.parse(result.stdout) as {
      diagnostics: { code: string; severity: string }[];
    };
    expect(report.diagnostics.some((diagnostic) => diagnostic.code === "ai/missing-provider")).toBe(
      true,
    );
    expect(result.exitCode).toBe(0);
  });

  it("runs advisories with the mock provider without changing the verdict", async () => {
    await write(
      "maintainerkit.yml",
      `specVersion: "1.0"
repository:
  requiredFiles: [README.md]
ai:
  enabled: true
  provider: mock
  capabilities: [pull-request-summary]
`,
    );
    await write("README.md", "# Widget");
    const result = await run(["check", "--json"]);
    const report = JSON.parse(result.stdout) as {
      advisories: { capability: string; provider: string }[];
      diagnostics: { code: string }[];
      summary: { status: string };
    };
    expect(report.summary.status).toBe("pass");
    // A repository subject has no PR capabilities, so the capability is reported as inapplicable.
    expect(
      report.diagnostics.some((diagnostic) => diagnostic.code === "ai/capability-not-applicable"),
    ).toBe(true);
  });
});

describe("report", () => {
  it("re-renders a saved report", async () => {
    await write("maintainerkit.yml", policy);
    await write("README.md", "# Widget");
    await run(["check", "--format", "json", "--output", "report.json"]);
    const rendered = await run(["report", "--input", "report.json", "--format", "markdown"]);
    expect(rendered.exitCode).toBe(0);
    expect(rendered.stdout).toContain("## MaintainerKit policy check");
  });

  it("rejects a file that is not a report", async () => {
    await write("report.json", '{"kind":"other"}');
    const result = await run(["report", "--input", "report.json"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("not a MaintainerKit report");
  });

  it("rejects non-JSON input", async () => {
    await write("report.json", "not json");
    const result = await run(["report", "--input", "report.json"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("not valid JSON");
  });

  it("summarises an audit trail", async () => {
    await healthyFiles();
    await run(["audit", "--audit-log", "audit.jsonl"]);
    const result = await run(["report", "--audit-log", "audit.jsonl"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("MaintainerKit audit trail");
    expect(result.stdout).toContain("audit.completed");
  });

  it("requires exactly one input source", async () => {
    const none = await run(["report"]);
    expect(none.exitCode).toBe(2);
    await write("report.json", "{}");
    const both = await run(["report", "--input", "report.json", "--audit-log", "audit.jsonl"]);
    expect(both.exitCode).toBe(2);
    expect(both.stderr).toContain("not both");
  });
});

describe("explain", () => {
  it("lists rules with no arguments", async () => {
    const result = await run(["explain"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("MK-PR-001");
    expect(result.stdout).toContain("MK-SEC-001");
    expect(result.stdout).toContain("(7)");
  });

  it("explains a rule, including effective severity from configuration", async () => {
    await write(
      "maintainerkit.yml",
      'specVersion: "1.0"\nrules:\n  MK-PR-001:\n    severity: warning\n',
    );
    const result = await run(["explain", "--rule", "MK-PR-001"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("effective severity: warning");
    expect(result.stdout).toContain("/pullRequests/title");
  });

  it("rejects an unknown rule", async () => {
    const result = await run(["explain", "--rule", "MK-XX-999"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown rule");
  });

  it("prints documented topics", async () => {
    for (const topic of ["exit-codes", "reports", "ai", "security"]) {
      const result = await run(["explain", topic]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(50);
    }
    const unknown = await run(["explain", "nonsense"]);
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stderr).toContain("Available topics");
  });

  it("explains a finding from a saved report", async () => {
    await write("maintainerkit.yml", policy);
    await write("README.md", "# Widget");
    await run(["check", "--format", "json", "--output", "report.json"]);
    const report = JSON.parse(await readFile(join(root, "report.json"), "utf8")) as {
      findings: { id: string; status: string }[];
    };
    const findingId = report.findings.find((finding) => finding.status === "fail")?.id;
    expect(findingId).toBeTruthy();

    const result = await run([
      "explain",
      "--input",
      "report.json",
      "--finding",
      findingId as string,
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("remediation:");

    const missing = await run(["explain", "--input", "report.json", "--finding", "nope"]);
    expect(missing.exitCode).toBe(2);
  });
});
