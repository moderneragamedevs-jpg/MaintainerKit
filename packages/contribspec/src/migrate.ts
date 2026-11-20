import { ConfigError } from "@maintainerkit/core";
import { checkSpecVersion, CONTRIBSPEC_VERSION, parseSpecVersion } from "./version.js";

/**
 * Migration infrastructure.
 *
 * ContribSpec versions are `MAJOR.MINOR`. Migrations are only defined between majors, because
 * the schema rejects unknown keys — a same-major document never needs shape changes.
 *
 * There are no migrations yet (1.x is the first major). The interface exists so that adding
 * `1.0 → 2.0` is a data change rather than a refactor, and so callers can already handle the
 * "no migration available" case deliberately.
 */
export interface Migration {
  from: string;
  to: string;
  description: string;
  /** Pure transformation of the parsed document. Must not mutate the input. */
  migrate(document: Record<string, unknown>): Record<string, unknown>;
}

export const MIGRATIONS: readonly Migration[] = [];

export function availableMigrations(): readonly Migration[] {
  return MIGRATIONS;
}

export interface MigrationResult {
  document: Record<string, unknown>;
  applied: Migration[];
  /** Version the returned document declares. */
  version: string;
  diagnostics: string[];
}

/**
 * Migrates a parsed document to `targetVersion`, applying the longest available chain.
 *
 * Throws `ConfigError` when the source version is unsupported and no migration exists. This is
 * deliberate: silently evaluating an older document with newer semantics would produce wrong
 * policy decisions.
 */
export function migrateDocument(
  document: Record<string, unknown>,
  targetVersion: string = CONTRIBSPEC_VERSION,
): MigrationResult {
  const sourceVersion = typeof document.specVersion === "string" ? document.specVersion : "";
  const parsedSource = parseSpecVersion(sourceVersion);
  if (!parsedSource) {
    throw new ConfigError(
      `Cannot migrate a document with specVersion "${sourceVersion}"; it is not a MAJOR.MINOR version.`,
      "contribspec/migration-invalid-source",
      `Set specVersion to "${targetVersion}" if the document already matches ContribSpec ${targetVersion}.`,
    );
  }

  const parsedTarget = parseSpecVersion(targetVersion);
  if (!parsedTarget) {
    throw new ConfigError(
      `Invalid migration target "${targetVersion}".`,
      "contribspec/migration-invalid-target",
    );
  }

  let current = { ...document };
  const applied: Migration[] = [];
  const diagnostics: string[] = [];

  // Walk the chain one major at a time; there is at most one migration per major boundary.
  let guard = 0;
  while (current.specVersion !== targetVersion) {
    if (guard++ > 10) {
      throw new ConfigError(
        "Migration chain did not converge; refusing to loop.",
        "contribspec/migration-cycle",
      );
    }
    const from = String(current.specVersion);
    const migration = MIGRATIONS.find((candidate) => candidate.from === from);
    if (!migration) break;
    current = { ...migration.migrate(current), specVersion: migration.to };
    applied.push(migration);
    diagnostics.push(
      `Applied migration ${migration.from} → ${migration.to}: ${migration.description}`,
    );
  }

  if (current.specVersion !== targetVersion) {
    const versionDiagnostics = checkSpecVersion(current.specVersion);
    const unsupported = versionDiagnostics.find((diagnostic) => diagnostic.severity === "error");
    throw new ConfigError(
      unsupported?.message ??
        `No migration path from ContribSpec ${String(current.specVersion)} to ${targetVersion}.`,
      "contribspec/migration-unavailable",
      unsupported?.hint,
    );
  }

  return { document: current, applied, version: current.specVersion as string, diagnostics };
}
