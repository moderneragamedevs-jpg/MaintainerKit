// SDK example: evaluate a repository and render the report.
//
// Run after building the workspace:
//   corepack pnpm build
//   node examples/sdk/check.mjs examples/minimal
//
// The SDK produces exactly the same report as the CLI and the Action.
import { createMaintainerKit } from "@maintainerkit/sdk";

const target = process.argv[2] ?? process.cwd();

const maintainerkit = await createMaintainerKit({ cwd: target });
console.log(`Policy ${maintainerkit.policyVersion} from ${maintainerkit.configPath}`);

const report = await maintainerkit.check();
process.stdout.write(maintainerkit.render(report, "text"));

const audit = await maintainerkit.audit();
console.log(
  `Audit: ${audit.summary.status} (${audit.summary.pass} passed, ${audit.summary.fail} failed)`,
);

process.exitCode = report.summary.status === "pass" ? 0 : 1;
