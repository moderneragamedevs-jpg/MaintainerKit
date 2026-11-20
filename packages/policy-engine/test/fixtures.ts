import type {
  CheckRunSnapshot,
  CommitSnapshot,
  PolicySubject,
  PullRequestSnapshot,
  RepositorySnapshot,
} from "@maintainerkit/core";
import {
  resolveConfig,
  type ContribSpecDocument,
  type ResolvedConfig,
} from "@maintainerkit/contribspec";

/** A repository with the conventional five health files present. */
export function makeRepository(overrides: Partial<RepositorySnapshot> = {}): RepositorySnapshot {
  const files = overrides.files ?? [
    { path: "README.md" },
    { path: "LICENSE" },
    { path: "CONTRIBUTING.md" },
    { path: "SECURITY.md" },
    { path: "CODE_OF_CONDUCT.md" },
    { path: "CHANGELOG.md" },
  ];
  const contents = overrides.readFile ? undefined : new Map<string, string>();
  return {
    ref: { provider: "github", owner: "acme", name: "widget", defaultBranch: "main" },
    metadata: { description: "A widget", licenseSpdx: "Apache-2.0", visibility: "public" },
    files,
    ...overrides,
    readFile:
      overrides.readFile ??
      (async (path: string) => {
        const match = files.find(
          (file) => file.path === path || file.path.toLowerCase() === path.toLowerCase(),
        );
        return match?.content ?? contents?.get(path) ?? null;
      }),
  };
}

export function makePullRequest(overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot {
  return {
    number: 42,
    title: "feat(api): add widget endpoint",
    body: "## Summary\nAdds the endpoint.\n\n## Testing\nUnit tests added and ran locally.",
    author: "contributor",
    authorAssociation: "CONTRIBUTOR",
    baseRef: "main",
    headRef: "feature/widget",
    isFork: false,
    isDraft: false,
    state: "open",
    labels: [],
    commits: [makeCommit()],
    checks: [{ name: "verify", status: "completed", conclusion: "success" }],
    changedFiles: ["src/api.ts"],
    ...overrides,
  };
}

export function makeCommit(overrides: Partial<CommitSnapshot> = {}): CommitSnapshot {
  return {
    sha: "0123456789abcdef0123456789abcdef01234567",
    message: "feat(api): add widget endpoint",
    signedOff: true,
    verified: true,
    ...overrides,
  };
}

export function makeCheck(overrides: Partial<CheckRunSnapshot> = {}): CheckRunSnapshot {
  return { name: "verify", status: "completed", conclusion: "success", ...overrides };
}

export function makeRepositorySubject(
  repository: RepositorySnapshot = makeRepository(),
): PolicySubject {
  return {
    kind: "repository",
    label: `${repository.ref.owner ?? "local"}/${repository.ref.name}`,
    repository,
  };
}

export function makePullRequestSubject(
  pullRequest: PullRequestSnapshot = makePullRequest(),
  repository: RepositorySnapshot = makeRepository(),
): PolicySubject {
  return {
    kind: "pull_request",
    label: `${repository.ref.owner ?? "local"}/${repository.ref.name}#${pullRequest.number}`,
    repository,
    pullRequest,
  };
}

export function makeReleaseSubject(
  repository: RepositorySnapshot,
  release: NonNullable<PolicySubject["release"]>,
): PolicySubject {
  return {
    kind: "release",
    label: `${repository.ref.name}@${release.version ?? "unreleased"}`,
    repository,
    release,
  };
}

/** A configuration that turns on most rules, for tests that want real coverage. */
export function makeConfig(document: ContribSpecDocument = { specVersion: "1.0" }): ResolvedConfig {
  return resolveConfig({
    specVersion: "1.0",
    repository: {
      requiredFiles: [
        "README.md",
        "LICENSE",
        "CONTRIBUTING.md",
        "SECURITY.md",
        "CODE_OF_CONDUCT.md",
      ],
    },
    pullRequests: {
      title: { convention: "conventional", types: ["feat", "fix", "docs", "chore"], maxLength: 72 },
      description: { minLength: 20, requiredSections: ["Summary", "Testing"] },
      checks: { required: ["verify"], acceptedConclusions: ["success", "neutral"] },
      contributor: { requireDcoSignoff: true },
    },
    release: {
      changelogPath: "CHANGELOG.md",
      requireUnreleasedSection: true,
      requireChangelogEntry: true,
      versionFiles: ["package.json"],
    },
    security: {
      requireDependencyAlerts: true,
      requireSecretScanning: true,
      requireBranchProtection: true,
      minimumApprovals: 1,
    },
    ...document,
  });
}

/** Deterministic clock for evaluation tests. */
export const FIXED_NOW = new Date("2026-01-02T03:04:05.000Z");
