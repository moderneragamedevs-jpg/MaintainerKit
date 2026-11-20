// Bundles the Action into a single file.
//
// GitHub Actions runs `main` from the repository checkout, so every dependency must be present in the
// bundle: there is no `npm install` before the entrypoint runs. The schema is embedded as TypeScript
// (see packages/contribspec/scripts/generate-schema.mjs), so no JSON asset needs copying.
//
// The output is CommonJS with a `.cjs` extension. The workspace is ESM (`"type": "module"`), but some
// dependencies still call `require()` for Node built-ins, which an ESM bundle cannot satisfy. A `.cjs`
// file is unambiguous for the runner and avoids interop shims.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");

await build({
  entryPoints: [join(packageRoot, "src", "main.ts")],
  outfile: join(packageRoot, "dist", "index.cjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: false,
  minify: false,
  // Keep this readable: the bundle ships in the repository and reviewers should be able to diff it.
  banner: {
    js: "// Bundled MaintainerKit GitHub Action. Source: packages/interfaces/github-action/src",
  },
  logLevel: "warning",
});

console.log("github-action: bundled dist/index.cjs");
