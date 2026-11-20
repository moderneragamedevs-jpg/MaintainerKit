import type { ReportEnvelope, RepositorySource } from "@maintainerkit/core";
import { loadValidContribSpec, type ResolvedConfig } from "@maintainerkit/contribspec";
import {
  runAudit,
  runCheck,
  renderJson,
  renderMarkdown,
  renderText,
  type Advisor,
} from "@maintainerkit/workflow-engine";
import { createLocalRepository } from "@maintainerkit/git-integration";

export interface MaintainerKitOptions {
  /** Working directory used to find the policy document, when `configPath` is not given. */
  cwd?: string;
  configPath?: string;
  /** Provider used for checks. Defaults to the local working tree. */
  source?: RepositorySource;
  /** Optional advisory provider (see `@maintainerkit/ai-core`). */
  advisor?: Advisor;
  now?: () => Date;
}

export interface CheckOptions {
  pullRequestNumber?: number;
  failOn?: "info" | "warning" | "error";
  dryRun?: boolean;
}

/**
 * SDK facade.
 *
 * Intended for tools that want MaintainerKit's guarantees without shelling out to the CLI. The facade
 * only orchestrates; every guarantee (determinism, redaction, provider neutrality) lives in the
 * packages it composes, so SDK users get exactly the same results as CI.
 */
export class MaintainerKit {
  readonly config: ResolvedConfig;
  readonly configPath: string;
  readonly policyVersion: string;
  readonly checksum: string;
  readonly #source: RepositorySource;
  readonly #advisor?: Advisor;
  readonly #now: () => Date;

  private constructor(input: {
    config: ResolvedConfig;
    configPath: string;
    checksum: string;
    source: RepositorySource;
    advisor?: Advisor;
    now: () => Date;
  }) {
    this.config = input.config;
    this.configPath = input.configPath;
    this.policyVersion = input.config.specVersion;
    this.checksum = input.checksum;
    this.#source = input.source;
    this.#advisor = input.advisor;
    this.#now = input.now;
  }

  static async create(options: MaintainerKitOptions = {}): Promise<MaintainerKit> {
    const cwd = options.cwd ?? process.cwd();
    const loaded = await loadValidContribSpec(options.configPath ?? cwd, { cwd });
    const source = options.source ?? (await createLocalRepository({ root: cwd }));

    return new MaintainerKit({
      config: loaded.resolved,
      configPath: loaded.path,
      checksum: loaded.checksum,
      source,
      ...(options.advisor ? { advisor: options.advisor } : {}),
      now: options.now ?? (() => new Date()),
    });
  }

  /** Evaluates policies. Returns the same report contract the CLI and Action produce. */
  async check(options: CheckOptions = {}): Promise<ReportEnvelope> {
    const { report } = await runCheck({
      source: this.#source,
      config: this.config,
      now: this.#now(),
      ...(options.pullRequestNumber === undefined
        ? {}
        : { pullRequestNumber: options.pullRequestNumber }),
      ...(options.failOn ? { failOn: options.failOn } : {}),
      dryRun: options.dryRun ?? false,
      ...(this.#advisor ? { advisor: this.#advisor } : {}),
    });
    return report;
  }

  /** Repository health audit. Independent of the policy document. */
  async audit(): Promise<ReportEnvelope> {
    const { report } = await runAudit({ source: this.#source, now: this.#now() });
    return report;
  }

  /** Renders a report in any supported format. */
  render(report: ReportEnvelope, format: "text" | "json" | "markdown" = "text"): string {
    if (format === "json") return renderJson(report);
    if (format === "markdown") return renderMarkdown(report);
    return renderText(report);
  }
}

export async function createMaintainerKit(
  options: MaintainerKitOptions = {},
): Promise<MaintainerKit> {
  return MaintainerKit.create(options);
}

/* ------------------------------------------------------------------------------------------------
 * Re-exports: the supported surface for building on top of MaintainerKit.
 * ---------------------------------------------------------------------------------------------- */

export * from "@maintainerkit/core";
export {
  loadContribSpec,
  loadValidContribSpec,
  validateContribSpecDocument,
  validateContribSpecSource,
  resolveConfig,
  checkSpecVersion,
  migrateDocument,
  CONTRIBSPEC_VERSION,
  CONTRIBSPEC_1_0_SCHEMA,
  type ContribSpecDocument,
  type ResolvedConfig,
} from "@maintainerkit/contribspec";
export {
  BUILT_IN_RULES as builtInRules,
  PolicyRegistry,
  evaluatePolicy,
  explainRule,
  listRules,
  type RuleDefinition,
  type RuleContext,
  type RuleResult,
  type EvaluationReport,
} from "@maintainerkit/policy-engine";
export {
  auditRepository,
  AUDIT_CHECKS,
  redact,
  redactSecrets,
  redactDeep,
  createAuditEvent,
  JsonlAuditSink,
  MemoryAuditSink,
  type AuditEvent,
  type AuditSink,
  type AuditCheck,
  type RepositoryAuditResult,
} from "@maintainerkit/audit";
export {
  runCheck,
  runAudit,
  renderJson,
  renderMarkdown,
  renderText,
  buildCheckRunContent,
} from "@maintainerkit/workflow-engine";
export { LocalRepository, createLocalRepository } from "@maintainerkit/git-integration";
