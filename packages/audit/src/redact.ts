/**
 * Secret redaction.
 *
 * Every sink that leaves the process (logs, audit files, reports, check-run output) must pass through
 * this module. Patterns are linear-time and anchored where possible: a redactor that can be tricked
 * into catastrophic backtracking is itself a denial-of-service vector.
 *
 * Redaction is best-effort by design. It is a safety net, not a guarantee: documentation tells users
 * never to put secrets in files that MaintainerKit reads.
 */

export const REDACTED = "***REDACTED***";

interface Pattern {
  name: string;
  regex: RegExp;
  /** Keeps the identifying prefix so the log remains useful ("ghp_… was redacted"). */
  keepPrefix?: boolean;
}

const PATTERNS: readonly Pattern[] = [
  { name: "github-token", regex: /\bgh[pousr]_[A-Za-z0-9]{16,255}\b/g },
  { name: "github-fine-grained-token", regex: /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g },
  { name: "openai-key", regex: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,255}\b/g },
  { name: "slack-token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,255}\b/g },
  { name: "aws-access-key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "npm-token", regex: /\bnpm_[A-Za-z0-9]{30,255}\b/g },
  {
    name: "private-key",
    regex:
      /-----BEGIN [A-Z ]{0,32}PRIVATE KEY-----[\s\S]{0,4000}?-----END [A-Z ]{0,32}PRIVATE KEY-----/g,
  },
  { name: "bearer", regex: /\b(bearer\s+)[A-Za-z0-9._~+/=-]{10,255}\b/gi, keepPrefix: true },
];

/** `api_key=abcdef123456`, `password: "hunter2..."`, `token=...` in env-style or YAML-style text. */
const ASSIGNMENT_PATTERN =
  /\b(api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret)\b(\s*[:=]\s*)(["']?)([A-Za-z0-9._\-+/=]{8,256})\3/gi;

export interface RedactionResult {
  value: string;
  /** Names of the patterns that matched. Never contains the secret itself. */
  redacted: string[];
  count: number;
}

export function redactSecrets(input: string): RedactionResult {
  let value = input;
  const redacted: string[] = [];
  let count = 0;

  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    value = value.replace(pattern.regex, (match, ...rest) => {
      count += 1;
      redacted.push(pattern.name);
      if (pattern.keepPrefix && typeof rest[0] === "string") {
        return `${rest[0].trim()} ${REDACTED}`;
      }
      return REDACTED;
    });
  }

  value = value.replace(ASSIGNMENT_PATTERN, (_match, key: string, separator: string) => {
    count += 1;
    redacted.push("credential-assignment");
    return `${key}${separator}${REDACTED}`;
  });

  return { value, redacted: [...new Set(redacted)], count };
}

/** Convenience: redact and discard match metadata. */
export function redact(input: string): string {
  return redactSecrets(input).value;
}

/** Deep redaction for structured values (audit events, report payloads). */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as unknown as T;
  if (Array.isArray(value)) return value.map((entry) => redactDeep(entry)) as unknown as T;
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      // Keys can leak too: `{"ghp_xxx": "value"}`.
      const safeKey = redact(key);
      result[safeKey] = redactDeep(entry);
    }
    return result as unknown as T;
  }
  return value;
}

/** True when the text still appears to contain a credential. Used by leak-prevention tests. */
export function containsLikelySecret(input: string): boolean {
  return redactSecrets(input).count > 0;
}
