import { pointer, type Diagnostic } from "@maintainerkit/core";
import { CONTRIBSPEC_1_0_SCHEMA } from "./schema.generated.js";
import { checkSpecVersion } from "./version.js";
import { parseConfigSource } from "./parse.js";
import { resolveConfig } from "./resolve.js";
import type { ContribSpecDocument, ResolvedConfig } from "./types.js";

export { CONTRIBSPEC_1_0_SCHEMA };

type ValidateFunction = ((data: unknown) => boolean) & { errors?: unknown[] | null };

interface AjvInstance {
  compile(schema: unknown): ValidateFunction;
}

let compiledValidator: ValidateFunction | undefined;

/**
 * Ajv is loaded lazily so that commands which never read a config (e.g. `--help`) do not pay the
 * startup cost, and so a broken optional dependency surfaces as a clear error at use time.
 */
async function getValidator(): Promise<ValidateFunction> {
  if (compiledValidator) return compiledValidator;
  const { Ajv2020 } = await import("ajv/dist/2020.js");
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    allowDate: false,
    validateFormats: false,
  }) as unknown as AjvInstance;
  compiledValidator = ajv.compile(CONTRIBSPEC_1_0_SCHEMA);
  return compiledValidator;
}

/** Synchronous variant used by tests and by callers that already imported Ajv. */
export async function createContribSpecValidator(): Promise<ValidateFunction> {
  return getValidator();
}

interface AjvErrorLike {
  instancePath?: string;
  keyword?: string;
  message?: string;
  params?: Record<string, unknown>;
}

