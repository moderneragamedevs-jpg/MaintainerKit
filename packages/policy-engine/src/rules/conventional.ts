import { singleLine, truncate } from "@maintainerkit/core";

/**
 * Conventional Commits title parsing, implemented deliberately small and linear-time.
 *
 * Grammar: `<type>(<scope>)!?: <subject>`
 * - type: lowercase, digits and dashes
 * - scope: one character class, no parentheses, length-capped by the caller
 * - `!` marks a breaking change
 */
export interface ConventionalTitle {
  type: string;
  scope?: string;
  breaking: boolean;
  subject: string;
}

const TITLE_PATTERN = /^([a-z][a-z0-9-]{0,19})(?:\(([^()\s]{1,40})\))?(!)?: (.+)$/;

export function parseConventionalTitle(raw: string): ConventionalTitle | null {
  const match = TITLE_PATTERN.exec(raw.trim());
  if (!match) return null;
  const [, type, scope, bang, subject] = match;
  if (!type || subject === undefined) return null;
  return {
    type,
    ...(scope === undefined ? {} : { scope }),
    breaking: bang === "!",
    subject: singleLine(subject),
  };
}

/** Suggests the closest allowed type by prefix/containment, for a helpful error message. */
export function suggestType(actual: string, allowed: readonly string[]): string | undefined {
  if (allowed.length === 0) return undefined;
  const candidate = allowed.find((type) => actual.startsWith(type) || type.startsWith(actual));
  return candidate;
}

export function formatAllowedTypes(allowed: readonly string[]): string {
  return truncate(allowed.join(", "), 240);
}
