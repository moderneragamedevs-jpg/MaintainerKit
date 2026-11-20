// Generates the TypeScript copy of the ContribSpec schema and the published copy in /schemas.
//
// Why embed the schema instead of reading it at runtime: the CLI and the GitHub Action are bundled,
// and a bundle has no reliable relative path to a JSON asset. One source of truth (the JSON file),
// three artifacts: the JSON under /schemas, the TS module, and the compiled package.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const repoRoot = join(packageRoot, "..", "..");

const jsonPath = join(packageRoot, "src", "schema", "contribspec-1.0.schema.json");
const source = await readFile(jsonPath, "utf8");
const parsed = JSON.parse(source);

const banner = [
  "// AUTO-GENERATED from src/schema/contribspec-1.0.schema.json — do not edit by hand.",
  "// Regenerate with: node packages/contribspec/scripts/generate-schema.mjs",
  "",
].join("\n");

await writeFile(
  join(packageRoot, "src", "schema.generated.ts"),
  `${banner}export const CONTRIBSPEC_1_0_SCHEMA = ${JSON.stringify(parsed, null, 2)} as const;\n`,
  "utf8",
);

await mkdir(join(repoRoot, "schemas"), { recursive: true });
await writeFile(
  join(repoRoot, "schemas", "contribspec-1.0.schema.json"),
  `${JSON.stringify(parsed, null, 2)}\n`,
  "utf8",
);

console.log(
  "contribspec: generated src/schema.generated.ts and schemas/contribspec-1.0.schema.json",
);
