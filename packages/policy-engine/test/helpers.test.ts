import { describe, expect, it } from "vitest";
import { meaningfulBody, hasHeading } from "../src/rules/pr-description.js";
import { parseConventionalTitle, suggestType } from "../src/rules/conventional.js";
import { hasUnreleasedSection, hasVersionSection } from "../src/rules/release-readiness.js";
import { latestChecks } from "../src/rules/pr-checks.js";

describe("conventional titles", () => {
  it("parses type, scope, breaking marker, and subject", () => {
    expect(parseConventionalTitle("feat(api)!: drop v1")).toEqual({
      type: "feat",
      scope: "api",
      breaking: true,
      subject: "drop v1",
    });
    expect(parseConventionalTitle("fix: correct typo")).toEqual({
      type: "fix",
      breaking: false,
      subject: "correct typo",
    });
  });

  it("rejects titles without the required separator", () => {
    expect(parseConventionalTitle("feat add endpoint")).toBeNull();
    expect(parseConventionalTitle("Feat: uppercase type")).toBeNull();
    expect(parseConventionalTitle("")).toBeNull();
  });

  it("does not let parentheses inside the scope break parsing", () => {
    expect(parseConventionalTitle("feat(a(b)): x")).toBeNull();
  });

  it("suggests a nearby allowed type", () => {
    expect(suggestType("feature", ["feat", "fix"])).toBe("feat");
    expect(suggestType("zzz", ["feat", "fix"])).toBeUndefined();
  });
});

describe("description helpers", () => {
  it("ignores HTML comments when measuring content", () => {
    expect(meaningfulBody("<!-- template -->\n")).toBe("");
    expect(meaningfulBody("## Summary\nreal content")).toContain("real content");
  });

  it("finds headings case-insensitively and with trailing text", () => {
    const body = "## Summary\nx\n### Testing notes\ny";
    expect(hasHeading(body, "summary")).toBe(true);
    expect(hasHeading(body, "Testing")).toBe(true);
    expect(hasHeading(body, "Review")).toBe(false);
  });

  it("does not treat a section name as a regular expression", () => {
    const body = "## Summary\nx";
    expect(hasHeading(body, ".*")).toBe(false);
  });
});

describe("changelog helpers", () => {
  it("detects an Unreleased section", () => {
    expect(hasUnreleasedSection("# Changelog\n\n## [Unreleased]\n- thing")).toBe(true);
    expect(hasUnreleasedSection("# Changelog\n\n## [1.0.0]")).toBe(false);
  });

  it("detects a version section", () => {
    expect(hasVersionSection("## [1.2.3] - 2026-01-01", "1.2.3")).toBe(true);
    expect(hasVersionSection("## [1.2.3] - 2026-01-01", "1.2.4")).toBe(false);
    expect(hasVersionSection("## [1.2.3]", "")).toBe(false);
  });
});

describe("check selection", () => {
  it("keeps the latest run per name, case-insensitively", () => {
    const map = latestChecks([
      { name: "Verify", status: "completed", conclusion: "failure" },
      { name: "verify", status: "completed", conclusion: "success" },
      { name: "other", status: "completed", conclusion: "failure" },
    ]);
    expect(map.get("verify")?.conclusion).toBe("success");
    expect(map.size).toBe(2);
  });
});
