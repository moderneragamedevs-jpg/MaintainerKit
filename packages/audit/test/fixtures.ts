import type { RepositorySnapshot } from "@maintainerkit/core";

export interface FixtureFile {
  path: string;
  content?: string;
}

export function makeRepository(
  options: {
    files?: FixtureFile[];
    security?: RepositorySnapshot["security"];
    licenseSpdx?: string;
    provider?: string;
  } = {},
): RepositorySnapshot {
  const files = options.files ?? [];
  return {
    ref: { provider: options.provider ?? "filesystem", name: "widget" },
    metadata: {
      ...(options.licenseSpdx === undefined ? {} : { licenseSpdx: options.licenseSpdx }),
    },
    files: files.map((file) => ({
      path: file.path,
      ...(file.content === undefined ? {} : { content: file.content }),
      sizeBytes: file.content?.length,
    })),
    ...(options.security ? { security: options.security } : {}),
    async readFile(path: string) {
      const match = files.find((file) => file.path.toLowerCase() === path.toLowerCase());
      return match?.content ?? null;
    },
  };
}

/** A repository that passes every audit check. */
export function healthyRepository(): RepositorySnapshot {
  return makeRepository({
    files: [
      { path: "README.md", content: `# Widget\n\n${"Widget does a thing. ".repeat(20)}` },
      {
        path: "LICENSE",
        content: "Apache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/",
      },
      { path: "CONTRIBUTING.md", content: "# Contributing\n\nRun the tests." },
      { path: "SECURITY.md", content: "# Security\n\nEmail security@example.com." },
      { path: "CODE_OF_CONDUCT.md", content: "# Code of Conduct\n\nBe kind." },
      { path: ".github/workflows/ci.yml", content: "name: CI\non:\n  pull_request:\n" },
      { path: ".github/dependabot.yml", content: "version: 2\nupdates: []\n" },
      { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'\n" },
    ],
    security: {
      dependencyAlerts: true,
      secretScanning: true,
      pushProtection: true,
      branchProtection: true,
      requiredApprovals: 1,
    },
  });
}
