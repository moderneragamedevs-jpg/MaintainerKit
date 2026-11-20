import { runAction, parseActionInputs } from "./action.js";

/**
 * Action entrypoint.
 *
 * Kept tiny on purpose: everything testable lives in `runAction`. This file only bridges GitHub's
 * environment contract (INPUT_* variables, step summary file, exit codes).
 *
 * The bundle is CommonJS (see scripts/bundle.mjs), so there is no top-level await here.
 */
async function main(): Promise<void> {
  const inputs = parseActionInputs(process.env);
  const result = await runAction(inputs, { env: process.env });
  process.exitCode = result.exitCode;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`fatal: ${message}`);
  process.exitCode = 3;
});
