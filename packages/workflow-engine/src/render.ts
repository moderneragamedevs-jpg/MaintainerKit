import type {
  AdvisoryFinding,
  Diagnostic,
  PolicyFinding,
  ReportEnvelope,
} from "@maintainerkit/core";

/**
 * Machine-friendly JSON. Always pass through redaction before writing this to disk or a log.
 */
export function renderJson(report: ReportEnvelope): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

const STATUS_MARKERS: Record<PolicyFinding["status"], string> = {
  pass: "PASS",
  fail: "FAIL",
  skip: "SKIP",
  error: "ERROR",
};

function severityTag(finding: PolicyFinding): string {
  return finding.status === "fail" || finding.status === "error"
    ? `[${STATUS_MARKERS[finding.status]} ${finding.severity}]`
    : `[${STATUS_MARKERS[finding.status]}]`;
}

function wrap(text: string, width = 88, indent = "    "): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) current = word;
    else if (`${current} ${word}`.length <= width) current = `${current} ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.map((line) => `${indent}${line}`);
}

/**
 * Plain-text report for terminals and CI logs.
 *
 * No colour, no emoji, no box drawing: identical output on every platform and in every log viewer,
 * and stable under `diff`. Callers may add colour around section headers if they want.
 */
export function renderText(report: ReportEnvelope, options: { verbose?: boolean } = {}): string {
  const lines: string[] = [];
  const title =
    report.kind === "audit" ? "MaintainerKit repository audit" : "MaintainerKit policy check";

  lines.push(title);
  lines.push("=".repeat(title.length));
  lines.push(`Subject:        ${report.subject.label}`);
  lines.push(`Repository:     ${formatRepository(report)}`);
  lines.push(`Policy version: ${report.policyVersion.specVersion ?? "none (audit)"}`);
  lines.push(`Tool:           ${report.tool.name} ${report.tool.version}`);
  lines.push(`Generated:      ${report.generatedAt}`);
  lines.push("");

  if (report.diagnostics.length > 0) {
    lines.push("Configuration notes");
    for (const diagnostic of report.diagnostics) {
      lines.push(
        `  ${diagnostic.severity} [${diagnostic.code}] ${diagnostic.path || "(root)"}: ${diagnostic.message}`,
      );
    }
    lines.push("");
  }

  const actionable = report.findings.filter(
    (finding) => finding.status === "fail" || finding.status === "error",
  );
  const others = report.findings.filter(
    (finding) => finding.status === "pass" || finding.status === "skip",
  );

  if (actionable.length > 0) {
    lines.push(`Findings requiring attention (${actionable.length})`);
    for (const finding of actionable) {
      lines.push(`  ${severityTag(finding)} ${finding.ruleId}  ${finding.message}`);
      for (const evidence of finding.evidence) {
        lines.push(`      ${evidence.label}: ${evidence.value}`);
      }
      if (finding.remediation) {
        // One wrapped line starting with `fix:` keeps the hint aligned with evidence and docs.
        lines.push(...wrap(`fix: ${finding.remediation}`, 88, "      "));
      }
      if (finding.docsUrl) lines.push(`      docs: ${finding.docsUrl}`);
    }
    lines.push("");
  }

  if (options.verbose || actionable.length === 0) {
    if (others.length > 0) {
      lines.push(`Other results (${others.length})`);
      for (const finding of others) {
        lines.push(`  ${severityTag(finding)} ${finding.ruleId}  ${finding.message}`);
        if (options.verbose) {
          for (const evidence of finding.evidence) {
            lines.push(`      ${evidence.label}: ${evidence.value}`);
          }
        }
      }
      lines.push("");
    }
  } else {
    const skipped = others.filter((finding) => finding.status === "skip").length;
    if (skipped > 0)
      lines.push(`(${skipped} check(s) skipped — run with --verbose to see why)`, "");
  }

  if (report.advisories.length > 0) {
    lines.push(`Advisory suggestions (${report.advisories.length}, not policy decisions)`);
    for (const advisory of report.advisories) {
      lines.push(
        `  [${advisory.capability}] ${advisory.title} (${advisory.provider}/${advisory.model})`,
      );
      lines.push(...wrap(advisory.summary, 84, "      "));
    }
    lines.push("");
  }

  lines.push(formatSummaryLine(report));
  return `${lines.join("\n")}\n`;
}

function formatRepository(report: ReportEnvelope): string {
  const { owner, name, provider, defaultBranch } = report.subject.repository;
  const identity = owner ? `${owner}/${name}` : name;
  return `${provider}:${identity}${defaultBranch ? `@${defaultBranch}` : ""}`;
}

export function formatSummaryLine(report: ReportEnvelope): string {
  const { summary } = report;
  const parts = [
    `${summary.pass} passed`,
    `${summary.fail} failed`,
    `${summary.skip} skipped`,
    ...(summary.error > 0 ? [`${summary.error} errored`] : []),
  ];
  const verdict = summary.status === "pass" ? "PASS" : "FAIL";
  return `Result: ${verdict} — ${parts.join(", ")}`;
}

/** Markdown for pull-request comments, issue bodies, and saved reports. */
export function renderMarkdown(report: ReportEnvelope): string {
  const lines: string[] = [];
  const heading =
    report.kind === "audit" ? "MaintainerKit repository audit" : "MaintainerKit policy check";
  lines.push(`## ${heading}`);
  lines.push("");
  lines.push(`- **Subject:** \`${report.subject.label}\``);
  lines.push(`- **Repository:** \`${formatRepository(report)}\``);
  lines.push(`- **Policy version:** \`${report.policyVersion.specVersion ?? "none (audit)"}\``);
  lines.push(`- **Result:** ${report.summary.status === "pass" ? "✅ pass" : "❌ fail"}`);
  lines.push(
    `- **Findings:** ${report.summary.pass} passed · ${report.summary.fail} failed · ${report.summary.skip} skipped${report.summary.error > 0 ? ` · ${report.summary.error} errored` : ""}`,
  );
  lines.push("");

  const failing = report.findings.filter(
    (finding) => finding.status === "fail" || finding.status === "error",
  );
  const passing = report.findings.filter(
    (finding) => finding.status !== "fail" && finding.status !== "error",
  );

  if (failing.length > 0) {
    lines.push("### Needs attention");
    lines.push("");
    lines.push("| Rule | Severity | Finding |");
    lines.push("| --- | --- | --- |");
    for (const finding of failing) {
      lines.push(
        `| \`${finding.ruleId}\` | ${finding.severity} | ${escapeCell(finding.message)} |`,
      );
    }
    lines.push("");
    for (const finding of failing) {
      lines.push(
        `<details><summary><code>${finding.ruleId}</code> — ${escapeHtml(finding.message)}</summary>`,
      );
      lines.push("");
      if (finding.evidence.length > 0) {
        lines.push("**Evidence**");
        lines.push("");
        for (const evidence of finding.evidence) {
          lines.push(`- ${evidence.label}: \`${escapeInline(String(evidence.value))}\``);
        }
        lines.push("");
      }
      if (finding.remediation) {
        // Remediation text is derived from repository content, so it is escaped like any other data.
        lines.push(`**Fix:** ${escapeHtml(finding.remediation)}`);
        lines.push("");
      }
      lines.push("</details>");
      lines.push("");
    }
  }

  if (passing.length > 0) {
    lines.push("### Passing and skipped checks");
    lines.push("");
    lines.push("| Rule | Status | Detail |");
    lines.push("| --- | --- | --- |");
    for (const finding of passing) {
      lines.push(`| \`${finding.ruleId}\` | ${finding.status} | ${escapeCell(finding.message)} |`);
    }
    lines.push("");
  }

  if (report.advisories.length > 0) {
    lines.push("### Advisory suggestions");
    lines.push("");
    lines.push("_Generated by an AI provider. Advisory only — these are not policy decisions._");
    lines.push("");
    for (const advisory of report.advisories) {
      lines.push(
        `- **${escapeHtml(advisory.title)}** (${escapeHtml(advisory.provider)}/${escapeHtml(advisory.model)}, \`${escapeHtml(advisory.capability)}\`)`,
      );
      lines.push(`  ${escapeHtml(advisory.summary)}`);
    }
    lines.push("");
  }

  if (report.diagnostics.length > 0) {
    lines.push("### Configuration notes");
    lines.push("");
    for (const diagnostic of report.diagnostics) {
      lines.push(`- \`${escapeHtml(diagnostic.code)}\` ${escapeHtml(diagnostic.message)}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(
    `<sub>${report.tool.name} ${report.tool.version} · policy ${report.policyVersion.specVersion ?? "none"} · ${report.generatedAt}</sub>`,
  );
  return `${lines.join("\n")}\n`;
}

function escapeCell(value: string): string {
  return escapeHtml(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function escapeHtml(value: string): string {
  return (
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // Backticks would break inline code spans; the message is inside one when used that way.
      .replace(/`/g, "'")
  );
}

