import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONTRIBSPEC_VERSION,
  isSupportedSpecVersion,
  loadContribSpec,
  migrateDocument,
  parseSpecVersion,
  resolveConfig,
  validateContribSpecDocument,
  validateContribSpecSource,
} from "../src/index.js";

const minimal = `specVersion: "1.0"\n`;

const packagesRoot = fileURLToPath(new URL("../../..", import.meta.url));

describe("version handling", () => {
  it("parses MAJOR.MINOR", () => {
    expect(parseSpecVersion("1.0")).toEqual({ major: 1, minor: 0 });
    expect(parseSpecVersion("1.12")).toEqual({ major: 1, minor: 12 });
  });

  it("rejects malformed versions", () => {
    expect(parseSpecVersion("1")).toBeNull();
    expect(parseSpecVersion("v1.0")).toBeNull();
    expect(parseSpecVersion("1.0.0")).toBeNull();
  });

  it("accepts the current version and warns about a newer minor", async () => {
    expect(isSupportedSpecVersion(CONTRIBSPEC_VERSION)).toBe(true);
    const result = await validateContribSpecSource(`specVersion: "1.7"\n`);
    expect(result.valid).toBe(true);
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("contribspec/newer-minor");
  });

  it("fails explicitly on an unknown major version", async () => {
    const result = await validateContribSpecSource(`specVersion: "2.0"\n`);
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("contribspec/unsupported-version");
    expect(result.diagnostics[0]?.message).toContain("not supported");
  });
});

describe("schema validation", () => {
  it("accepts a minimal document and resolves defaults", async () => {
    const result = await validateContribSpecSource(minimal);
    expect(result.valid).toBe(true);
    expect(result.resolved?.pullRequests.title.convention).toBe("conventional");
    expect(result.resolved?.repository.requiredFiles.map((file) => file.path)).toEqual([
      "README.md",
      "LICENSE",
    ]);
    expect(result.resolved?.agents.humanApprovalRequired).toBe(true);
    expect(result.resolved?.ai.enabled).toBe(false);
  });

  it("reports a non-object document", async () => {
    const result = await validateContribSpecSource("[]");
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("contribspec/not-an-object");
  });

  it("treats an empty file as an error", async () => {
    const result = await validateContribSpecSource("# only a comment\n");
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("contribspec/empty-document");
  });

  it("reports YAML syntax errors with a location", async () => {
    const result = await validateContribSpecSource('specVersion: "1.0"\n  bad: indent\n');
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("contribspec/invalid-yaml");
    expect(result.diagnostics[0]?.message).toMatch(/line \d+/);
  });

  it("rejects duplicate YAML keys", async () => {
    const result = await validateContribSpecSource('specVersion: "1.0"\nspecVersion: "1.0"\n');
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("contribspec/invalid-yaml");
  });

  it("rejects unknown properties instead of ignoring typos", async () => {
    const result = await validateContribSpecSource(
      `${minimal}pullRequests:\n  titel:\n    maxLength: 5\n`,
    );
    expect(result.valid).toBe(false);
    const message = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(message).toContain('unknown property "titel"');
    expect(result.diagnostics[0]?.path).toBe("/pullRequests");
  });

  it("rejects a missing specVersion with a pointer", async () => {
    const result = await validateContribSpecSource("metadata:\n  name: x\n");
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]?.message).toContain('missing required property "specVersion"');
    expect(result.diagnostics[0]?.path).toBe("");
  });

  it("rejects out-of-range numbers", async () => {
    const result = await validateContribSpecSource(
      `${minimal}pullRequests:\n  title:\n    maxLength: 0\n`,
    );
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]?.path).toBe("/pullRequests/title/maxLength");
  });

  it("rejects an empty type list", async () => {
    const result = await validateContribSpecSource(
      `${minimal}pullRequests:\n  title:\n    types: []\n`,
    );
    expect(result.valid).toBe(false);
  });
});

