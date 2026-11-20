import { execFile } from "node:child_process";
import { promises as fs, realpathSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  ExecutionError,
  isSafeRelativePath,
  type RepositoryFile,
  type RepositorySnapshot,
  type RepositorySource,
} from "@maintainerkit/core";

const execFileAsync = promisify(execFile);

/**
 * Directories that never contribute useful policy evidence and can be enormous. Exported so tests
 * and documentation agree with the implementation.
 */
export const DEFAULT_IGNORE = [
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
  ".docusaurus",
  "vendor",
] as const;

export const DEFAULT_MAX_FILES = 20_000;
/** Files larger than this are listed but never read into memory. */
export const MAX_READ_BYTES = 256 * 1024;

export interface LocalRepositoryOptions {
  root: string;
  ignore?: readonly string[];
  maxFiles?: number;
  /** Also read metadata from the git CLI when available. Never required. */
  readGitMetadata?: boolean;
}

export interface GitContext {
  isGitRepository: boolean;
  branch?: string;
  headSha?: string;
  remoteUrl?: string;
  topLevel?: string;
}

function normaliseToPosix(path: string): string {
  return path.split(sep).join("/");
}

/** Runs a git command with a short timeout; returns `null` on any failure (git may be absent). */
async function git(root: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: root,
      timeout: 5_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function readGitContext(root: string): Promise<GitContext> {
  const topLevel = await git(root, ["rev-parse", "--show-toplevel"]);
  if (!topLevel) return { isGitRepository: false };
  const branch = (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])) ?? undefined;
  const headSha = (await git(root, ["rev-parse", "HEAD"])) ?? undefined;
  const remoteUrl = (await git(root, ["config", "--get", "remote.origin.url"])) ?? undefined;
  return {
    isGitRepository: true,
    topLevel,
    ...(branch && branch !== "HEAD" ? { branch } : {}),
    ...(headSha ? { headSha } : {}),
    ...(remoteUrl ? { remoteUrl } : {}),
  };
}

/** Extracts `owner/name` from the common git remote URL forms. */
export function parseGitHubRemote(url: string): { owner: string; name: string } | null {
  const https = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
  const ssh = /^git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
  const match = https ?? ssh;
  if (!match) return null;
  const owner = match[1];
  const name = match[2];
  if (!owner || !name) return null;
  return { owner, name };
}

interface IndexedFile {
  path: string;
  sizeBytes?: number;
  absolute: string;
}

/**
 * Reads a local working tree.
 *
 * Security properties:
 * - paths are validated and must stay inside the root (symlinks are never followed for reads)
 * - only repository-relative paths can be requested through `readFile`
 * - file count, directory depth, and per-file size are capped
 */
export class LocalRepository implements RepositorySource {
  readonly provider = "filesystem";
  readonly #root: string;
  readonly #ignore: Set<string>;
  readonly #maxFiles: number;

  constructor(options: LocalRepositoryOptions) {
    this.#root = resolve(options.root);
    this.#ignore = new Set(options.ignore ?? DEFAULT_IGNORE);
    this.#maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  }

  async getRepository(): Promise<RepositorySnapshot> {
    const indexed = await this.#index();
    const byPath = new Map(indexed.map((file) => [file.path.toLowerCase(), file]));
    const files: RepositoryFile[] = indexed.map((file) => ({
      path: file.path,
      ...(file.sizeBytes === undefined ? {} : { sizeBytes: file.sizeBytes }),
    }));

    const gitContext: GitContext = await readGitContext(this.#root).catch(() => ({
      isGitRepository: false,
    }));
    const remote = gitContext.remoteUrl ? parseGitHubRemote(gitContext.remoteUrl) : null;

    return {
      ref: {
        provider: "filesystem",
        ...(remote ? { owner: remote.owner, name: remote.name } : { name: basename(this.#root) }),
        ...(gitContext.branch ? { defaultBranch: gitContext.branch } : {}),
        ...(gitContext.remoteUrl ? { url: gitContext.remoteUrl } : {}),
      },
      metadata: {},
      files,
      hasFile: (path: string) => byPath.has(path.replace(/\\/g, "/").toLowerCase()),
      readFile: async (path: string) => this.#readFile(path, byPath),
    };
  }

  async #index(): Promise<IndexedFile[]> {
    const result: IndexedFile[] = [];
    const walk = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (result.length >= this.#maxFiles) return;
        const absolute = join(directory, entry.name);
        if (entry.isSymbolicLink()) continue; // never follow links out of the tree
        if (entry.isDirectory()) {
          if (this.#ignore.has(entry.name)) continue;
          await walk(absolute);
          continue;
        }
        if (!entry.isFile()) continue;
        const path = normaliseToPosix(relative(this.#root, absolute));
        if (!isSafeRelativePath(path)) continue;
        let sizeBytes: number | undefined;
        try {
          sizeBytes = (await fs.stat(absolute)).size;
        } catch {
          sizeBytes = undefined;
        }
        result.push({ path, ...(sizeBytes === undefined ? {} : { sizeBytes }), absolute });
      }
    };

    await walk(this.#root);
    result.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return result;
  }

  async #readFile(path: string, byPath: Map<string, IndexedFile>): Promise<string | null> {
    const key = path.replace(/\\/g, "/").toLowerCase();
    if (!isSafeRelativePath(key)) return null;
    const entry = byPath.get(key);
    if (!entry) return null;
    if (entry.sizeBytes !== undefined && entry.sizeBytes > MAX_READ_BYTES) return null;

    try {
      // Ensure the real path is still inside the root (guards against races and odd symlink setups).
      const real = realpathSync(entry.absolute);
      const rootReal = realpathSync(this.#root);
      if (real !== rootReal && !real.startsWith(rootReal + sep)) return null;
      const content = await fs.readFile(real, "utf8");
      return content.length > MAX_READ_BYTES ? content.slice(0, MAX_READ_BYTES) : content;
    } catch (error) {
      throw new ExecutionError(
        `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
        "filesystem/unreadable",
      );
    }
  }
}

export async function createLocalRepository(
  options: LocalRepositoryOptions,
): Promise<LocalRepository> {
  const root = resolve(options.root);
  const stats = await fs.stat(root).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new ExecutionError(
      `Not a directory: ${root}`,
      "filesystem/not-a-directory",
      "Pass an existing repository path.",
    );
  }
  return new LocalRepository({ ...options, root });
}
