import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateContribSpecSource } from "@maintainerkit/contribspec";
import { getDefaultRegistry } from "@maintainerkit/policy-engine";
import { createLocalRepository } from "@maintainerkit/git-integration";
import { runCheck } from "@maintainerkit/workflow-engine";

/**
 * Documentation examples are executable.
 *
 * A policy document in `examples/` that does not validate, or an example that fails its own policy, is a
 * documentation bug. This suite keeps the examples honest instead of aspirational.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const examplesDir = join(repoRoot, "examples");

const exampleDirectories = readdirSync(examplesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "sdk")
  .map((entry) => entry.name);

describe("example policy documents", () => {
  it("there is at least one example", () => {
    expect(exampleDirectories.length).toBeGreaterThanOrEqual(3);
  });

  it.each(exampleDirectories)("examples/%s validates", async (directory) => {
    const source = readFileSync(join(examplesDir, directory, "maintainerkit.yml"), "utf8");
    const result = await validateContribSpecSource(source, {
      sourceId: `examples/${directory}/maintainerkit.yml`,
      knownRuleIds: getDefaultRegistry().ids(),
    });

    const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    expect(errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.resolved?.specVersion).toBe("1.0");
  });
});

describe("examples/minimal is runnable", () => {
  it("passes its own policy", async () => {
    const root = join(examplesDir, "minimal");
    const loaded = await validateContribSpecSource(
      readFileSync(join(root, "maintainerkit.yml"), "utf8"),
      { knownRuleIds: getDefaultRegistry().ids() },
    );
    expect(loaded.resolved).toBeDefined();

    const source = await createLocalRepository({ root, readGitMetadata: false });
    const { report } = await runCheck({
      source,
      config: loaded.resolved!,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(report.summary.status).toBe("pass");
    expect(report.summary.fail).toBe(0);
  });

  it("is a useful audit example (the short README is reported, not hidden)", async () => {
    const root = join(examplesDir, "minimal");
    const source = await createLocalRepository({ root, readGitMetadata: false });
    const { runAudit } = await import("@maintainerkit/workflow-engine");
    const { report } = await runAudit({ source, now: new Date("2026-01-01T00:00:00.000Z") });

    // The example intentionally documents the failure output, so at least one check must fail here.
    expect(report.findings.some((finding) => finding.status === "fail")).toBe(true);
    expect(report.kind).toBe("audit");
  });
});

describe("SDK example", () => {
  it("exists and uses the documented facade", () => {
    const source = readFileSync(join(examplesDir, "sdk", "check.mjs"), "utf8");
    expect(source).toContain("createMaintainerKit");
    expect(source).toContain("@maintainerkit/sdk");
  });
});
