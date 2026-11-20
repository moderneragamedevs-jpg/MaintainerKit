import { WriteNotAuthorizedError } from "@maintainerkit/core";
import type { GitHubCheckPublisherApi } from "./api-types.js";

/**
 * Write gate.
 *
 * There is exactly one mutating operation in the initial release: publishing a check run. It is
 * reachable only through `publishCheckRun`, which refuses to call the API unless authorization was
 * granted explicitly by both the workflow input and the environment gate.
 *
 * Keeping this in the integration package (rather than the CLI) means no other code path can
 * accidentally gain write access: the publisher is constructed only when the gate is open.
 */
export interface WriteGateOptions {
  allowWrite: boolean;
  /** Human-readable justification recorded in the audit event. */
  reason?: string;
}

export function assertWriteAllowed(options: WriteGateOptions, operation: string): void {
  if (!options.allowWrite) throw new WriteNotAuthorizedError(operation);
}

export interface CheckRunContent {
  name: string;
  headSha: string;
  title: string;
  summary: string;
  text?: string;
  conclusion: "success" | "failure" | "neutral";
}

export interface PublishResult {
  id: number;
  url?: string;
}

/**
 * Publishes a completed check run. Requires `checks: write` on the token and an open write gate.
 *
 * The caller supplies pre-rendered content so this package stays free of report formatting (and of
 * any temptation to put unredacted findings into a public check run).
 */
export async function publishCheckRun(
  client: GitHubCheckPublisherApi,
  target: { owner: string; repo: string },
  content: CheckRunContent,
  options: WriteGateOptions & { now?: Date },
): Promise<PublishResult> {
  assertWriteAllowed(options, "github.check-run");

  const result = await client.createCheckRun(target.owner, target.repo, {
    name: content.name,
    head_sha: content.headSha,
    status: "completed",
    conclusion: content.conclusion,
    output: {
      title: content.title,
      summary: content.summary,
      ...(content.text ? { text: content.text } : {}),
    },
    completed_at: (options.now ?? new Date()).toISOString(),
  });

  return { id: result.id, ...(result.html_url ? { url: result.html_url } : {}) };
}

/** Resolves the write gate from the environment. Presence of any other value keeps writes closed. */
export function writeGateFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  requested: boolean,
): WriteGateOptions {
  const gate = (env.MAINTAINERKIT_ALLOW_WRITE ?? "").toLowerCase();
  return {
    allowWrite: requested && (gate === "true" || gate === "1"),
    reason: requested ? "workflow requested check-run publishing" : "publishing not requested",
  };
}