describe("semantic validation", () => {
  it("warns about duplicated required files", async () => {
    const result = await validateContribSpecSource(
      `${minimal}repository:\n  requiredFiles:\n    - README.md\n    - README.md\n`,
    );
    expect(result.valid).toBe(true);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "contribspec/duplicate-file",
    );
  });

  it("rejects path traversal in required files", async () => {
    const result = await validateContribSpecSource(
      `${minimal}repository:\n  requiredFiles:\n    - ../secrets.txt\n`,
    );
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("contribspec/unsafe-path");
  });

  it("rejects capabilities without AI enabled", async () => {
    const result = await validateContribSpecSource(
      `${minimal}ai:\n  capabilities:\n    - risk-analysis\n`,
    );
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("contribspec/capabilities-without-ai");
  });

  it("rejects AI enabled without capabilities", async () => {
    const result = await validateContribSpecSource(`${minimal}ai:\n  enabled: true\n`);
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("contribspec/ai-without-capabilities");
  });

  it("refuses to disable human approval while mutating operations are allowed", async () => {
    const result = await validateContribSpecSource(
      `${minimal}agents:\n  allowedOperations: [read, merge]\n  humanApprovalRequired: false\n`,
    );
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("contribspec/agents-approval-disabled");
  });

  it("warns when approvals are configured without branch protection", async () => {
    const result = await validateContribSpecSource(
      `${minimal}security:\n  minimumApprovals: 2\n  requireBranchProtection: false\n`,
    );
    expect(result.valid).toBe(true);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "contribspec/approvals-without-protection",
    );
  });

  it("rejects rule overrides that do not exist", async () => {
    const result = await validateContribSpecDocument(
      { specVersion: "1.0", rules: { "MK-PR-999": { severity: "info" } } },
      { knownRuleIds: ["MK-PR-001"] },
    );
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("contribspec/unknown-rule");
  });

  it("accepts rule overrides that exist", async () => {
    const result = await validateContribSpecDocument(
      { specVersion: "1.0", rules: { "MK-PR-001": { severity: "warning", enabled: true } } },
      { knownRuleIds: ["MK-PR-001"] },
    );
    expect(result.valid).toBe(true);
    expect(result.resolved?.rules["MK-PR-001"]?.severity).toBe("warning");
  });
});

describe("resolution", () => {
  it("normalises shorthand required files and keeps descriptions", () => {
    const resolved = resolveConfig({
      specVersion: "1.0",
      repository: {
        requiredFiles: ["SECURITY.md", { path: "LICENSE", description: "Legal terms" }],
      },
    });
    expect(resolved.repository.requiredFiles).toEqual([
      { path: "SECURITY.md" },
      { path: "LICENSE", description: "Legal terms" },
    ]);
  });

  it("defaults human approval lists to every mutating operation", () => {
    const resolved = resolveConfig({ specVersion: "1.0" });
    expect(resolved.ai.requireHumanApprovalFor).toEqual([
      "comment",
      "label",
      "close",
      "merge",
      "release",
      "push",
    ]);
  });
});

describe("migrations", () => {
  it("returns the document unchanged when it is already current", () => {
    const result = migrateDocument({ specVersion: "1.0" }, "1.0");
    expect(result.applied).toEqual([]);
    expect(result.version).toBe("1.0");
  });

  it("fails loudly when no migration path exists", () => {
    expect(() => migrateDocument({ specVersion: "0.9" }, "1.0")).toThrowError(
      /not supported|No migration/,
    );
  });
});

describe("loading from disk", () => {
  it("finds a config file by name and records a checksum", async () => {
    const loaded = await loadContribSpec(packagesRoot);
    expect(
      loaded.path.endsWith("maintainerkit.yml") || loaded.path.endsWith("maintainerkit.yaml"),
    ).toBe(true);
    expect(loaded.checksum).toMatch(/^sha256:[0-9a-f]{16}$/);
  });

  it("throws a config error when no document exists", async () => {
    const empty = await mkdtemp(join(tmpdir(), "maintainerkit-empty-"));
    try {
      await expect(loadContribSpec(empty)).rejects.toThrow(/No ContribSpec document found/);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe("published schema", () => {
  it("is identical to the schema shipped in the package", () => {
    const inPackage = readFileSync(
      new URL("../src/schema/contribspec-1.0.schema.json", import.meta.url),
      "utf8",
    );
    const published = readFileSync(`${packagesRoot}/schemas/contribspec-1.0.schema.json`, "utf8");
    expect(JSON.parse(inPackage)).toEqual(JSON.parse(published));
  });
});
