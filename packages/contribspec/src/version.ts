import type { Diagnostic } from "@maintainerkit/core";
import { pointer } from "@maintainerkit/core";

/** Version this implementation authors and fully supports. */
export const CONTRIBSPEC_VERSION = "1.0";
export const CONTRIBSPEC_MAJOR = 1;
export const CONTRIBSPEC_MINOR = 0;

export interface ParsedSpecVersion {
  major: number;
  minor: number;
}

/** Parses `"1.0"` style versions. Returns `null` for anything malformed. */
export function parseSpecVersion(raw: string): ParsedSpecVersion | null {
  if (typeof raw !== "string") return null;
  const match = /^([0-9]{1,2})\.([0-9]{1,2})$/.exec(raw.trim());
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return null;
  return { major, minor };
}

const SUPPORTED_MAJORS = new Set([CONTRIBSPEC_MAJOR]);

/**
 * Version compatibility, expressed explicitly:
 * - unparseable → error
 * - unknown major → error (documents are not forwards/backwards compatible across majors)
 * - newer minor in a known major → warning (accepted; unknown keys are already rejected by the
 *   schema, so a newer minor can only be stricter, never silently ignored)
 */
export function checkSpecVersion(raw: unknown): Diagnostic[] {
  if (typeof raw !== "string") {
    return [
      {
        code: "contribspec/invalid-version",
        severity: "error",
        message: 'specVersion must be a string such as "1.0".',
        path: pointer("specVersion"),
        hint: `Supported version: ${CONTRIBSPEC_VERSION}`,
      },
    ];
  }

  const parsed = parseSpecVersion(raw);
  if (!parsed) {
    return [
      {
        code: "contribspec/invalid-version",
        severity: "error",
        message: `"${raw}" is not a valid ContribSpec version (expected MAJOR.MINOR, e.g. "1.0").`,
        path: pointer("specVersion"),
        hint: `Supported version: ${CONTRIBSPEC_VERSION}`,
      },
    ];
  }

  if (!SUPPORTED_MAJORS.has(parsed.major)) {
    return [
      {
        code: "contribspec/unsupported-version",
        severity: "error",
        message: `ContribSpec ${parsed.major}.x is not supported by this MaintainerKit build.`,
        path: pointer("specVersion"),
        hint: `Use ContribSpec ${CONTRIBSPEC_VERSION}, or upgrade MaintainerKit if a newer major exists. This build does not guess at unknown major versions.`,
      },
    ];
  }

  if (parsed.minor > CONTRIBSPEC_MINOR) {
    return [
      {
        code: "contribspec/newer-minor",
        severity: "warning",
        message: `Document declares ContribSpec ${parsed.major}.${parsed.minor}; this build implements ${CONTRIBSPEC_VERSION}. Unknown fields are rejected, so the document is evaluated as ${CONTRIBSPEC_VERSION}.`,
        path: pointer("specVersion"),
        hint: "Upgrade MaintainerKit to remove this warning.",
      },
    ];
  }

  return [];
}

/** True when a document version can be evaluated by this build. */
export function isSupportedSpecVersion(raw: unknown): boolean {
  return checkSpecVersion(raw).every((diagnostic) => diagnostic.severity !== "error");
}
