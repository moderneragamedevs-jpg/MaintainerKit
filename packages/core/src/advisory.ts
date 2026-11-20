import type { AdvisoryFinding } from "./report.js";
import type { Diagnostic } from "./diagnostics.js";
import type { PolicySubject } from "./snapshot.js";

/**
 * The advisory seam.
 *
 * Declared in `core` (not in an AI package) so the workflow layer can accept suggestions without
 * depending on any AI implementation, and so a third party can supply advisories from a completely
 * different source.
 */
/**
 * The subset of a resolved policy document an advisor may read.
 *
 * Structural on purpose: `core` must not depend on `contribspec` (the dependency would be circular),
 * and a ResolvedConfig satisfies this shape without conversion.
 */
export interface AdvisorConfigView {
  specVersion: string;
  ai: { provider?: string; model?: string; capabilities: readonly string[] };
}

export interface AdvisorOutcome {
  advisories: AdvisoryFinding[];
  diagnostics?: Diagnostic[];
}

export type Advisor = (input: {
  subject: PolicySubject;
  config: AdvisorConfigView;
}) => Promise<AdvisorOutcome>;
