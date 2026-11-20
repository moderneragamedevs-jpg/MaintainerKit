import type { AICapability, JsonSchema } from "./types.js";

/**
 * Capability contracts.
 *
 * Each capability owns a closed JSON Schema (no additional properties) with bounded string lengths.
 * The schema is the boundary between an untrusted model and the rest of MaintainerKit: output that
 * does not validate is discarded, never partially accepted.
 */
export interface CapabilityContract {
  id: AICapability;
  title: string;
  description: string;
  /** Human summary of what the model may and may not do. */
  constraints: readonly string[];
  schema: JsonSchema;
  promptVersion: string;
}

const shortString = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });

export const CAPABILITY_CONTRACTS: Record<AICapability, CapabilityContract> = {
  "issue-classification": {
    id: "issue-classification",
    title: "Issue classification",
    description: "Classifies an issue into a small, fixed set of categories and suggests labels.",
    constraints: [
      "Output must be one of the declared categories.",
      "Labels are suggestions only; MaintainerKit never applies them.",
    ],
    promptVersion: "1",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["category", "confidence", "rationale", "suggestedLabels"],
      properties: {
        category: {
          type: "string",
          enum: ["bug", "feature", "question", "docs", "chore", "security"],
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        rationale: shortString(600),
        suggestedLabels: { type: "array", maxItems: 6, items: shortString(40) },
      },
    },
  },
  "duplicate-issue-suggestion": {
    id: "duplicate-issue-suggestion",
    title: "Duplicate issue suggestion",
    description: "Suggests which of the supplied candidate issues may describe the same problem.",
    constraints: [
      "May only reference candidate numbers supplied in the request.",
      "Never closes or merges anything; a human confirms duplicates.",
    ],
    promptVersion: "1",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["duplicates"],
      properties: {
        duplicates: {
          type: "array",
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["issueNumber", "similarity", "reason"],
            properties: {
              issueNumber: { type: "integer", minimum: 1 },
              similarity: { type: "number", minimum: 0, maximum: 1 },
              reason: shortString(400),
            },
          },
        },
      },
    },
  },
  "pull-request-summary": {
    id: "pull-request-summary",
    title: "Pull request summary",
    description: "Summarises what a pull request changes for a reviewer.",
    constraints: [
      "Summarises only; must not claim tests passed unless the input says so.",
      "Never states that a change is safe or ready to merge.",
    ],
    promptVersion: "1",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "changes", "risks", "testingNotes"],
      properties: {
        summary: shortString(1200),
        changes: { type: "array", maxItems: 12, items: shortString(300) },
        risks: { type: "array", maxItems: 8, items: shortString(300) },
        testingNotes: shortString(600),
      },
    },
  },
  "risk-analysis": {
    id: "risk-analysis",
    title: "Risk analysis",
    description:
      "Identifies risk factors in a change and whether a security review looks warranted.",
    constraints: [
      "Risk level is advisory; it never blocks a merge or changes a policy result.",
      "Must justify every factor with reference to the provided input only.",
    ],
    promptVersion: "1",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["riskLevel", "factors", "requiresSecurityReview"],
      properties: {
        riskLevel: { type: "string", enum: ["low", "medium", "high"] },
        factors: {
          type: "array",
          maxItems: 10,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["factor", "level", "explanation"],
            properties: {
              factor: shortString(160),
              level: { type: "string", enum: ["low", "medium", "high"] },
              explanation: shortString(400),
            },
          },
        },
        requiresSecurityReview: { type: "boolean" },
      },
    },
  },
  "review-assistance": {
    id: "review-assistance",
    title: "Review assistance",
    description: "Drafts review notes and questions for a human reviewer.",
    constraints: [
      "Notes are suggestions for a human reviewer.",
      "Must not demand a specific approval decision.",
    ],
    promptVersion: "1",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["comments", "overall"],
      properties: {
        comments: {
          type: "array",
          maxItems: 15,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["note", "priority"],
            properties: {
              path: shortString(300),
              note: shortString(600),
              priority: { type: "string", enum: ["low", "medium", "high"] },
            },
          },
        },
        overall: shortString(600),
      },
    },
  },
  "release-notes": {
    id: "release-notes",
    title: "Release notes draft",
    description: "Drafts user-facing release notes grouped by section.",
    constraints: [
      "Produces a draft only; a maintainer edits and publishes.",
      "Must not invent changes that are absent from the provided commit data.",
    ],
    promptVersion: "1",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["sections", "breakingChanges"],
      properties: {
        sections: {
          type: "array",
          maxItems: 6,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "entries"],
            properties: {
              title: shortString(80),
              entries: { type: "array", maxItems: 20, items: shortString(300) },
            },
          },
        },
        breakingChanges: { type: "array", maxItems: 10, items: shortString(300) },
      },
    },
  },
};

export function capabilityContract(capability: AICapability): CapabilityContract {
  return CAPABILITY_CONTRACTS[capability];
}

export function isAICapability(value: string): value is AICapability {
  return Object.prototype.hasOwnProperty.call(CAPABILITY_CONTRACTS, value);
}
