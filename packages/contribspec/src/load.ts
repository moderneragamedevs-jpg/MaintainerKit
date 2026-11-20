import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { ConfigError, ExecutionError } from "@maintainerkit/core";
import { MAX_CONFIG_BYTES } from "./parse.js";
import {
  validateContribSpecSource,
  type SemanticValidationOptions,
  type ValidationResult,
} from "./validate.js";

/** Search order for the policy document, relative to the target directory. */
export const CONFIG_FILENAMES = [
  "maintainerkit.yml",
  "maintainerkit.yaml",
  ".maintainerkit.yml",
  ".maintainerkit.yaml",
  "contribspec.yml",
  "contribspec.yaml",
] as const;

export interface LoadedConfig {
  /** Absolute path of the file that was read. */
  path: string;
  source: string;
  result: ValidationResult;
  /** Short stable digest of the source, recorded in audit events to reference the exact input. */
  checksum: string;
  /** Policy version used for evaluation (the document's specVersion when valid). */
  policyVersion: string;
}

export function configChecksum(source: string): string {
  return `sha256:${createHash("sha256").update(source, "utf8").digest("hex").slice(0, 16)}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Returns the absolute path of the policy document in `directory`, or `null`. */
export async function findConfigFile(directory: string): Promise<string | null> {
  const base = resolvePath(directory);
  for (const filename of CONFIG_FILENAMES) {
    const candidate = join(base, filename);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

/**
 * Reads and validates a policy document.
 *
 * `target` may be a file path or a directory to search. Invalid documents resolve with diagnostics
 * (not an exception) so callers such as `validate` can print every problem at once; only I/O and
 * missing-file conditions throw.
 */
export async function loadContribSpec(
  target: string,
  options: SemanticValidationOptions & { cwd?: string } = {},
): Promise<LoadedConfig> {
  const requested = resolvePath(options.cwd ?? process.cwd(), target);
  const info = await stat(requested).catch(() => null);

  const path = info?.isDirectory() ? await findConfigFile(requested) : requested;

  if (!path) {
    throw new ConfigError(
      `No ContribSpec document found in ${requested}.`,
      "config/not-found",
      `Create one with \`maintainerkit init\`, or pass --config <file>. Looked for: ${CONFIG_FILENAMES.join(", ")}.`,
    );
  }

  if (!(await pathExists(path))) {
    throw new ConfigError(
      `Configuration file not found: ${path}`,
      "config/not-found",
      "Check the path passed to --config.",
    );
  }

  let source: string;
  try {
    const raw = await readFile(path);
    if (raw.byteLength > MAX_CONFIG_BYTES) {
      throw new ConfigError(
        `${path} is ${raw.byteLength} bytes, above the ${MAX_CONFIG_BYTES} byte limit.`,
        "config/too-large",
        "A policy document should be small. Split organization-wide policy across repositories instead.",
      );
    }
    source = raw.toString("utf8");
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ExecutionError(
      `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
      "config/unreadable",
      "Check file permissions.",
      error,
    );
  }

  const result = await validateContribSpecSource(source, { ...options, sourceId: path });
  const policyVersion =
    result.document && typeof result.document.specVersion === "string"
      ? result.document.specVersion
      : "unknown";

  return { path, source, result, checksum: configChecksum(source), policyVersion };
}

/** Loads and throws when the document is invalid. Convenience for callers that need a config. */
export async function loadValidContribSpec(
  target: string,
  options: SemanticValidationOptions & { cwd?: string } = {},
): Promise<LoadedConfig & { resolved: NonNullable<ValidationResult["resolved"]> }> {
  const loaded = await loadContribSpec(target, options);
  if (!loaded.result.resolved) {
    const errors = loaded.result.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error",
    );
    throw new ConfigError(
      `${loaded.path} is not a valid ContribSpec document (${errors.length} error(s)).`,
      errors[0]?.code ?? "config/invalid",
      errors[0]?.message,
    );
  }
  return { ...loaded, resolved: loaded.result.resolved };
}
