import { describe, expect, it } from "vitest";
import {
  AUDIT_CHECKS,
  auditRepository,
  branchProtectionCheck,
  ciCheck,
  codeOfConductCheck,
  contributingCheck,
  dependencyCheck,
  licenseCheck,
  readmeCheck,
  securityPolicyCheck,
  securitySettingsCheck,
  type AuditCheck,
} from "../src/checks.js";
import { healthyRepository, makeRepository } from "./fixtures.js";

const NOW = new Date("2026-05-06T07:08:09.000Z");

async function check(checkDefinition: AuditCheck, repo = healthyRepository()) {
  const findings = await checkDefinition.evaluate({ repository: repo, now: NOW.toISOString() });
  return findings[0];
}

describe("the check catalog", () => {
  it("has nine documented checks with unique ids and pass conditions", () => {
    expect(AUDIT_CHECKS).toHaveLength(9);
    expect(new Set(AUDIT_CHECKS.map((entry) => entry.id)).size).toBe(9);
    for (const entry of AUDIT_CHECKS) {
      expect(entry.id).toMatch(/^MK-AUD-0[0-9]{2}$/);
      expect(entry.passCondition.length).toBeGreaterThan(20);
      expect(entry.defaultSeverity === "error" || entry.defaultSeverity === "warning").toBe(true);
    }
  });

  it("passes every check on a healthy repository", async () => {
    const result = await auditRepository(healthyRepository(), { now: NOW });
    const failures = result.findings.filter((entry) => entry.status === "fail");
    expect(failures).toEqual([]);
    expect(result.status).toBe("pass");
    expect(result.counts.pass).toBe(9);
  });
});

describe("documentation checks", () => {
  it("fails a missing README", async () => {
    const finding = await check(readmeCheck, makeRepository({ files: [] }));
    expect(finding?.status).toBe("fail");
    expect(finding?.remediation).toBeTruthy();
  });

  it("fails a stub README", async () => {
    const finding = await check(
      readmeCheck,
      makeRepository({ files: [{ path: "README.md", content: "# Widget" }] }),
    );
    expect(finding?.status).toBe("fail");
    expect(finding?.message).toContain("at least 200");
  });

  it("passes a README when contents are not readable, on presence alone", async () => {
    const repo = makeRepository({ files: [{ path: "README.md" }] });
    delete repo.readFile;
    const finding = await check(readmeCheck, repo);
    expect(finding?.status).toBe("pass");
    expect(finding?.evidence.some((entry) => entry.value.includes("not inspected"))).toBe(true);
  });

  it("identifies a license family from content", async () => {
    const repo = makeRepository({
      files: [
        { path: "LICENSE", content: "MIT License\n\nPermission is hereby granted, free of charge" },
      ],
    });
    const finding = await check(licenseCheck, repo);
    expect(finding?.status).toBe("pass");
    expect(finding?.evidence.some((entry) => entry.value === "MIT")).toBe(true);
  });

  it("accepts provider-reported license metadata without a file", async () => {
    const finding = await check(licenseCheck, makeRepository({ licenseSpdx: "Apache-2.0" }));
    expect(finding?.status).toBe("pass");
    expect(finding?.evidence.some((entry) => entry.value === "Apache-2.0")).toBe(true);
  });

  it("fails when neither a license file nor metadata exists", async () => {
    const finding = await check(licenseCheck, makeRepository({ files: [] }));
    expect(finding?.status).toBe("fail");
  });

  it("fails an unidentifiable license", async () => {
    const repo = makeRepository({
      files: [{ path: "LICENSE", content: "All rights reserved, ask me." }],
    });
    const finding = await check(licenseCheck, repo);
    expect(finding?.status).toBe("fail");
  });

  it("flags missing guidance documents at their documented severities", async () => {
    const repo = makeRepository({ files: [] });
    expect((await check(contributingCheck, repo))?.status).toBe("fail");
    expect((await check(contributingCheck, repo))?.severity).toBe("warning");
    expect((await check(securityPolicyCheck, repo))?.severity).toBe("error");
    expect((await check(codeOfConductCheck, repo))?.severity).toBe("warning");
  });
});

describe("CI check", () => {
  it("fails when no workflow exists", async () => {
    const finding = await check(ciCheck, makeRepository({ files: [] }));
    expect(finding?.status).toBe("fail");
  });

  it("fails a workflow without a trigger", async () => {
    const repo = makeRepository({
      files: [{ path: ".github/workflows/ci.yml", content: "name: CI\njobs: {}\n" }],
    });
    const finding = await check(ciCheck, repo);
    expect(finding?.status).toBe("fail");
    expect(finding?.message).toContain("trigger");
  });

  it("accepts a quoted trigger key", async () => {
    const repo = makeRepository({
      files: [{ path: ".github/workflows/ci.yml", content: 'name: CI\n"on":\n  push:\n' }],
    });
    expect((await check(ciCheck, repo))?.status).toBe("pass");
  });

  it("passes on presence when contents are unavailable", async () => {
    const repo = makeRepository({ files: [{ path: ".github/workflows/ci.yml" }] });
    delete repo.readFile;
    expect((await check(ciCheck, repo))?.status).toBe("pass");
  });
});

