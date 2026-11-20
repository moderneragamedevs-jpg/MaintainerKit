import type { JsonSchema } from "./types.js";
import { AIValidationError } from "./errors.js";

/**
 * Structured-output handling.
 *
 * Models are asked for JSON, but they may wrap it in prose or a fenced code block, or return
 * something schema-shaped but wrong. `parseStructured` strips wrapping, and `validateAgainstSchema`
 * enforces a closed subset of JSON Schema with Ajv. Anything that fails is rejected entirely.
 */

/** Extracts a JSON object from model text: raw JSON, fenced JSON, or JSON with leading prose. */
export function parseStructured(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = (fenced?.[1] ?? trimmed).trim();

  const attempt = (value: string): { ok: true; data: unknown } | { ok: false } => {
    try {
      return { ok: true, data: JSON.parse(value) };
    } catch {
      return { ok: false };
    }
  };

  const direct = attempt(candidate);
  if (direct.ok) return direct.data;

  // Last resort: take the outermost object/array literal. Bounded scan, no backtracking.
  const firstBrace = candidate.search(/[[{]/);
  if (firstBrace >= 0) {
    const opener = candidate[firstBrace];
    const closer = opener === "{" ? "}" : "]";
    const lastCloser = candidate.lastIndexOf(closer);
    if (lastCloser > firstBrace) {
      const sliced = attempt(candidate.slice(firstBrace, lastCloser + 1));
      if (sliced.ok) return sliced.data;
    }
  }

  throw new AIValidationError(["response is not valid JSON"]);
}

type ValidateFn = ((data: unknown) => boolean) & { errors?: unknown[] | null };

interface AjvLike {
  compile(schema: unknown): ValidateFn;
  addSchema(schema: unknown, key?: string): unknown;
}

let ajv: AjvLike | undefined;
const compiled = new Map<string, ValidateFn>();

async function getAjv(): Promise<AjvLike> {
  if (ajv) return ajv;
  const { Ajv2020 } = await import("ajv/dist/2020.js");
  ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
    allowUnionTypes: true,
  }) as unknown as AjvLike;
  return ajv;
}

function keyOf(schema: JsonSchema): string {
  return JSON.stringify(schema);
}

function describe(errors: unknown[] | null | undefined): string[] {
  if (!errors) return ["schema validation failed"];
  return errors.map((error) => {
    const typed = error as { instancePath?: string; message?: string };
    return `${typed.instancePath || "(root)"} ${typed.message ?? "is invalid"}`;
  });
}

/** Validates already-parsed data. Throws `AIValidationError` with human-readable problems. */
export async function validateAgainstSchema(data: unknown, schema: JsonSchema): Promise<unknown> {
  const identifier = keyOf(schema);
  let validate = compiled.get(identifier);
  if (!validate) {
    const instance = await getAjv();
    validate = instance.compile(schema);
    compiled.set(identifier, validate);
  }
  if (!validate(data)) throw new AIValidationError(describe(validate.errors));
  return data;
}

/** Parse then validate. The only supported path from model text to usable data. */
export async function parseAndValidate(text: string, schema: JsonSchema): Promise<unknown> {
  return validateAgainstSchema(parseStructured(text), schema);
}

/**
 * Deterministic mock output for any supported schema, used by the mock provider and tests.
 * Generates values from the schema so the mock cannot drift from the contracts.
 */
export function generateMockValue(schema: JsonSchema): unknown {
  const type = schema.type;
  switch (type) {
    case "object": {
      const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
      const required = Array.isArray(schema.required)
        ? (schema.required as string[])
        : Object.keys(properties);
      const result: Record<string, unknown> = {};
      for (const key of required) {
        const propertySchema = properties[key] ?? { type: "string" };
        result[key] = generateMockValue(propertySchema);
      }
      return result;
    }
    case "array": {
      const items = (schema.items ?? { type: "string" }) as JsonSchema;
      const minItems = typeof schema.minItems === "number" ? schema.minItems : 1;
      const count = Math.max(minItems, 1);
      return Array.from({ length: count }, () => generateMockValue(items));
    }
    case "number":
    case "integer": {
      const minimum = typeof schema.minimum === "number" ? schema.minimum : 0;
      const maximum = typeof schema.maximum === "number" ? schema.maximum : minimum + 1;
      const value = minimum + (maximum - minimum) / 2;
      return type === "integer" ? Math.round(value) : value;
    }
    case "boolean":
      return false;
    case "string":
    default: {
      const allowed = Array.isArray(schema.enum) ? (schema.enum as unknown[]) : undefined;
      if (allowed && allowed.length > 0) return allowed[0];
      const maxLength = typeof schema.maxLength === "number" ? schema.maxLength : 100;
      const text = "Mock value from the MaintainerKit mock provider.";
      return text.slice(0, Math.max(1, maxLength));
    }
  }
}