function escapeInline(value: string): string {
  // Escape markup even inside code spans: some consumers reuse this text outside Markdown.
  return escapeHtml(value).replace(/\n/g, " ");
}

export interface CheckRunContent {
  title: string;
  summary: string;
  text: string;
  conclusion: "success" | "failure" | "neutral";
}

/**
 * Content for a GitHub check run. Kept short: check output is public, so it carries messages and
 * remedies only — never file contents, never tokens, never AI prompts.
 */
export function buildCheckRunContent(config: {
  name: string;
  report: ReportEnvelope;
  maxFindings?: number;
}): CheckRunContent {
  const { report } = config;
  const limit = config.maxFindings ?? 20;
  const failing = report.findings.filter(
    (finding) => finding.status === "fail" || finding.status === "error",
  );

  const title =
    report.summary.status === "pass"
      ? `${config.name}: all ${report.summary.pass} checks passed`
      : `${config.name}: ${failing.length} finding(s) need attention`;

  const summary = [
    `**${report.subject.label}**`,
    "",
    `${report.summary.pass} passed · ${report.summary.fail} failed · ${report.summary.skip} skipped`,
    "",
    failing.length === 0 ? "No action required." : "See details below.",
  ].join("\n");

  const text =
    failing.length === 0
      ? ""
      : [
          ...failing
            .slice(0, limit)
            .map((finding) =>
              [
                `### ${finding.ruleId} — ${finding.message}`,
                finding.remediation ? `> Fix: ${finding.remediation}` : "",
                finding.policyPath ? `> Policy: \`${finding.policyPath}\`` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            ),
          failing.length > limit ? `_${failing.length - limit} further finding(s) omitted._` : "",
        ]
          .filter(Boolean)
          .join("\n\n");

  return {
    title,
    summary,
    text,
    conclusion: report.summary.status === "pass" ? "success" : "failure",
  };
}

/** Summary used in audit events and console output. */
export function summarizeReport(report: ReportEnvelope): {
  status: "pass" | "fail";
  findings: number;
  failed: number;
  bySeverity: { info: number; warning: number; error: number };
} {
  return {
    status: report.summary.status,
    findings: report.summary.total,
    failed: report.summary.fail + report.summary.error,
    bySeverity: report.summary.bySeverity,
  };
}

/** Diagnostics are part of the report contract; this keeps their shape consistent across callers. */
export function diagnosticsSummary(diagnostics: readonly Diagnostic[]): string {
  return diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join("; ");
}

/** Advisories are rendered but never counted as policy outcomes. */
export function advisoryLabel(advisory: AdvisoryFinding): string {
  return `${advisory.capability} (${advisory.provider})`;
}
