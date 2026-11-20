import { Command, CommanderError } from "commander";
import { TOOL_VERSION, describeError, isMaintainerKitError, ExitCode } from "@maintainerkit/core";
import type { CliContext } from "./context.js";
import { runInit } from "./commands/init.js";
import { runValidate } from "./commands/validate.js";
import { runDoctor } from "./commands/doctor.js";
import { runAuditCommand } from "./commands/audit.js";
import { runCheckCommand } from "./commands/check.js";
import { runReportCommand } from "./commands/report.js";
import { runExplainCommand } from "./commands/explain.js";

const DESCRIPTION = [
  "Open-source repository governance and maintenance platform.",
  "",
  "ContribSpec policy documents are validated and evaluated deterministically; AI is optional,",
  "advisory, and never changes a policy result.",
].join("\n");

const EXAMPLES = `
Examples:
  $ maintainerkit init                       Create maintainerkit.yml and a read-only CI workflow
  $ maintainerkit validate                   Validate the policy document
  $ maintainerkit doctor                     Check the local environment
  $ maintainerkit audit                      Audit the current repository (no config needed)
  $ maintainerkit check --path .             Evaluate repository policies locally
  $ maintainerkit check --repo acme/widget --pr 42
                                             Evaluate pull-request policies on GitHub
  $ maintainerkit check --format json --output report.json
  $ maintainerkit report --input report.json --format markdown
  $ maintainerkit explain --rule MK-PR-001   Explain a rule
  $ maintainerkit explain exit-codes         Explain exit codes

Exit codes: 0 success · 1 policy failure · 2 usage/configuration error · 3 execution error
Documentation: docs/ in the MaintainerKit repository.
`;

export interface RunResult {
  exitCode: number;
}

/**
 * Builds the commander program.
 *
 * The program never calls `process.exit`: it returns an exit code, so tests can run commands in-process
 * and embedding applications keep control of their own process.
 */
