import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Architecture tests.
 *
 * The layering in docs/ARCHITECTURE.md is only real if it is enforced. This suite reads the source and
 * fails when a package imports something it must not: a policy engine that can reach Octokit, or a
 * core package that can reach an AI provider, is a boundary that has already been lost.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

interface PackageRule {
  path: string;
  allowedInternal: string[];
  forbidden?: string[];
  note: string;
}

const RULES: PackageRule[] = [
  {
    path: "packages/core",
    allowedInternal: [],
    note: "core is pure domain contracts: no workspace dependencies at all",
  },
  {
    path: "packages/contribspec",
    allowedInternal: ["core"],
    forbidden: ["octokit", "@maintainerkit/ai"],
    note: "the specification must not know about providers or AI",
  },
  {
    path: "packages/policy-engine",
    allowedInternal: ["core", "contribspec"],
    forbidden: ["octokit", "@maintainerkit/ai", "@maintainerkit/audit", "@maintainerkit/github"],
    note: "deterministic evaluation, independent of GitHub, AI, and audit sinks",
  },
  {
    path: "packages/audit",
    allowedInternal: ["core"],
    forbidden: ["octokit", "@maintainerkit/ai"],
    note: "audit events and health checks are provider-neutral",
  },
  {
    path: "packages/workflow-engine",
    allowedInternal: ["core", "contribspec", "policy-engine", "audit"],
    forbidden: ["octokit", "@maintainerkit/ai", "@maintainerkit/github"],
    note: "orchestration must not depend on a provider adapter or an AI implementation",
  },
  {
    path: "packages/integrations/git",
    allowedInternal: ["core"],
    forbidden: ["octokit", "@maintainerkit/ai"],
    note: "local adapter",
  },
  {
    path: "packages/integrations/github",
    allowedInternal: ["core"],
    forbidden: ["@maintainerkit/ai"],
    note: "only this package may import octokit",
  },
  {
    path: "packages/ai/core",
    allowedInternal: ["core"],
    forbidden: ["octokit", "@maintainerkit/github"],
    note: "provider contract and validation only",
  },
  {
    path: "packages/ai/providers",
    allowedInternal: ["core", "ai/core"],
    forbidden: ["octokit", "@maintainerkit/github"],
    note: "fetch-based adapters, no vendor SDKs",
  },
  {
    path: "packages/ai/prompts",
    allowedInternal: ["core", "ai/core"],
    forbidden: ["octokit", "@maintainerkit/github"],
    note: "prompt text only",
  },
  {
    path: "packages/ai/advisor",
    allowedInternal: ["core", "ai/core", "ai/providers", "ai/prompts"],
    forbidden: ["octokit", "@maintainerkit/github"],
    note: "advisory composition; still no provider-specific policy authority",
  },
];

const INTERFACE_PREFIXES = ["packages/interfaces/"];

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    const stats = statSync(absolute);
    if (stats.isDirectory()) files.push(...walk(absolute));
    else if (entry.endsWith(".ts")) files.push(absolute);
  }
  return files;
}

const IMPORT_PATTERN = /(?:from\s+|import\()\s*["']([^"']+)["']/g;

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    if (match[1]) specifiers.push(match[1]);
  }
  return specifiers;
}

function internalPackageOf(specifier: string): string | undefined {
  if (!specifier.startsWith("@maintainerkit/")) return undefined;
  const name = specifier.slice("@maintainerkit/".length);
  // Map published names to directories.
  const mapping: Record<string, string> = {
    core: "core",
    contribspec: "contribspec",
    "policy-engine": "policy-engine",
    audit: "audit",
    "workflow-engine": "workflow-engine",
    "git-integration": "git",
    github: "github",
    "ai-core": "ai/core",
    "ai-providers": "ai/providers",
    "ai-prompts": "ai/prompts",
    "ai-advisor": "ai/advisor",
  };
  return mapping[name] ?? name;
}

