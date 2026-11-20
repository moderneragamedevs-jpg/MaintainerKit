import { capabilityContract, type AIRequest, type AICapability } from "@maintainerkit/ai-core";
import { ADVISORY_NOTE, SYSTEM_GUARD, schemaInstruction, wrapUntrusted } from "./guard.js";

export interface IssueClassificationInput {
  title: string;
  body: string;
  labels?: string[];
  repository?: { owner?: string; name: string };
}

export interface DuplicateSuggestionInput {
  issue: { number: number; title: string; body: string };
  candidates: { number: number; title: string; body?: string }[];
}

export interface PullRequestSummaryInput {
  title: string;
  body: string;
  changedFiles: string[];
  commits: { message: string }[];
  additions?: number;
  deletions?: number;
}

export interface RiskAnalysisInput {
  title: string;
  body: string;
  changedFiles: string[];
  commits: { message: string }[];
}

export interface ReviewAssistanceInput {
  title: string;
  body: string;
  changedFiles: string[];
}

export interface ReleaseNotesInput {
  version?: string;
  commits: { sha?: string; message: string }[];
}

function systemPrompt(capability: AICapability): string {
  const contract = capabilityContract(capability);
  return [
    SYSTEM_GUARD,
    "",
    `Task: ${contract.title}. ${contract.description}`,
    "Constraints:",
    ...contract.constraints.map((constraint) => `- ${constraint}`),
    "",
    ADVISORY_NOTE,
    "",
    schemaInstruction(contract.schema),
  ].join("\n");
}

function request(capability: AICapability, user: string): AIRequest {
  const contract = capabilityContract(capability);
  return {
    capability,
    system: systemPrompt(capability),
    user,
    schema: contract.schema,
    temperature: 0.1,
    maxOutputTokens: 1024,
  };
}

/** Truncates a list for prompt size, marking the cut so the model does not assume completeness. */
function list(items: readonly string[], max: number, label: string): string {
  const shown = items.slice(0, max);
  const suffix = items.length > max ? `\n[${items.length - max} more ${label} omitted]` : "";
  return `${shown.join("\n") || "(none)"}${suffix}`;
}

export function buildIssueClassificationPrompt(input: IssueClassificationInput): AIRequest {
  const parts = [
    `Repository: ${input.repository ? `${input.repository.owner ? `${input.repository.owner}/` : ""}${input.repository.name}` : "(unspecified)"}`,
    wrapUntrusted("issue-title", input.title, 300),
    wrapUntrusted("issue-body", input.body, 6_000),
    input.labels && input.labels.length > 0
      ? `Existing labels (data):\n${list(input.labels, 20, "labels")}`
      : "Existing labels: none",
    'Classify the issue into exactly one category. Use "security" only when the report describes a vulnerability, not merely a bug.',
  ];
  return request("issue-classification", parts.join("\n\n"));
}

export function buildDuplicateSuggestionPrompt(input: DuplicateSuggestionInput): AIRequest {
  const candidateBlocks = input.candidates
    .slice(0, 20)
    .map((candidate) =>
      wrapUntrusted(
        `candidate-${candidate.number}`,
        `#${candidate.number} ${candidate.title}\n\n${candidate.body ?? ""}`,
        1_200,
      ),
    );

  const parts = [
    wrapUntrusted(
      "issue",
      `#${input.issue.number} ${input.issue.title}\n\n${input.issue.body}`,
      4_000,
    ),
    "Candidate issues to compare against:",
    ...(candidateBlocks.length > 0
      ? candidateBlocks
      : ["(no candidates supplied — return an empty duplicates array)"]),
    "Only reference numbers that appear in the candidate list above. Return an empty array when nothing is similar.",
  ];
  return request("duplicate-issue-suggestion", parts.join("\n\n"));
}

export function buildPullRequestSummaryPrompt(input: PullRequestSummaryInput): AIRequest {
  const parts = [
    wrapUntrusted("pull-request-title", input.title, 300),
    wrapUntrusted("pull-request-description", input.body, 6_000),
    `Changed files (data):\n${list(input.changedFiles, 50, "files")}`,
    `Commit messages (data):\n${wrapUntrusted(
      "commit-messages",
      input.commits
        .map((commit) => `- ${commit.message.split("\n")[0] ?? commit.message}`)
        .join("\n"),
      3_000,
    )}`,
    input.additions === undefined && input.deletions === undefined
      ? "Diff size: not reported"
      : `Diff size: +${input.additions ?? "?"} / -${input.deletions ?? "?"} lines`,
    "Summarise what changed and what a reviewer should verify. Do not claim tests passed unless the description says so.",
  ];
  return request("pull-request-summary", parts.join("\n\n"));
}

export function buildRiskAnalysisPrompt(input: RiskAnalysisInput): AIRequest {
  const parts = [
    wrapUntrusted("pull-request-title", input.title, 300),
    wrapUntrusted("pull-request-description", input.body, 5_000),
    `Changed files (data):\n${list(input.changedFiles, 50, "files")}`,
    `Commit messages (data):\n${wrapUntrusted(
      "commit-messages",
      input.commits
        .map((commit) => `- ${commit.message.split("\n")[0] ?? commit.message}`)
        .join("\n"),
      2_000,
    )}`,
    "Assess only what is visible in the data above. Suggest a security review when authentication, authorization, secrets, crypto, dependency acquisition, or CI permissions are touched.",
  ];
  return request("risk-analysis", parts.join("\n\n"));
}

export function buildReviewAssistancePrompt(input: ReviewAssistanceInput): AIRequest {
  const parts = [
    wrapUntrusted("pull-request-title", input.title, 300),
    wrapUntrusted("pull-request-description", input.body, 5_000),
    `Changed files (data):\n${list(input.changedFiles, 50, "files")}`,
    "Draft review notes and questions a human reviewer should consider. Do not state that the change is approved or safe to merge.",
  ];
  return request("review-assistance", parts.join("\n\n"));
}

export function buildReleaseNotesPrompt(input: ReleaseNotesInput): AIRequest {
  const parts = [
    input.version
      ? `Target version (data): ${wrapUntrusted("version", input.version, 60)}`
      : "Target version: unspecified",
    `Commits (data):\n${wrapUntrusted(
      "commits",
      input.commits
        .slice(0, 200)
        .map(
          (commit) =>
            `- ${commit.sha ? `${commit.sha.slice(0, 7)} ` : ""}${commit.message.split("\n")[0] ?? commit.message}`,
        )
        .join("\n"),
      6_000,
    )}`,
    "Group user-visible changes into sections (Features, Fixes, Documentation, Internal) and list breaking changes. Only use changes present above; never invent entries. This is a draft a maintainer will edit.",
  ];
  return request("release-notes", parts.join("\n\n"));
}

export const PROMPT_BUILDERS = {
  "issue-classification": buildIssueClassificationPrompt,
  "duplicate-issue-suggestion": buildDuplicateSuggestionPrompt,
  "pull-request-summary": buildPullRequestSummaryPrompt,
  "risk-analysis": buildRiskAnalysisPrompt,
  "review-assistance": buildReviewAssistancePrompt,
  "release-notes": buildReleaseNotesPrompt,
} as const;
