import type { AdvisoryFinding, Diagnostic, PolicySubject } from "@maintainerkit/core";
import {
  AIError,
  executeAIRequest,
  toAdvisory,
  type AICapability,
  type AIProvider,
} from "@maintainerkit/ai-core";
import {
  buildPullRequestSummaryPrompt,
  buildReleaseNotesPrompt,
  buildReviewAssistancePrompt,
  buildRiskAnalysisPrompt,
} from "@maintainerkit/ai-prompts";
import { createProviderFromConfig } from "@maintainerkit/ai-providers";

/** Capabilities that make sense for each subject kind. Everything else is reported as inapplicable. */
export const APPLICABLE_CAPABILITIES: Record<PolicySubject["kind"], readonly AICapability[]> = {
  pull_request: ["pull-request-summary", "risk-analysis", "review-assistance"],
  release: ["release-notes"],
  repository: [],
};

export interface AdvisorConfig {
  providerId: string;
  model?: string;
  capabilities: readonly string[];
  timeoutMs?: number;
  maxAttempts?: number;
  now?: Date;
  /** Injected provider for tests and for embedding applications. */
  provider?: AIProvider;
}

export interface AdvisorOutcomeResult {
  advisories: AdvisoryFinding[];
  diagnostics: Diagnostic[];
}