export function createProgram(
  context: CliContext,
  onExitCode: (code: number) => void = () => {},
): Command {
  const program = new Command();

  program
    .name("maintainerkit")
    .description(DESCRIPTION)
    .version(TOOL_VERSION, "-v, --version", "Print the MaintainerKit version and exit")
    .addHelpText("after", EXAMPLES)
    .showSuggestionAfterError(true)
    .showHelpAfterError(true)
    .configureOutput({
      writeOut: (chunk: string) => context.out(chunk),
      writeErr: (chunk: string) => context.err(chunk),
    })
    .exitOverride();

  program
    .command("init")
    .description("Create a ContribSpec document and a read-only GitHub Actions workflow")
    .argument("[directory]", "directory to initialise", ".")
    .option("--config <file>", "config file name to create", "maintainerkit.yml")
    .option("--force", "overwrite existing files", false)
    .option("--strict", "enable the stricter policy defaults", false)
    .option("--no-workflow", "skip creating .github/workflows/maintainerkit.yml")
    .action(
      async (
        directory: string,
        options: { config?: string; force?: boolean; strict?: boolean; workflow?: boolean },
      ) => {
        onExitCode(
          await runInit(context, {
            directory,
            ...(options.config ? { config: options.config } : {}),
            force: options.force === true,
            strict: options.strict === true,
            workflow: options.workflow !== false,
          }),
        );
      },
    );

  program
    .command("validate")
    .description("Validate a ContribSpec document (schema, semantics, and rule references)")
    .argument("[path]", "file or directory containing the policy document")
    .option("--config <file>", "explicit path to the policy document")
    .option("--json", "machine-readable output", false)
    .action(async (path: string | undefined, options: { config?: string; json?: boolean }) => {
      onExitCode(
        await runValidate(context, {
          ...(path ? { path } : {}),
          ...(options.config ? { config: options.config } : {}),
          json: options.json === true,
        }),
      );
    });

  program
    .command("doctor")
    .description("Check the environment: runtime, configuration, git, token, AI, write gate")
    .option("--json", "machine-readable output", false)
    .option("--repo <owner/name>", "also verify GitHub connectivity for this repository")
    .option("--offline", "never make network calls", false)
    .action(async (options: { json?: boolean; repo?: string; offline?: boolean }) => {
      onExitCode(
        await runDoctor(context, {
          json: options.json === true,
          ...(options.repo ? { repo: options.repo } : {}),
          offline: options.offline === true,
        }),
      );
    });

  program
    .command("audit")
    .description("Audit repository health with documented checks (works without a policy document)")
    .option("--path <directory>", "local repository path", ".")
    .option("--repo <owner/name>", "audit a GitHub repository instead of a local path")
    .option("--ref <ref>", "branch or ref to read from GitHub")
    .option("--format <format>", "text | json | markdown", "text")
    .option("--output <file>", "also write the report to a file")
    .option("--audit-log <file>", "append structured audit events to a JSONL file")
    .option("--verbose", "show passing and skipped checks in full", false)
    .option("--json", "shorthand for --format json", false)
    .action(async (options: Record<string, string | boolean | undefined>) => {
      onExitCode(
        await runAuditCommand(context, {
          path: typeof options.path === "string" ? options.path : undefined,
          ...(typeof options.repo === "string" ? { repo: options.repo } : {}),
          ...(typeof options.ref === "string" ? { ref: options.ref } : {}),
          ...(typeof options.format === "string" ? { format: options.format } : {}),
          ...(typeof options.output === "string" ? { output: options.output } : {}),
          ...(typeof options.auditLog === "string" ? { auditLog: options.auditLog } : {}),
          verbose: options.verbose === true,
          json: options.json === true,
        }),
      );
    });

  program
    .command("check")
    .description("Evaluate ContribSpec policies for a repository or pull request")
    .option("--path <directory>", "local repository path", ".")
    .option("--repo <owner/name>", "evaluate a GitHub repository or pull request")
    .option("--ref <ref>", "branch or ref to read from GitHub")
    .option("--pr <number>", "pull request number (requires --repo)", (value: string) =>
      Number.parseInt(value, 10),
    )
    .option("--config <file>", "explicit path to the policy document")
    .option("--format <format>", "text | json | markdown", "text")
    .option("--output <file>", "also write the report to a file")
    .option("--audit-log <file>", "append structured audit events to a JSONL file")
    .option("--fail-on <severity>", "info | warning | error (default: error)")
    .option("--dry-run", "report only; never attempt a write operation", false)
    .option("--verbose", "show passing and skipped checks in full", false)
    .option("--ai", "enable AI advisories for this run", false)
    .option("--provider <id>", "AI provider: mock | openai-compatible | anthropic | ollama")
    .option("--model <name>", "AI model name")
    .option("--ai-timeout <seconds>", "per-request AI timeout in seconds", (value: string) =>
      Number.parseInt(value, 10),
    )
    .option("--json", "shorthand for --format json", false)
    .action(async (options: Record<string, string | number | boolean | undefined>) => {
      onExitCode(
        await runCheckCommand(context, {
          path: typeof options.path === "string" ? options.path : undefined,
          ...(typeof options.repo === "string" ? { repo: options.repo } : {}),
          ...(typeof options.ref === "string" ? { ref: options.ref } : {}),
          ...(typeof options.pr === "number" && Number.isInteger(options.pr)
            ? { pr: options.pr }
            : {}),
          ...(typeof options.config === "string" ? { config: options.config } : {}),
          ...(typeof options.format === "string" ? { format: options.format } : {}),
          ...(typeof options.output === "string" ? { output: options.output } : {}),
          ...(typeof options.auditLog === "string" ? { auditLog: options.auditLog } : {}),
          ...(typeof options.failOn === "string" ? { failOn: options.failOn } : {}),
          ...(typeof options.provider === "string" ? { provider: options.provider } : {}),
          ...(typeof options.model === "string" ? { model: options.model } : {}),
          ...(typeof options.aiTimeout === "number" ? { aiTimeout: options.aiTimeout } : {}),
          dryRun: options.dryRun === true,
          verbose: options.verbose === true,
          ai: options.ai === true,
          json: options.json === true,
        }),
      );
    });

  program
    .command("report")
    .description("Re-render a saved report, or print an audit trail")
    .option("--input <file>", "report JSON produced by check/audit --format json")
    .option("--audit-log <file>", "JSONL audit trail to summarise")
    .option("--format <format>", "text | json | markdown", "text")
    .option("--output <file>", "also write the rendered report to a file")
    .option("--verbose", "include evidence for passing checks", false)
    .option("--json", "shorthand for --format json", false)
    .action(async (options: Record<string, string | boolean | undefined>) => {
      onExitCode(
        await runReportCommand(context, {
          ...(typeof options.input === "string" ? { input: options.input } : {}),
          ...(typeof options.auditLog === "string" ? { auditLog: options.auditLog } : {}),
          ...(typeof options.format === "string" ? { format: options.format } : {}),
          ...(typeof options.output === "string" ? { output: options.output } : {}),
          verbose: options.verbose === true,
          json: options.json === true,
        }),
      );
    });

  program
    .command("explain")
    .description(
      "Explain a rule, a finding, exit codes, the report format, AI, or the security model",
    )
    .argument("[topic]", "exit-codes | reports | ai | security")
    .option("--rule <id>", "explain one rule, e.g. MK-PR-001")
    .option("--input <file>", "report JSON containing the finding")
    .option("--finding <id>", "explain one finding from --input")
    .action(
      async (
        topic: string | undefined,
        options: { rule?: string; input?: string; finding?: string },
      ) => {
        onExitCode(
          await runExplainCommand(context, {
            ...(topic ? { topic } : {}),
            ...(options.rule ? { rule: options.rule } : {}),
            ...(options.input ? { input: options.input } : {}),
            ...(options.finding ? { finding: options.finding } : {}),
          }),
        );
      },
    );

  program
    .command("help", { isDefault: false })
    .description("Print help for a command")
    .argument("[command]")
    .action((commandName?: string) => {
      const target = commandName
        ? program.commands.find((command) => command.name() === commandName)
        : program;
      (target ?? program).outputHelp();
    });

  return program;
}

/** Runs the CLI for the given argv and returns the exit code. Never throws for expected failures. */
export async function runCli(argv: string[], context: CliContext): Promise<RunResult> {
  let exitCode: number = ExitCode.Success;
  const program = createProgram(context, (code) => {
    exitCode = code;
  });

  try {
    await program.parseAsync(argv, { from: "user" });
    return { exitCode };
  } catch (error) {
    if (error instanceof CommanderError) {
      // Help and version are successful exits, not failures.
      if (
        error.code === "commander.help" ||
        error.code === "commander.helpDisplayed" ||
        error.code === "commander.version"
      ) {
        return { exitCode: ExitCode.Success };
      }
      if (error.code === "commander.unknownCommand" || error.code.startsWith("commander.")) {
        return { exitCode: ExitCode.UsageError };
      }
    }

    if (isMaintainerKitError(error)) {
      context.err(`error: ${error.message}\n`);
      if (error.hint) context.err(`hint: ${error.hint}\n`);
      return { exitCode: error.exitCode };
    }

    const described = describeError(error);
    context.err(`error: ${described.message}\n`);
    if (described.hint) context.err(`hint: ${described.hint}\n`);
    return { exitCode: ExitCode.ExecutionError };
  }
}
