# ADR-0001 — Project name, npm distribution, and the `maintainerkit` collision

- Status: **Accepted, with one open external step (scope registration)**
- Date: 2026-11-20

## Context

The product is specified as **MaintainerKit**. Before implementation we checked name availability
(live checks, 2026-11-20):

| Namespace                                    | Result                                                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| npm `maintainerkit`                          | **Taken** — `maintainerkit@0.1.4`, author `fishfillet-krm`, MIT, repo `github.com/fishfillet-krm/maintainerkit`, CLI with `commander`, description _"Prepare repositories for safe AI-assisted maintenance"_ |
| npm `maintainer-kit`                         | Free (404)                                                                                                                                                                                                   |
| npm `contribspec`                            | Free (404)                                                                                                                                                                                                   |
| npm `@maintainerkit/cli`                     | Free (404)                                                                                                                                                                                                   |
| GitHub `github.com/maintainerkit` (user/org) | Free (404)                                                                                                                                                                                                   |
| GitHub `github.com/maintainer-kit`           | Free (404)                                                                                                                                                                                                   |

The existing package is not a fork or predecessor; it is an independent project that overlaps in
problem space (AI-era repository maintenance prep). Installing `npm i -g maintainerkit` resolves to
that project, so publishing an unscoped CLI under that name is not possible.

## Decision

1. Keep the product name **MaintainerKit** (product identity, docs, repo).
2. Publish npm artifacts under the **`@maintainerkit/*` scope** (`@maintainerkit/cli`, `-core`,
   `-contribspec`, …). The CLI **binary** is named `maintainerkit`, which is legal and unambiguous
   (npm `bin` name ≠ package name).
3. Workspace packages use `@maintainerkit/*` from day one so no rename is needed later.
4. **No publication** happens without explicit human authorization. Registering the npm scope/org and
   the GitHub org are external actions requiring maintainer approval.
5. Until the scope is registered, everything is consumable from source (`pnpm build`, workspace links),
   and `npm publish` targets are documented but not executed.
6. Re-evaluate the name before the first public release. If the collision is judged harmful, the
   fallback is a distinct unscoped name (`maintainer-kit` is free) with the same package layout.

## Consequences

- `npm i -g @maintainerkit/cli` is the documented install. README states explicitly that the unscoped
  `maintainerkit` package on npm belongs to a different project, so users are not misled.
- Internal imports are stable regardless of the final distribution name.
- Badges/links in docs point to the workspace repo path, not to a claimed public org.

## Alternatives rejected

- **Rename now**: blocks implementation on a decision with no technical requirement, and loses the
  specified product name.
- **Publish unscoped**: impossible (name owned).
- **Claim `maintainer-kit` unscoped immediately**: legal, but creates two identities; keep as fallback.