function describe(error: unknown): string {
  if (error instanceof AIError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs the configured AI capabilities for a subject.
 *
 * Isolation rules (the reason this is a separate package used by both the CLI and the Action):
 * - each capability is attempted independently; one failure does not cancel the others
 * - every failure becomes a warning diagnostic, never a finding
 * - the caller receives advisories as a separate array, so they cannot alter a policy verdict
 */
export async function produceAdvisories(
  input: { subject: PolicySubject },
  config: AdvisorConfig,
): Promise<AdvisorOutcomeResult> {
  let provider: AIProvider;
  try {
    provider =
      config.provider ??
      createProviderFromConfig({
        provider: config.providerId,
        ...(config.model ? { model: config.model } : {}),
      });
  } catch (error) {
    // A misconfigured provider must not break a run: the policy verdict does not depend on advice.
    return {
      advisories: [],
      diagnostics: [
        {
          code: "ai/provider-misconfigured",
          severity: "warning",
          message: `AI advisories were skipped: ${describe(error)}`,
          path: "/ai/provider",
          hint: "Fix ai.provider in ContribSpec or pass a valid --provider value.",
        },
      ],
    };
  }

  const applicable = APPLICABLE_CAPABILITIES[input.subject.kind];
  const requested = (config.capabilities as readonly AICapability[]).filter((capability) =>
    applicable.includes(capability),
  );
  const skipped = (config.capabilities as readonly AICapability[]).filter(
    (capability) => !applicable.includes(capability),
  );

  const advisories: AdvisoryFinding[] = [];
  const diagnostics: Diagnostic[] = [];
  const now = config.now ?? new Date();
  const pullRequest = input.subject.pullRequest;

  for (const capability of skipped) {
    diagnostics.push({
      code: "ai/capability-not-applicable",
      severity: "warning",
      message: `Capability "${capability}" does not apply to a ${input.subject.kind} subject and was skipped.`,
      path: "/ai/capabilities",
    });
  }

  const run = (capability: AICapability, request: ReturnType<typeof buildRiskAnalysisPrompt>) =>
    executeAIRequest({
      provider,
      request,
      ...(config.model ? { model: config.model } : {}),
      ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}),
      ...(config.maxAttempts ? { maxAttempts: config.maxAttempts } : {}),
    }).then((result) => ({ capability, result }));

  for (const capability of requested) {
    try {
      if (capability === "pull-request-summary" && pullRequest) {
        const { result } = await run(
          capability,
          buildPullRequestSummaryPrompt({
            title: pullRequest.title,
            body: pullRequest.body ?? "",
            changedFiles: pullRequest.changedFiles,
            commits: pullRequest.commits.map((commit) => ({ message: commit.message })),
            ...(pullRequest.additions === undefined ? {} : { additions: pullRequest.additions }),
            ...(pullRequest.deletions === undefined ? {} : { deletions: pullRequest.deletions }),
          }),
        );
        const data = result.data as {
          summary: string;
          changes: string[];
          risks: string[];
          testingNotes: string;
        };
        advisories.push(
          toAdvisory(result, {
            id: `advisory:${capability}:${pullRequest.number}:${advisories.length + 1}`,
            promptVersion: "1",
            title: "Pull request summary",
            summary: data.summary,
            items: [
              ...data.changes.slice(0, 5).map((change) => ({ label: "change", detail: change })),
              ...data.risks.slice(0, 3).map((risk) => ({ label: "risk", detail: risk })),
              ...(data.testingNotes ? [{ label: "testing", detail: data.testingNotes }] : []),
            ],
            createdAt: now.toISOString(),
          }),
        );
      }

      if (capability === "risk-analysis" && pullRequest) {
        const { result } = await run(
          capability,
          buildRiskAnalysisPrompt({
            title: pullRequest.title,
            body: pullRequest.body ?? "",
            changedFiles: pullRequest.changedFiles,
            commits: pullRequest.commits.map((commit) => ({ message: commit.message })),
          }),
        );
        const data = result.data as {
          riskLevel: string;
          factors: { factor: string; level: string; explanation: string }[];
          requiresSecurityReview: boolean;
        };
        advisories.push(
          toAdvisory(result, {
            id: `advisory:${capability}:${pullRequest.number}:${advisories.length + 1}`,
            promptVersion: "1",
            title: `Risk analysis: ${data.riskLevel}${data.requiresSecurityReview ? " (security review suggested)" : ""}`,
            summary:
              data.factors.length === 0
                ? "No specific risk factors were identified in the provided change data."
                : data.factors
                    .map((factor) => `${factor.factor} (${factor.level}): ${factor.explanation}`)
                    .join(" "),
            createdAt: now.toISOString(),
          }),
        );
      }

      if (capability === "review-assistance" && pullRequest) {
        const { result } = await run(
          capability,
          buildReviewAssistancePrompt({
            title: pullRequest.title,
            body: pullRequest.body ?? "",
            changedFiles: pullRequest.changedFiles,
          }),
        );
        const data = result.data as {
          comments: { path?: string; note: string; priority: string }[];
          overall: string;
        };
        advisories.push(
          toAdvisory(result, {
            id: `advisory:${capability}:${pullRequest.number}:${advisories.length + 1}`,
            promptVersion: "1",
            title: "Review notes",
            summary: data.overall,
            items: data.comments.slice(0, 8).map((comment) => ({
              label: `${comment.priority}${comment.path ? ` ${comment.path}` : ""}`,
              detail: comment.note,
            })),
            createdAt: now.toISOString(),
          }),
        );
      }

      if (capability === "release-notes" && input.subject.release) {
        const { result } = await run(
          capability,
          buildReleaseNotesPrompt({
            ...(input.subject.release.version ? { version: input.subject.release.version } : {}),
            commits: [],
          }),
        );
        advisories.push(
          toAdvisory(result, {
            id: `advisory:${capability}:${advisories.length + 1}`,
            promptVersion: "1",
            title: "Release notes draft",
            summary:
              "Draft generated from the supplied commit data; a maintainer must edit and publish it.",
            createdAt: now.toISOString(),
          }),
        );
      }
    } catch (error) {
      diagnostics.push({
        code: "ai/capability-failed",
        severity: "warning",
        message: `Capability "${capability}" did not produce advice: ${describe(error)}`,
        path: "/ai/capabilities",
        hint: "Policy results are unaffected.",
      });
    }
  }

  if (requested.length === 0 && skipped.length === 0) {
    diagnostics.push({
      code: "ai/no-capabilities",
      severity: "warning",
      message: "AI was requested but no capabilities are enabled in the policy document.",
      path: "/ai/capabilities",
      hint: "Add e.g. `capabilities: [pull-request-summary]` and `enabled: true`.",
    });
  }

  return { advisories, diagnostics };
}

/** Creates the callback shape the workflow layer expects. */
export function createAdvisor(config: AdvisorConfig) {
  return async (input: { subject: PolicySubject }) => produceAdvisories(input, config);
}
