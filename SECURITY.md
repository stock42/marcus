# Security policy

## Supported versions

Security fixes are applied to the current `0.1.x` release line. Until Marcus
reaches a stable release, operators should deploy the latest published patch.

## Reporting a vulnerability

Do not disclose a vulnerability, exploit, credential, production URL or user
data in a public issue. Use GitHub's private vulnerability reporting flow:

https://github.com/stock42/marcus/security/advisories/new

Include the affected version or commit, impact, reproduction steps and any
mitigations already tested. Maintainers will coordinate validation, a fix and
responsible disclosure through the private advisory.

If private vulnerability reporting is unavailable, do not open a public issue
with sensitive details; contact the repository owner through the private
channel shown in the GitHub organization profile.

## Secrets

Never commit API keys, passwords, bearer tokens, cookies, private keys, Marcus
data directories, SQLite databases or populated `.env` files. Immediately
revoke a credential if it was exposed; rewriting Git history does not make an
already copied credential safe again.
