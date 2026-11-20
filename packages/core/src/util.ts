/** Small, dependency-free helpers shared by packages. */

/** Truncates a string for safe inclusion in logs/reports, marking the cut explicitly. */
export function truncate(value: string, max = 400): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

/** Collapses whitespace so multi-line untrusted text cannot forge report structure. */
export function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** ISO timestamp from an injected clock; keeps rule evaluation deterministic in tests. */
export function isoNow(now: Date = new Date()): string {
  return now.toISOString();
}

/** Repo-relative path safety: rejects traversal, absolute paths, and NUL bytes. */
export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.length > 512) return false;
  if (path.includes("\0")) return false;
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  if (/^[a-zA-Z]:/.test(path)) return false;
  const normalised = path.replace(/\\/g, "/");
  if (normalised.split("/").some((segment) => segment === "..")) return false;
  return true;
}

/** Stable JSON stringify with sorted keys — used for hashing and reproducible reports. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value), null, 2);
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([key, v]) => [key, sortDeep(v)]));
  }
  return value;
}