describe("dependency check", () => {
  it("passes with dependabot config", async () => {
    const repo = makeRepository({
      files: [{ path: ".github/dependabot.yml", content: "version: 2\n" }],
    });
    expect((await check(dependencyCheck, repo))?.status).toBe("pass");
  });

  it("passes when provider alerts are enabled", async () => {
    const repo = makeRepository({ security: { dependencyAlerts: true } });
    expect((await check(dependencyCheck, repo))?.status).toBe("pass");
  });

  it("fails when alerts are explicitly disabled", async () => {
    const repo = makeRepository({ security: { dependencyAlerts: false } });
    const finding = await check(dependencyCheck, repo);
    expect(finding?.status).toBe("fail");
    expect(finding?.message).toContain("disabled");
  });

  it("fails when nothing is configured and state is unknown", async () => {
    const finding = await check(dependencyCheck, makeRepository({ files: [] }));
    expect(finding?.status).toBe("fail");
  });
});

describe("security checks", () => {
  it("skips security settings for local sources", async () => {
    const finding = await check(securitySettingsCheck, makeRepository({ files: [] }));
    expect(finding?.status).toBe("skip");
  });

  it("fails a disabled control and lists it", async () => {
    const repo = makeRepository({
      security: { secretScanning: true, dependencyAlerts: false, pushProtection: true },
    });
    const finding = await check(securitySettingsCheck, repo);
    expect(finding?.status).toBe("fail");
    expect(finding?.message).toContain("dependency alerts");
  });

  it("passes when all reported controls are enabled", async () => {
    const repo = makeRepository({
      security: { secretScanning: true, dependencyAlerts: true, pushProtection: true },
    });
    expect((await check(securitySettingsCheck, repo))?.status).toBe("pass");
  });

  it("skips branch protection without posture", async () => {
    expect((await check(branchProtectionCheck, makeRepository({ files: [] })))?.status).toBe(
      "skip",
    );
  });

  it("fails unprotected branches and zero required approvals", async () => {
    const unprotected = makeRepository({ security: { branchProtection: false } });
    expect((await check(branchProtectionCheck, unprotected))?.status).toBe("fail");

    const noApprovals = makeRepository({
      security: { branchProtection: true, requiredApprovals: 0 },
    });
    const finding = await check(branchProtectionCheck, noApprovals);
    expect(finding?.status).toBe("fail");
    expect(finding?.message).toContain("no approving reviews");
  });
});

describe("audit results", () => {
  it("does not fail the audit for warning-severity findings", async () => {
    const repo = makeRepository({
      files: [
        { path: "README.md", content: `# Widget\n\n${"text ".repeat(60)}` },
        { path: "LICENSE", content: "Apache License\nVersion 2.0" },
        { path: "SECURITY.md", content: "# Security" },
        { path: ".github/workflows/ci.yml", content: "on:\n  push:\n" },
        { path: ".github/dependabot.yml", content: "version: 2" },
      ],
      security: {
        secretScanning: true,
        dependencyAlerts: true,
        pushProtection: true,
        branchProtection: true,
        requiredApprovals: 1,
      },
    });
    const result = await auditRepository(repo, { now: NOW });
    expect(result.status).toBe("pass");
    expect(
      result.findings.some((entry) => entry.status === "fail" && entry.severity === "warning"),
    ).toBe(true);
  });

  it("fails the audit when an error-severity check fails", async () => {
    const repo = makeRepository({ files: [] });
    const result = await auditRepository(repo, { now: NOW });
    expect(result.status).toBe("fail");
    expect(result.counts.fail).toBeGreaterThan(0);
  });

  it("turns a crashing check into an error finding and fails the audit", async () => {
    const exploding: AuditCheck = {
      id: "MK-AUD-099",
      title: "Explodes",
      description: "test",
      category: "security",
      defaultSeverity: "error",
      passCondition: "never",
      async evaluate() {
        throw new Error("kaboom");
      },
    };
    const result = await auditRepository(healthyRepository(), { now: NOW, checks: [exploding] });
    expect(result.status).toBe("fail");
    expect(result.findings[0]?.status).toBe("error");
    expect(result.findings[0]?.message).toContain("kaboom");
  });

  it("produces findings with stable ids and documentation links", async () => {
    const result = await auditRepository(healthyRepository(), { now: NOW });
    for (const entry of result.findings) {
      expect(entry.id).toBe(`${entry.ruleId}:repository`);
      expect(entry.docsUrl).toContain("docs/AUDIT_CHECKS.md");
    }
  });
});
