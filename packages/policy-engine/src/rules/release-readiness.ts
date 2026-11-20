import { truncate } from "@maintainerkit/core";
import type { RuleDefinition, RuleResult } from "./types.js";
import { hasHeading } from "./pr-description.js";

/** True when the changelog has a heading that mentions "unreleased" (e.g. `## [Unreleased]`). */
export function hasUnreleasedSection(changelog: string): boolean {
  return changelog
    .split("\n")
    .some((line) => /^#{1,6}[ \t]+/.test(line.trimEnd()) && /unreleased/i.test(line));
}

/** True when the changelog has a heading containing the given version string. */
export function hasVersionSection(changelog: string, version: string): boolean {
  if (version.trim() === "") return false;
  return changelog
    .split("\n")
    .some((line) => /^#{1,6}[ \t]+/.test(line.trimEnd()) && line.includes(version));
}

function readJsonVersion(content: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed && typeof parsed === "object" && "version" in parsed) {
      const version = (parsed as { version?: unknown }).version;
      return typeof version === "string" ? version : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export const releaseReadinessRule: RuleDefinition = {
  id: "MK-REL-001",
  title: "Release readiness",
  description:
    "Checks the changelog exists, contains an Unreleased section and the version entry, and that version files declare the release version.",
  appliesTo: ["release"],
  defaultSeverity: "error",
  policyPath: "/release",
  docsAnchor: "#mk-rel-001--release-readiness",
  async evaluate({ config, subject }) {
    const release = subject.release;
    if (!release) return { status: "skip", message: "No release snapshot was provided." };

    const policy = config.release;
    const checkChangelog = policy.requireUnreleasedSection || policy.requireChangelogEntry;
    if (!checkChangelog && policy.versionFiles.length === 0) {
      return { status: "skip", message: "No release requirements are configured." };
    }

    const results: RuleResult[] = [];
    const changelogPath = release.changelogPath ?? policy.changelogPath;
    const readFile = subject.repository.readFile;

    if (checkChangelog) {
      if (!readFile) {
        return {
          status: "skip",
          message:
            "This repository source cannot read file contents, so the changelog cannot be inspected.",
        };
      }

      const changelog = release.changelogContent ?? (await readFile(changelogPath));
      if (changelog === null) {
        results.push({
          status: "fail",
          message: `Changelog "${changelogPath}" is missing.`,
          evidence: [{ label: "changelog path", value: changelogPath }],
          remediation: `Create ${changelogPath} with a "## [Unreleased]" section.`,
        });
      } else if (policy.requireUnreleasedSection && !hasUnreleasedSection(changelog)) {
        results.push({
          status: "fail",
          message: "The changelog has no Unreleased section.",
          evidence: [{ label: "changelog", value: changelogPath }],
          remediation: 'Add a "## [Unreleased]" heading so unreleased changes have a home.',
        });
      } else if (policy.requireChangelogEntry) {
        const version = release.version;
        if (version === undefined) {
          results.push({
            status: "skip",
            message: "No release version was provided, so the changelog entry cannot be matched.",
            evidence: [{ label: "changelog", value: changelogPath }],
          });
        } else if (!hasVersionSection(changelog, version) && !hasHeading(changelog, version)) {
          results.push({
            status: "fail",
            message: `The changelog has no entry for version ${version}.`,
            evidence: [
              { label: "changelog", value: changelogPath },
              { label: "version", value: version },
            ],
            remediation: `Add a "## [${version}]" heading describing this release.`,
          });
        }
      }
    }

    for (const versionFile of policy.versionFiles) {
      if (!readFile) {
        results.push({
          status: "skip",
          message: `Cannot read ${versionFile}: this repository source does not expose file contents.`,
        });
        continue;
      }
      const content = await readFile(versionFile);
      if (content === null) {
        results.push({
          status: "fail",
          message: `Version file "${versionFile}" is missing.`,
          evidence: [{ label: "version file", value: versionFile }],
          remediation: `Add ${versionFile} or remove it from release.versionFiles.`,
        });
        continue;
      }

      const declared = versionFile.endsWith(".json") ? readJsonVersion(content) : undefined;
      if (release.version === undefined) {
        results.push({
          status: "skip",
          message: `No release version was provided, so ${versionFile} cannot be compared.`,
          evidence: [{ label: "version file", value: versionFile }],
        });
        continue;
      }
      if (declared !== undefined && declared !== release.version) {
        results.push({
          status: "fail",
          message: `${versionFile} declares version ${declared}, but the release is ${release.version}.`,
          evidence: [
            { label: "declared", value: declared },
            { label: "expected", value: release.version },
          ],
          remediation: `Update ${versionFile} to ${release.version}.`,
        });
      }
    }

    if (results.length === 0) {
      return {
        status: "pass",
        message: `Release ${release.version ?? "(unversioned)"} is ready: changelog and version files are consistent.`,
        evidence: [{ label: "changelog", value: truncate(changelogPath, 120) }],
      };
    }
    return results;
  },
};
