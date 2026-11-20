import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const pkg = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@maintainerkit/core": pkg("packages/core/src/index.ts"),
      "@maintainerkit/contribspec": pkg("packages/contribspec/src/index.ts"),
      "@maintainerkit/policy-engine": pkg("packages/policy-engine/src/index.ts"),
      "@maintainerkit/audit": pkg("packages/audit/src/index.ts"),
      "@maintainerkit/workflow-engine": pkg("packages/workflow-engine/src/index.ts"),
      "@maintainerkit/git-integration": pkg("packages/integrations/git/src/index.ts"),
      "@maintainerkit/github": pkg("packages/integrations/github/src/index.ts"),
      "@maintainerkit/ai-core": pkg("packages/ai/core/src/index.ts"),
      "@maintainerkit/ai-providers": pkg("packages/ai/providers/src/index.ts"),
      "@maintainerkit/ai-prompts": pkg("packages/ai/prompts/src/index.ts"),
      "@maintainerkit/cli": pkg("packages/interfaces/cli/src/index.ts"),
      "@maintainerkit/sdk": pkg("packages/interfaces/sdk/src/index.ts"),
      "@maintainerkit/github-action": pkg("packages/interfaces/github-action/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/test/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts", "packages/*/*/src/**/*.ts"],
      exclude: ["**/index.ts"],
      reporter: ["text", "lcov"],
    },
  },
});
