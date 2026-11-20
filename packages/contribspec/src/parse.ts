import { ConfigError } from "@maintainerkit/core";
import { parse as parseYaml, LineCounter } from "yaml";

/** Hard cap on configuration size. A policy document is small; anything larger is hostile or broken. */
export const MAX_CONFIG_BYTES = 256 * 1024;

export interface ParseResult {
  /** Parsed document, or `undefined` when parsing failed. */
  document?: unknown;
  errorMessage?: string;
  line?: number;
  column?: number;
}

/**
 * YAML → JavaScript. Never throws: syntax problems come back as a structured result so the caller
 * can attach them to the diagnostic list alongside schema errors.
 */
export function parseConfigSource(source: string, sourceId = "contribspec"): ParseResult {
  if (Buffer.byteLength(source, "utf8") > MAX_CONFIG_BYTES) {
    return {
      errorMessage: `${sourceId} exceeds the ${MAX_CONFIG_BYTES} byte limit; refusing to parse.`,
    };
  }

  try {
    // A line counter makes parse errors carry a position, which turns "invalid YAML" into
    // "line 7, column 3" — the difference between a usable and an unusable error message.
    const lineCounter = new LineCounter();
    const document = parseYaml(source, {
      // Duplicate keys silently overwrite in YAML; refuse rather than guess which one wins.
      uniqueKeys: true,
      prettyErrors: false,
      lineCounter,
    });
    return { document };
  } catch (error) {
    // `instanceof YAMLParseError` is unreliable across module formats (CJS/ESM interop), so the
    // shape is checked instead: any parse error may carry linePos.
    const candidate = error as {
      message?: string;
      pos?: number[];
      linePos?: { line?: number; col?: number }[];
    };
    const first = candidate.linePos?.[0];
    const rawMessage = candidate.message ?? String(error);
    // yaml appends the offending source lines to the message; keep the first line only.
    const errorMessage = rawMessage.split("\n")[0] ?? rawMessage;
    const position =
      typeof first?.line === "number"
        ? { line: first.line, col: first.col ?? 0 }
        : typeof candidate.pos?.[0] === "number"
          ? offsetToLineColumn(source, candidate.pos[0])
          : undefined;
    return { errorMessage, ...(position ? { line: position.line, column: position.col } : {}) };
  }
}

/** 1-based line/column for a byte offset. Fallback when the parser does not report linePos. */
function offsetToLineColumn(source: string, offset: number): { line: number; col: number } {
  const safeOffset = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, safeOffset);
  const line = before.split("\n").length;
  const col = safeOffset - before.lastIndexOf("\n");
  return { line, col };
}

/** Throws a `ConfigError` for unparseable YAML. Used by callers that want exception flow. */
export function parseConfigSourceOrThrow(source: string, sourceId = "contribspec"): unknown {
  const result = parseConfigSource(source, sourceId);
  if (result.errorMessage !== undefined) {
    const location =
      result.line !== undefined ? ` (line ${result.line}, column ${result.column ?? 0})` : "";
    throw new ConfigError(
      `${sourceId} is not valid YAML${location}: ${result.errorMessage}`,
      "contribspec/invalid-yaml",
      "Fix the YAML syntax. Indentation and consistent quoting are the usual causes.",
    );
  }
  return result.document;
}