function sourceFiles(relativePath: string): string[] {
  return walk(join(repoRoot, relativePath, "src"));
}

describe("package layering", () => {
  it.each(RULES)("$path respects its dependency rule ($note)", (rule) => {
    const files = sourceFiles(rule.path);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      for (const specifier of importsOf(file)) {
        const internal = internalPackageOf(specifier);
        const location = `${relative(repoRoot, file).split(sep).join("/")} imports ${specifier}`;

        if (internal && rule.allowedInternal.length === 0) {
          throw new Error(
            `${location}: ${rule.path} must not depend on other workspace packages (${rule.note})`,
          );
        }
        if (internal && !rule.allowedInternal.includes(internal)) {
          throw new Error(
            `${location}: ${internal} is not an allowed dependency of ${rule.path} (${rule.note})`,
          );
        }
        for (const forbidden of rule.forbidden ?? []) {
          if (specifier === forbidden || specifier.startsWith(`${forbidden}/`)) {
            throw new Error(
              `${location}: ${forbidden} is forbidden in ${rule.path} (${rule.note})`,
            );
          }
        }
      }
    }
  });

  it("only the GitHub integration imports octokit", () => {
    const offenders: string[] = [];
    for (const rule of RULES) {
      for (const file of sourceFiles(rule.path)) {
        const source = readFileSync(file, "utf8");
        if (
          /from\s+["']octokit["']|import\(\s*["']octokit["']/.test(source) &&
          rule.path !== "packages/integrations/github"
        ) {
          offenders.push(relative(repoRoot, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps policy rules free of clock and network reads", () => {
    // The engine accepts an injected clock at its boundary; the rules themselves must be pure.
    const files = walk(join(repoRoot, "packages/policy-engine/src/rules"));
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/new Date\(\)/);
      expect(source).not.toMatch(/\bfetch\(/);
      expect(source).not.toMatch(/node:https?/);
      expect(source).not.toMatch(/from\s+["']node:fs["']/);
    }
  });

  it("keeps core free of filesystem and network access", () => {
    for (const file of sourceFiles("packages/core")) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/from\s+["']node:fs["']/);
      expect(source).not.toMatch(/from\s+["']node:https?["']/);
      expect(source).not.toMatch(/\bfetch\(/);
    }
  });

  it("documents every interface package as dependent on lower layers only", () => {
    // Interfaces may import anything, but they must never be imported by a lower layer.
    const interfaces = RULES.flatMap((rule) => sourceFiles(rule.path));
    const lowerLayerDirs = [
      "packages/core",
      "packages/contribspec",
      "packages/policy-engine",
      "packages/audit",
      "packages/workflow-engine",
    ];
    for (const directory of lowerLayerDirs) {
      for (const file of sourceFiles(directory)) {
        for (const specifier of importsOf(file)) {
          const internal = internalPackageOf(specifier);
          if (internal && ["cli", "sdk", "github-action"].includes(internal)) {
            throw new Error(
              `${relative(repoRoot, file)} imports the interface package ${specifier}`,
            );
          }
        }
      }
    }
    expect(INTERFACE_PREFIXES.length).toBe(1);
    expect(interfaces.length).toBeGreaterThan(0);
  });
});

describe("shipped workflow templates", () => {
  it("never trigger on pull_request_target", () => {
    const templates = readFileSync(
      join(repoRoot, "packages/interfaces/cli/src/templates.ts"),
      "utf8",
    );
    const workflowBodies = templates.match(/on:\n[\s\S]*?permissions:/g) ?? [];
    for (const body of workflowBodies) {
      expect(body).not.toMatch(/pull_request_target:/);
    }
  });

  it("grant only read permissions in generated workflows", () => {
    const templates = readFileSync(
      join(repoRoot, "packages/interfaces/cli/src/templates.ts"),
      "utf8",
    );
    expect(templates).toContain("contents: read");
    expect(templates).not.toContain("pull-requests: write");
    expect(templates).not.toContain("contents: write");
  });
});
