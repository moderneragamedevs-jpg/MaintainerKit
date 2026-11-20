import type { OutputFormat } from "./output.js";

/**
 * Command context. Everything external (cwd, environment, streams, clock) is injectable so CLI tests
 * run in-process without touching the real process state.
 */
export interface CliContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  out: (chunk: string) => void;
  err: (chunk: string) => void;
  now: () => Date;
}

export interface GlobalOptions {
  format?: OutputFormat;
  verbose?: boolean;
}

export function createContext(overrides: Partial<CliContext> = {}): CliContext {
  return {
    cwd: overrides.cwd ?? process.cwd(),
    env: overrides.env ?? process.env,
    out: overrides.out ?? ((chunk: string) => process.stdout.write(chunk)),
    err: overrides.err ?? ((chunk: string) => process.stderr.write(chunk)),
    now: overrides.now ?? (() => new Date()),
  };
}

/** Resolves `--format` from the flag, defaulting loudly invalid values to an error upstream. */
export function resolveFormat(
  value: string | undefined,
  fallback: OutputFormat = "text",
): OutputFormat {
  return (value as OutputFormat | undefined) ?? fallback;
}
