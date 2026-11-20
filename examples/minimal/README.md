# Minimal example

A tiny repository used to demonstrate a MaintainerKit policy check.

It exists so that the `examples/minimal/maintainerkit.yml` document can be validated and evaluated in
tests and documentation without inventing a realistic project. Running the auditor against this directory
is a quick way to see the report format: the README is intentionally short, so `MK-AUD-001` will fail.

## Usage

```bash
node packages/interfaces/cli/dist/bin.js validate examples/minimal
node packages/interfaces/cli/dist/bin.js check --path examples/minimal
node packages/interfaces/cli/dist/bin.js audit --path examples/minimal
```
