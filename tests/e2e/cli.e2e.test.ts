import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * End-to-end test against the built CLI binary.
 *
 * Skipped when `dist` is missing: the binary cannot be exercised without a build. `pnpm test:e2e`
 * builds first, and CI always builds before running the full suite.
 */

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const bin = join(repoRoot, "packages", "interfaces", "cli", "dist", "bin.js");
const built = existsSync(bin);

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(args: string[], cwd: string): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [bin, ...args], {
      cwd,
      env: { PATH: process.env.PATH ?? "", NO_COLOR: "1" },
      timeout: 30_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const typed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typed.code ?? 1, stdout: typed.stdout ?? "", stderr: typed.stderr ?? "" };
  }
}

describe.skipIf(!built)("CLI binary (e2e)", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "maintainerkit-e2e-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("runs with no arguments and shows help", async () => {
    const result = await run(["--help"], workspace);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: maintainerkit");
  });

  it("initialises, validates, audits and checks a fresh repository", async () => {
    const init = await run(["init"], workspace);
    expect(init.code).toBe(0);

    const validate = await run(["validate", "--json"], workspace);
    expect(validate.code).toBe(0);
    const validation = JSON.parse(validate.stdout) as { valid: boolean; policyVersion: string };
    expect(validation).toEqual(expect.objectContaining({ valid: true, policyVersion: "1.0" }));

    await writeFile(
      join(workspace, "README.md"),
      `# Widget\n\n${"Widget does a thing. ".repeat(20)}\n`,
      "utf8",
    );
    await writeFile(join(workspace, "LICENSE"), "Apache License\nVersion 2.0\n", "utf8");
    await writeFile(join(workspace, "CONTRIBUTING.md"), "# Contributing\n", "utf8");
    await writeFile(join(workspace, "SECURITY.md"), "# Security\n", "utf8");
    await writeFile(join(workspace, "CODE_OF_CONDUCT.md"), "# CoC\n", "utf8");

    const audit = await run(["audit", "--json"], workspace);
    expect(audit.code).toBe(0);
    const report = JSON.parse(audit.stdout) as {
      schemaVersion: string;
      kind: string;
      summary: { status: string; total: number };
    };
    expect(report.schemaVersion).toBe("1");
    expect(report.kind).toBe("audit");
    expect(report.summary.total).toBeGreaterThan(0);

    const check = await run(["check"], workspace);
    expect(check.code).toBe(0);
    expect(check.stdout).toContain("Result: PASS");

    const explain = await run(["explain", "exit-codes"], workspace);
    expect(explain.code).toBe(0);
    expect(explain.stdout).toContain("policy failure");
  });

  it("exits 1 for policy findings and 2 for invalid configuration", async () => {
    await writeFile(
      join(workspace, "maintainerkit.yml"),
      'specVersion: "1.0"\nrepository:\n  requiredFiles: [README.md, MISSING.md]\n',
      "utf8",
    );
    await writeFile(join(workspace, "README.md"), "# Widget", "utf8");

    const failing = await run(["check"], workspace);
    expect(failing.code).toBe(1);

    await writeFile(join(workspace, "maintainerkit.yml"), 'specVersion: "9.9"\n', "utf8");
    const invalid = await run(["validate"], workspace);
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toContain("contribspec/unsupported-version");
  });

  it("writes a report file that the report command can re-render", async () => {
    await run(["init"], workspace);
    await writeFile(join(workspace, "README.md"), "# Widget", "utf8");
    const check = await run(["check", "--format", "json", "--output", "report.json"], workspace);
    expect([0, 1]).toContain(check.code);

    const rerendered = await run(
      ["report", "--input", "report.json", "--format", "markdown"],
      workspace,
    );
    expect(rerendered.code).toBe(0);
    expect(rerendered.stdout).toContain("MaintainerKit policy check");
    expect(await readFile(join(workspace, "report.json"), "utf8")).toContain(
      '"schemaVersion": "1"',
    );
  });
});

describe.skipIf(built)("CLI binary (e2e)", () => {
  it("requires a build", () => {
    // Makes the skip visible instead of silent: run `pnpm build` (or `pnpm test:e2e`).
    expect(built).toBe(false);
  });
});
