/**
 * Severity model shared by policy findings, audit findings, and diagnostics.
 *
 * Ordering is meaningful: `info < warning < error`. Thresholds ("fail on warning") rely on it.
 */
export type Severity = "info" | "warning" | "error";

export const SEVERITIES: readonly Severity[] = ["info", "warning", "error"] as const;

const RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2 };

export function severityRank(severity: Severity): number {
  return RANK[severity];
}

/** True when `severity` is at or above `threshold`. */
export function isAtLeast(severity: Severity, threshold: Severity): boolean {
  return RANK[severity] >= RANK[threshold];
}

/** Returns the most severe entry, `undefined` for an empty list. Total order, never throws. */
export function maxSeverity(severities: readonly Severity[]): Severity | undefined {
  let result: Severity | undefined;
  for (const severity of severities) {
    if (result === undefined || RANK[severity] > RANK[result]) result = severity;
  }
  return result;
}
