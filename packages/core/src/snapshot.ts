/**
 * Provider-neutral snapshots.
 *
 * Everything the policy engine and auditor can observe about a repository is expressed here.
 * Adapters (git working tree, GitHub API, future providers) must produce these shapes and nothing
 * vendor-specific. Optional fields are genuinely optional: `undefined` means "the adapter could not
 * observe this", which rules must treat as `skip`, never as `pass`.
 */

export type ProviderId = "github" | "git" | "filesystem" | string;

export interface RepositoryRef {
  provider: ProviderId;
  /** Owner/namespace when the provider has one (GitHub org/user). */
  owner?: string;
  name: string;
  /** Canonical URL when known. */
  url?: string;
  defaultBranch?: string;
}

export interface RepositoryMetadata {
  description?: string;
  licenseSpdx?: string;
  archived?: boolean;
  visibility?: "public" | "private" | "internal" | "unknown";
  topics?: string[];
  /** ISO-8601 timestamps as reported by the provider. */
  createdAt?: string;
  pushedAt?: string;
  stars?: number;
}

/** A path observed in the repository. `content` is only populated for explicitly requested files. */
export interface RepositoryFile {
  path: string;
  sizeBytes?: number;
  content?: string;
  /** True when the adapter refused to read the file because it exceeded the size limit. */
  truncated?: boolean;
}

/**
 * Security posture. `"unknown"` is distinct from `false`: a local checkout cannot answer whether
 * dependency alerts are enabled, and pretending otherwise would fabricate a result.
 */
export interface SecurityPosture {
  dependencyAlerts?: boolean | "unknown";
  secretScanning?: boolean | "unknown";
  pushProtection?: boolean | "unknown";
  branchProtection?: boolean | "unknown";
  requiredApprovals?: number | "unknown";
  signedCommitsRequired?: boolean | "unknown";
}

export interface RepositorySnapshot {
  ref: RepositoryRef;
  metadata: RepositoryMetadata;
  files: RepositoryFile[];
  security?: SecurityPosture;
  /** Convenience: does the repository contain this path (case-sensitive, repo-relative)? */
  hasFile?(path: string): boolean;
  /** Reads a repository-relative text file, or `null` when missing/not readable. */
  readFile?(path: string): Promise<string | null>;
}

export type CheckStatus = "queued" | "in_progress" | "completed" | "unknown";
export type CheckConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | "stale"
  | "unknown";

export interface CheckRunSnapshot {
  name: string;
  status: CheckStatus;
  conclusion?: CheckConclusion;
  /** Provider URL, when available. */
  detailsUrl?: string;
}

export type AuthorAssociation =
  | "OWNER"
  | "MEMBER"
  | "COLLABORATOR"
  | "CONTRIBUTOR"
  | "FIRST_TIME_CONTRIBUTOR"
  | "FIRST_TIMER"
  | "MANNEQUIN"
  | "NONE"
  | "unknown";

export interface CommitSnapshot {
  sha: string;
  message: string;
  /** DCO `Signed-off-by:` trailer present. */
  signedOff?: boolean;
  /** Cryptographically signed commit (GPG/SSH/Sigstore), when the provider reports it. */
  verified?: boolean;
  authorLogin?: string;
}

export interface PullRequestSnapshot {
  number: number;
  title: string;
  body?: string;
  author: string;
  authorAssociation?: AuthorAssociation;
  baseRef: string;
  headRef: string;
  /** Head repository differs from base repository: contributor has no write access by default. */
  isFork: boolean;
  isDraft: boolean;
  state?: "open" | "closed" | "merged" | "unknown";
  labels: string[];
  commits: CommitSnapshot[];
  checks: CheckRunSnapshot[];
  changedFiles: string[];
  additions?: number;
  deletions?: number;
  /** Issue numbers referenced by the PR body ("Closes #12"), when detectable. */
  linkedIssues?: number[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ReleaseSnapshot {
  /** Proposed or current version, e.g. `1.4.0`. */
  version?: string;
  changelogPath?: string;
  changelogContent?: string;
  tagName?: string;
  /** Branch or ref the release would be cut from. */
  targetRef?: string;
}

/**
 * The complete input to policy evaluation. A single run evaluates one subject kind at a time but
 * may carry repository context alongside a pull request.
 */
export interface PolicySubject {
  kind: "repository" | "pull_request" | "release";
  label: string;
  repository: RepositorySnapshot;
  pullRequest?: PullRequestSnapshot;
  release?: ReleaseSnapshot;
}

/** Read-only source of repository snapshots. Implemented by integration adapters. */
export interface RepositorySource {
  readonly provider: ProviderId;
  getRepository(): Promise<RepositorySnapshot>;
}

/** Read-only source of pull-request snapshots. */
export interface PullRequestSource extends RepositorySource {
  getPullRequest(number: number): Promise<PullRequestSnapshot>;
}

/**
 * Case-exact first, then case-insensitive. Git tracks case exactly, but local checkouts on
 * case-insensitive filesystems (Windows, default macOS) report whatever the author created, so a
 * strict comparison would make the same repository pass on Linux and fail on Windows.
 * The matched path is returned so reports can show the real casing.
 */
export function findRepositoryFile(
  files: readonly RepositoryFile[],
  path: string,
): RepositoryFile | undefined {
  const normalised = path.replace(/\\/g, "/").replace(/^\.\//, "");
  const exact = files.find((file) => file.path === normalised);
  if (exact) return exact;
  const lower = normalised.toLowerCase();
  return files.find((file) => file.path.toLowerCase() === lower);
}

/** Presence check shared by policy rules and the auditor. */
export function repositoryHasFile(
  snapshot: Pick<RepositorySnapshot, "files" | "hasFile">,
  path: string,
): boolean {
  if (snapshot.hasFile?.(path)) return true;
  return findRepositoryFile(snapshot.files, path) !== undefined;
}
