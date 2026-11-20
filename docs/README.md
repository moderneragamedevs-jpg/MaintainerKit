# Documentation

Start here, then follow the link for the job you are doing.

| I want to…                                 | Read                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| Understand what this project is and is not | [PRODUCT_SPEC.md](PRODUCT_SPEC.md)                                      |
| Install it and run a first check           | [README.md](../README.md)                                               |
| Write a policy document                    | [CONTRIBSPEC.md](CONTRIBSPEC.md), then [examples/](../examples)         |
| Know exactly what a rule checks            | [POLICY_RULES.md](POLICY_RULES.md)                                      |
| Understand the audit checks                | [AUDIT_CHECKS.md](AUDIT_CHECKS.md)                                      |
| Use the CLI                                | [CLI.md](CLI.md)                                                        |
| Consume a report in another tool           | [REPORTS.md](REPORTS.md)                                                |
| Set up the GitHub Action                   | [GITHUB_INTEGRATION.md](GITHUB_INTEGRATION.md)                          |
| Enable AI advisories                       | [AI.md](AI.md)                                                          |
| Understand the security boundaries         | [SECURITY_MODEL.md](SECURITY_MODEL.md)                                  |
| Contribute code                            | [DEVELOPMENT.md](DEVELOPMENT.md), [CONTRIBUTING.md](../CONTRIBUTING.md) |
| See how the system is put together         | [ARCHITECTURE.md](ARCHITECTURE.md), [adr/](adr/README.md)               |
| Know what is planned                       | [ROADMAP.md](ROADMAP.md)                                                |

## Conventions used in these documents

- **Rule ids** are `MK-<AREA>-NNN`: `REPO`, `SEC`, `PR`, `REL`. Audit ids are `MK-AUD-NNN`.
- **`skip`** always means "cannot be determined here". It is never a pass and never counted as one.
- **Advisory** means AI output. It is not a finding and cannot change a verdict.
- Exit codes: `0` pass, `1` policy failure, `2` usage/config error, `3` execution error.

## Documentation rules for contributors

1. Document the behaviour that ships. If a feature is planned, it belongs in
   [../ROADMAP.md](../ROADMAP.md), not in a how-to guide.
2. Do not claim an industry standard, adoption, or a benchmark result that does not exist.
3. Every rule and check section states what it observes, what makes it pass, what makes it skip, and how
   to fix a failure.
4. A command shown in a document must run as written.
