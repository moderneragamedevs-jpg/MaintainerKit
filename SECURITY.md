# Security Policy

## Supported versions

MaintainerKit is pre-release (`0.x`). Security fixes are applied to the latest published minor
version only. Once `1.0` ships, the two most recent minors will be supported.

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |
| < 0.1 | No |

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting for this repository ("Security" tab → "Report a
vulnerability"). If that is unavailable, contact the maintainers listed in
[GOVERNANCE.md](GOVERNANCE.md) through a private channel.

Please include:

- affected version or commit,
- the smallest reproduction you can manage,
- the impact you believe it has (secret disclosure, forged policy result, unauthorized write, denial of
  service),
- whether the issue is already public.

We aim to acknowledge within 3 business days and to agree on a disclosure date with you. Credit is
given in the advisory unless you prefer otherwise.

## Scope

In scope:

- secret disclosure through logs, reports, audit trails, or check runs,
- any path that performs a repository write without the documented gate,
- forged or silently incorrect policy results (a finding that should fail but passes),
- remote code execution or command injection through repository content or configuration,
- prompt-injection paths that change output beyond an advisory,
- dependency vulnerabilities introduced by this project.

Out of scope:

- findings that require a maintainer to enable a write operation and set `MAINTAINERKIT_ALLOW_WRITE=true`,
- vulnerabilities in third-party services (GitHub, model providers) — report those upstream,
- AI output that is simply wrong or unhelpful (that is expected; it is advisory),
- reports produced from local files you control that contain your own secrets.

## Security model

The threat model, trust boundaries, and per-threat mitigations are documented in
[docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md). Read that before testing; it states what the project
does and does not guarantee.

## What we never do

- Execute code from a pull request.
- Merge, close, label, or comment automatically.
- Print, store, or transmit tokens or API keys.
- Let an AI provider influence a policy verdict, exit code, or check conclusion.
