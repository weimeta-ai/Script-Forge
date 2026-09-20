# Security policy

## Do not commit secrets

Never commit any of the following to this repository:

- API keys, access tokens, JWT secrets, private keys or certificates;
- database, Redis, object-storage or SMTP connection strings containing credentials;
- `.env`, `.env.production`, database backups, production logs or uploaded scripts;
- real user data, unpublished scripts, reports, screenshots or screen recordings.

Use `backend/.env.example` as a template and inject real values through a local
ignored `.env` file or your deployment platform's secret manager.

## If a secret was exposed

1. Revoke or rotate the secret immediately at the provider.
2. Remove it from the working tree and check Git history; deleting the latest file
   is not enough because old commits remain accessible.
3. Check logs, CI output and deployment configuration for copied values.
4. Report the issue privately to the maintainers instead of opening a public issue.

For private reports, contact the project maintainers through the contact channel
listed in the README. Do not include the secret itself in the report.
