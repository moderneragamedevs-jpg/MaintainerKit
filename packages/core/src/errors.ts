/**
 * Process exit codes. This table is the single source of truth; docs and tests reference it.
 *
 * 0 success · 1 policy failure · 2 usage/configuration error · 3 execution/environment error
 */
export const ExitCode = {
  Success: 0,
  PolicyFailure: 1,
  UsageError: 2,
  ExecutionError: 3,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export type ErrorCategory = "usage" | "config" | "execution";

export interface MaintainerKitErrorOptions {
  /** Stable machine-readable code, e.g. `github/auth-failed`. */
  code: string;
  category?: ErrorCategory;
  /** Actionable next step shown to the user. */
  hint?: string;
  cause?: unknown;
}

/**
 * Base error for all MaintainerKit failures.
 *
 * Every thrown error must carry a `code` so CI logs and reports can be machine-processed, and a
 * `hint` when there is a realistic fix (missing token, wrong spec version, ...).
 */
export class MaintainerKitError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly hint?: string;

  constructor(message: string, options: MaintainerKitErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.category = options.category ?? "execution";
    this.hint = options.hint;
  }

  /** Exit code implied by this error's category. */
  get exitCode(): ExitCodeValue {
    switch (this.category) {
      case "usage":
        return ExitCode.UsageError;
      case "config":
        return ExitCode.UsageError;
      case "execution":
        return ExitCode.ExecutionError;
    }
  }
}

/** Invalid command usage: unknown flag, missing argument, incompatible options. */
export class UsageError extends MaintainerKitError {
  constructor(message: string, hint?: string) {
    super(message, { code: "usage/invalid", category: "usage", hint });
  }
}

/** Configuration is missing, malformed, or unsupported (ContribSpec problems). */
export class ConfigError extends MaintainerKitError {
  constructor(message: string, code = "config/invalid", hint?: string) {
    super(message, { code, category: "config", hint });
  }
}

/** Environment or I/O failure: network, filesystem, authentication, timeouts. */
export class ExecutionError extends MaintainerKitError {
  constructor(message: string, code = "execution/failed", hint?: string, cause?: unknown) {
    super(message, { code, category: "execution", hint, cause });
  }
}

/** A requested write operation was not explicitly authorized. */
export class WriteNotAuthorizedError extends MaintainerKitError {
  constructor(operation: string) {
    super(`Write operation "${operation}" is not authorized.`, {
      code: "security/write-not-authorized",
      category: "usage",
      hint: "The GitHub write gate is disabled. Set MAINTAINERKIT_ALLOW_WRITE=true and enable the operation in configuration.",
    });
  }
}

/** Maps any thrown value onto a documented exit code. */
export function exitCodeForError(error: unknown): ExitCodeValue {
  if (error instanceof MaintainerKitError) return error.exitCode;
  return ExitCode.ExecutionError;
}

export function isMaintainerKitError(error: unknown): error is MaintainerKitError {
  return error instanceof MaintainerKitError;
}

/** Normalises any thrown value into a message plus optional code, for reports and logs. */
export function describeError(error: unknown): { message: string; code?: string; hint?: string } {
  if (error instanceof MaintainerKitError) {
    return { message: error.message, code: error.code, hint: error.hint };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
}