function describeSchemaError(error: AjvErrorLike): Diagnostic {
  const path = error.instancePath ?? "";
  const keyword = error.keyword ?? "schema";
  const params = error.params ?? {};
  let message = error.message ?? "does not match the schema";

  switch (keyword) {
    case "required": {
      const missing = String(params.missingProperty ?? "");
      message = `missing required property "${missing}"`;
      break;
    }
    case "additionalProperties": {
      const extra = String(params.additionalProperty ?? "");
      message = `unknown property "${extra}" (ContribSpec rejects unknown keys so typos cannot be ignored)`;
      break;
    }
    case "enum": {
      const allowed = Array.isArray(params.allowedValues) ? params.allowedValues.join(", ") : "";
      message = `${message}${allowed ? ` — allowed: ${allowed}` : ""}`;
      break;
    }
    case "oneOf":
    case "anyOf":
      message = "does not match any allowed shape";
      break;
    case "type": {
      message = `expected ${String(params.type ?? "a different type")}`;
      break;
    }
    default:
      break;
  }

  return {
    code: `contribspec/schema.${keyword}`,
    severity: "error",
    message,
    path,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}

export interface SemanticValidationOptions {
  /** Rule ids known to the caller's policy engine; unknown overrides become errors. */
  knownRuleIds?: readonly string[];
}

const PATH_PATTERN_UNSAFE = /(^\/)|(^[a-zA-Z]:)|(^\\\\)|(^~)|(\0)|(^|\/)\.\.(\/|$)/;

function checkPath(
  value: string | undefined,
  segments: (string | number)[],
  diagnostics: Diagnostic[],
): void {
  if (value === undefined) return;
  if (PATH_PATTERN_UNSAFE.test(value.replace(/\\/g, "/"))) {
    diagnostics.push({
      code: "contribspec/unsafe-path",
      severity: "error",
      message: `"${value}" is not a safe repository-relative path.`,
      path: pointer(...segments),
      hint: "Use a plain path relative to the repository root (no leading slash, no '..', no drive letters).",
    });
  }
}

/** Cross-field rules that a JSON Schema cannot express. */
export function validateSemantics(
  document: ContribSpecDocument,
  options: SemanticValidationOptions = {},
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [...checkSpecVersion(document.specVersion)];
  const doc = document as ContribSpecDocument;

  // --- repository.requiredFiles ---------------------------------------------------------------
  const requiredFiles = doc.repository?.requiredFiles ?? [];
  const requiredPaths = requiredFiles.map((entry) =>
    typeof entry === "string" ? entry : entry.path,
  );
  requiredPaths.forEach((path, index) => {
    checkPath(path, ["repository", "requiredFiles", index], diagnostics);
    if (typeof path === "string" && path.trim() === "") {
      diagnostics.push({
        code: "contribspec/empty-path",
        severity: "error",
        message: "requiredFiles entries must not be empty.",
        path: pointer("repository", "requiredFiles", index),
      });
    }
  });
  for (const dupe of duplicates(requiredPaths)) {
    diagnostics.push({
      code: "contribspec/duplicate-file",
      severity: "warning",
      message: `"${dupe}" is listed more than once in repository.requiredFiles.`,
      path: pointer("repository", "requiredFiles"),
    });
  }

  // --- pull requests --------------------------------------------------------------------------
  const title = doc.pullRequests?.title;
  if (title?.types && title.types.length === 0) {
    diagnostics.push({
      code: "contribspec/empty-types",
      severity: "error",
      message: "pullRequests.title.types must list at least one type when present.",
      path: pointer("pullRequests", "title", "types"),
      hint: "Remove the key to use the built-in Conventional Commits type list.",
    });
  }
  if (title?.convention === "none" && title.types) {
    diagnostics.push({
      code: "contribspec/ignored-types",
      severity: "warning",
      message: 'pullRequests.title.types is ignored when convention is "none".',
      path: pointer("pullRequests", "title", "types"),
    });
  }
  for (const dupe of duplicates(title?.types ?? [])) {
    diagnostics.push({
      code: "contribspec/duplicate-type",
      severity: "warning",
      message: `"${dupe}" is listed more than once in pullRequests.title.types.`,
      path: pointer("pullRequests", "title", "types"),
    });
  }

  const sections = doc.pullRequests?.description?.requiredSections ?? [];
  for (const dupe of duplicates(sections)) {
    diagnostics.push({
      code: "contribspec/duplicate-section",
      severity: "warning",
      message: `"${dupe}" is listed more than once in pullRequests.description.requiredSections.`,
      path: pointer("pullRequests", "description", "requiredSections"),
    });
  }
  for (const dupe of duplicates(doc.pullRequests?.checks?.required ?? [])) {
    diagnostics.push({
      code: "contribspec/duplicate-check",
      severity: "warning",
      message: `"${dupe}" is listed more than once in pullRequests.checks.required.`,
      path: pointer("pullRequests", "checks", "required"),
    });
  }

  // --- release --------------------------------------------------------------------------------
  checkPath(doc.release?.changelogPath, ["release", "changelogPath"], diagnostics);
  (doc.release?.versionFiles ?? []).forEach((path, index) =>
    checkPath(path, ["release", "versionFiles", index], diagnostics),
  );

  // --- security -------------------------------------------------------------------------------
  const security = doc.security;
  if ((security?.minimumApprovals ?? 0) > 0 && security?.requireBranchProtection === false) {
    diagnostics.push({
      code: "contribspec/approvals-without-protection",
      severity: "warning",
      message:
        "security.minimumApprovals is set but security.requireBranchProtection is false; the approval check only inspects branch protection data.",
      path: pointer("security", "minimumApprovals"),
    });
  }

  // --- AI and agent authority -----------------------------------------------------------------
  const ai = doc.ai;
  const capabilities = ai?.capabilities ?? [];
  if (ai?.enabled === true && capabilities.length === 0) {
    diagnostics.push({
      code: "contribspec/ai-without-capabilities",
      severity: "error",
      message: "ai.enabled is true but no ai.capabilities are listed; nothing would run.",
      path: pointer("ai", "capabilities"),
      hint: "List at least one capability, or set ai.enabled to false.",
    });
  }
  if (ai?.enabled !== true && capabilities.length > 0) {
    diagnostics.push({
      code: "contribspec/capabilities-without-ai",
      severity: "error",
      message:
        "ai.capabilities is set while ai.enabled is not true; the capabilities would never run.",
      path: pointer("ai", "enabled"),
      hint: "Set ai.enabled to true to run them, or remove ai.capabilities.",
    });
  }
  if (ai?.enabled !== true && ai?.provider !== undefined) {
    diagnostics.push({
      code: "contribspec/provider-without-ai",
      severity: "warning",
      message: "ai.provider is configured but AI is disabled; the value is ignored.",
      path: pointer("ai", "provider"),
    });
  }
  if (ai?.enabled === true && ai.provider === undefined) {
    diagnostics.push({
      code: "contribspec/ai-without-provider",
      severity: "warning",
      message:
        "ai.enabled is true without ai.provider; the provider must be supplied by --provider or MAINTAINERKIT_AI_PROVIDER at runtime.",
      path: pointer("ai", "provider"),
    });
  }

  const agents = doc.agents;
  if (agents?.humanApprovalRequired === false) {
    const mutatingAllowed = (agents.allowedOperations ?? []).filter(
      (operation) => operation !== "read",
    );
    if (mutatingAllowed.length > 0) {
      diagnostics.push({
        code: "contribspec/agents-approval-disabled",
        severity: "error",
        message: `agents.humanApprovalRequired cannot be false while mutating operations are allowed (${mutatingAllowed.join(", ")}).`,
        path: pointer("agents", "humanApprovalRequired"),
        hint: "Human approval for sensitive operations is a core security invariant; remove the override.",
      });
    }
  }

  const approvalFor = ai?.requireHumanApprovalFor;
  if (ai?.enabled === true && approvalFor !== undefined && !approvalFor.includes("merge")) {
    diagnostics.push({
      code: "contribspec/ai-approval-gap",
      severity: "warning",
      message:
        'ai.requireHumanApprovalFor does not include "merge". Merging must remain human-controlled.',
      path: pointer("ai", "requireHumanApprovalFor"),
    });
  }

  // --- rule overrides -------------------------------------------------------------------------
  if (doc.rules && options.knownRuleIds) {
    const known = new Set(options.knownRuleIds);
    for (const ruleId of Object.keys(doc.rules)) {
      if (!known.has(ruleId)) {
        diagnostics.push({
          code: "contribspec/unknown-rule",
          severity: "error",
          message: `rules.${ruleId} does not match any rule in this build.`,
          path: pointer("rules", ruleId),
          hint: `Known rules: ${[...known].sort().join(", ")}`,
        });
      }
    }
  }

  return diagnostics;
}

export interface ValidationResult {
  valid: boolean;
  diagnostics: Diagnostic[];
  /** Present when structural validation passed (even if semantic checks emit warnings). */
  document?: ContribSpecDocument;
  /** Present when the document is fully valid. */
  resolved?: ResolvedConfig;
}

async function validateUnknown(
  input: unknown,
  options: SemanticValidationOptions,
): Promise<ValidationResult> {
  if (!isPlainObject(input)) {
    return {
      valid: false,
      diagnostics: [
        {
          code: "contribspec/not-an-object",
          severity: "error",
          message: "A ContribSpec document must be a YAML mapping with at least a specVersion key.",
          path: "",
          hint: "Run `maintainerkit init` to generate a valid starting document.",
        },
      ],
    };
  }

  const validate = await getValidator();
  const structuralOk = validate(input);
  const diagnostics: Diagnostic[] = [];

  if (!structuralOk) {
    for (const error of (validate.errors ?? []) as AjvErrorLike[]) {
      diagnostics.push(describeSchemaError(error));
    }
    return { valid: false, diagnostics };
  }

  const document = input as unknown as ContribSpecDocument;
  diagnostics.push(...validateSemantics(document, options));
  const valid = diagnostics.every((diagnostic) => diagnostic.severity !== "error");

  if (!valid) return { valid, diagnostics, document };

  return { valid, diagnostics, document, resolved: resolveConfig(document) };
}

/** Validates an already-parsed document (object form). */
export async function validateContribSpecDocument(
  input: unknown,
  options: SemanticValidationOptions = {},
): Promise<ValidationResult> {
  return validateUnknown(input, options);
}

/** Parses YAML then validates. YAML syntax failures are reported as diagnostics, not exceptions. */
export async function validateContribSpecSource(
  source: string,
  options: SemanticValidationOptions & { sourceId?: string } = {},
): Promise<ValidationResult> {
  const parsed = parseConfigSource(source, options.sourceId);
  if (parsed.errorMessage !== undefined) {
    const location =
      parsed.line !== undefined ? ` at line ${parsed.line}, column ${parsed.column ?? 0}` : "";
    return {
      valid: false,
      diagnostics: [
        {
          code: "contribspec/invalid-yaml",
          severity: "error",
          message: `${parsed.errorMessage}${location}`,
          path: "",
          hint: "Check indentation and quoting. Duplicate keys are rejected.",
        },
      ],
    };
  }

  if (parsed.document === null || parsed.document === undefined) {
    return {
      valid: false,
      diagnostics: [
        {
          code: "contribspec/empty-document",
          severity: "error",
          message: "The configuration file is empty.",
          path: "",
          hint: "Run `maintainerkit init` to generate a starting document.",
        },
      ],
    };
  }

  return validateUnknown(parsed.document, options);
}
