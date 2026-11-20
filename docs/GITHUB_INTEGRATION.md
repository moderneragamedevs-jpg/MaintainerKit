# GitHub integration

MaintainerKit reads from GitHub through Octokit and can publish one thing: a check run. Everything else
is read-only by construction — the adapter class has no mutating methods, and the write client is a
separate type that only exposes `createCheckRun`.

## Permissions

Request the minimum; each row is what the corresponding feature needs.

| Feature                                       | Token permissions                                             | Notes                                                                     |
| --------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Repository files and metadata                 | `contents: read`                                              | Works with the default `GITHUB_TOKEN` on public repos                     |
| Pull request metadata, commits, changed files | `pull-requests: read`                                         | Included in `contents: read` for public repositories on GitHub.com        |
| Check runs (read)                             | `checks: read`                                                | Required by `MK-PR-003`                                                   |
| Branch protection, vulnerability alerts       | `administration: read` _or_ a token with repo security access | Without it, the checks report `skip`, never a guessed pass                |
| Publish a check run                           | `checks: write`                                               | Only with `publish-checks: true` **and** `MAINTAINERKIT_ALLOW_WRITE=true` |

The reference workflow asks for `contents: read` only. A write-enabled workflow must be a separate file
(see `.github/workflows/maintainerkit-check-run.yml`).

## Authentication

```bash
export GITHUB_TOKEN=...           # or GH_TOKEN
maintainerkit check --repo acme/widget --pr 42
```

The token is never printed, logged, or placed in a report. Errors from GitHub are mapped to typed
MaintainerKit errors:

| Status                           | Code                           | Behaviour                                        |
| -------------------------------- | ------------------------------ | ------------------------------------------------ |
| 401                              | `github/authentication-failed` | Exit 3, with a hint about the token              |
| 403 + `x-ratelimit-remaining: 0` | `github/rate-limited`          | Exit 3, includes the reset time                  |
| 403                              | `github/forbidden`             | Exit 3, points at the permission table           |
| 404 on branch protection         | —                              | Recorded as "not protected" (only when readable) |
| 403 on branch protection         | —                              | Posture `unknown` → rules `skip`                 |
| 5xx                              | `github/server-error`          | Exit 3, documented as transient                  |

A token without the security scopes does **not** fail the run: the affected checks skip with a reason.

## Fork pull requests

The adapter compares `head.repo.full_name` with `base.repo.full_name` and marks `isFork`. A fork whose
head repository was deleted counts as a fork.

What this means:

- The workflow runs on `pull_request`, so the token is read-only for fork PRs regardless of the workflow's
  `permissions` block.
- No code from the head ref is fetched, built, or executed — analysis reads API metadata only.
- The audit event records `fork: true`.
- No secret is required, so fork runs work on public repositories without configuration.

## Publishing a check run

```yaml
permissions:
  contents: read
  checks: write

env:
  MAINTAINERKIT_ALLOW_WRITE: "true"

steps:
  - uses: actions/checkout@v4
    with: { persist-credentials: false }
  - uses: ./
    with:
      publish-checks: "true"
```

- The gate is closed unless `MAINTAINERKIT_ALLOW_WRITE` is exactly `true` or `1`.
- Without `checks: write`, publishing logs a warning and the policy result is still reported; the run does
  not fail on permissions.
- The check content is short and public: messages, rule ids, and remediation — never file contents,
  tokens, prompts, or raw model output.

## What is read

| Data                                      | Endpoint                                                 |
| ----------------------------------------- | -------------------------------------------------------- |
| Repository metadata and security settings | `GET /repos/{owner}/{repo}`                              |
| File list (recursive tree)                | `GET /repos/{owner}/{repo}/git/trees/{ref}`              |
| File contents (bounded to 256 KiB)        | `GET /repos/{owner}/{repo}/contents/{path}`              |
| Pull request                              | `GET /repos/{owner}/{repo}/pulls/{number}`               |
| Commits (with verification)               | `GET /repos/{owner}/{repo}/pulls/{number}/commits`       |
| Check runs for the head SHA               | `GET /repos/{owner}/{repo}/commits/{sha}/check-runs`     |
| Changed files (≤300)                      | `GET /repos/{owner}/{repo}/pulls/{number}/files`         |
| Branch protection                         | `GET /repos/{owner}/{repo}/branches/{branch}/protection` |
| Vulnerability alerts                      | `GET /repos/{owner}/{repo}/vulnerability-alerts`         |

All requests use a 15s timeout and a `maintainerkit/0.1.0` user agent.

## Rate limits

Unauthenticated requests are impractical; use a token. On exhaustion the CLI exits 3 with the reset time
rather than retrying blindly. The Action inherits the token's limit — GitHub-hosted runners are normally
well inside it for one repository.

## GitHub Enterprise Server

Set `GITHUB_API_URL` for the Action (handled automatically) or pass a base URL through the client factory.
The integration uses the REST API only; no GraphQL, no App installation.

## Testing without network access

`GitHubRepositorySource.create({ owner, repo, client })` accepts any object implementing
`GitHubApiClient`. The test suite uses in-memory fakes for every endpoint, which is why the GitHub path is
covered without nock, without fixtures on disk, and without network flakiness. See
`packages/integrations/github/test/github.test.ts`.
