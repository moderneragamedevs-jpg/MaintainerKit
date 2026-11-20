import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ExecutionError, UsageError } from "@maintainerkit/core";
import type { CliContext } from "../context.js";
import { contribSpecTemplate, workflowTemplate } from "../templates.js";

export interface InitOptions {
  directory?: string;
  config?: string;
  force?: boolean;
  strict?: boolean;
  workflow?: boolean;
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null)) !== null;
}

/**
 * Writes a starting policy document (and optionally a read-only CI workflow).
 *
 * Never overwrites without `--force`, and never runs git commands: initialising a repository is the
 * user's decision, and silently doing it in a directory that happens to be the wrong one is hostile.
 */
export async function runInit(context: CliContext, options: InitOptions): Promise<number> {
  const directory = resolve(context.cwd, options.directory ?? ".");
  const stats = await stat(directory).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new ExecutionError(
      `Not a directory: ${directory}`,
      "init/not-a-directory",
      "Pass an existing directory, or omit the argument to use the current one.",
    );
  }

  const configPath = resolve(directory, options.config ?? "maintainerkit.yml");
  const workflowPath = join(directory, ".github", "workflows", "maintainerkit.yml");

  if (!options.force && (await exists(configPath))) {
    throw new UsageError(
      `Refusing to overwrite ${configPath}.`,
      "Pass --force to replace it, or edit the existing document.",
    );
  }

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, contribSpecTemplate({ strict: options.strict }), "utf8");
  context.out(`Created ${configPath}\n`);

  if (options.workflow !== false) {
    if (!options.force && (await exists(workflowPath))) {
      context.err(`Skipped ${workflowPath}: it already exists (use --force to replace it).\n`);
    } else {
      await mkdir(dirname(workflowPath), { recursive: true });
      await writeFile(workflowPath, workflowTemplate(), "utf8");
      context.out(`Created ${workflowPath}\n`);
    }
  }

  context.out(
    [
      "",
      "Next steps:",
      "  1. maintainerkit validate",
      "  2. maintainerkit audit",
      "  3. maintainerkit check --path .",
      "  4. Commit the policy document and the workflow.",
      "",
      "AI is disabled by default. Policy checks work without it.",
      "",
    ].join("\n"),
  );

  return 0;
}
