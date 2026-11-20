import { findRepositoryFile, repositoryHasFile, truncate } from "@maintainerkit/core";
import type { RuleDefinition, RuleResult } from "./types.js";

export const repositoryFilesRule: RuleDefinition = {
  id: "MK-REPO-001",
  title: "Required repository files exist",
  description:
    "Every file listed in repository.requiredFiles must exist at the repository root or at the configured path.",
  appliesTo: ["repository", "pull_request", "release"],
  defaultSeverity: "error",
  policyPath: "/repository/requiredFiles",
  docsAnchor: "#mk-repo-001--required-repository-files",
  evaluate({ config, subject }) {
    const required = config.repository.requiredFiles;
    if (required.length === 0) {
      return { status: "skip", message: "No required files are configured." };
    }

    const repository = subject.repository;
    const results: RuleResult[] = [];

    for (const entry of required) {
      const match = findRepositoryFile(repository.files, entry.path);
      if (repositoryHasFile(repository, entry.path)) {
        results.push({
          status: "pass",
          message: `Found ${match?.path ?? entry.path}.`,
          evidence: [
            { label: "file", value: match?.path ?? entry.path },
            ...(entry.description
              ? [{ label: "purpose", value: truncate(entry.description, 160) }]
              : []),
          ],
        });
      } else {
        results.push({
          status: "fail",
          message: `Required file "${entry.path}" is missing.`,
          evidence: [
            { label: "expected path", value: entry.path },
            ...(entry.description
              ? [{ label: "purpose", value: truncate(entry.description, 160) }]
              : []),
          ],
          remediation: entry.description
            ? `Add ${entry.path}: ${entry.description}`
            : `Add ${entry.path}, or remove it from repository.requiredFiles if it is not required.`,
        });
      }
    }

    return results;
  },
};
