# Cloudflare Manual Deployment Guide

Use this path for advanced first installation, custom configuration, troubleshooting, or emergency recovery. Most users should start with [Deploy to Cloudflare](deploy-cloudflare-button.md). An AI assistant must follow the [AI Agent deployment contract](agent-deploy-cloudflare.md), which invokes the same commands documented here.

All entry points share one deployment core:

```text
build:cloudflare -> db:migrate:remote -> deploy:worker -> deploy:verify
```

The manual entrypoint adds local configuration checks before that pipeline. Routine updates are handled by Cloudflare Workers Builds rather than a local machine.

## Automated CLI Setup

1. Create a GitHub repository from [tianma-if/edgeever](https://github.com/tianma-if/edgeever), then clone it:

   ```sh
   git clone <your repository URL>
   cd edgeever
   ```

2. Install Node.js 22 or newer and Bun. Wrangler is included in the project and does not need a global installation.

3. Install dependencies and initialize the Cloudflare resources:

   ```sh
   cp .env.local.example .env.local
   bun install
   bun run deploy:setup
   bun run deploy:doctor
   bun run deploy:manual
   ```

   The template uses `admin` / `admin123` for the initial login. To choose a password during setup, run this instead of the plain setup command:

   ```sh
   EDGE_EVER_PASSWORD='<your password>' bun run deploy:setup
   ```

`deploy:setup` uses the project-local Wrangler, starts `wrangler login` when authorization is missing, creates D1 and dedicated production/preview Workers KV namespaces, and writes the resulting non-secret configuration to the git-ignored `.env.local`. It stops on an unconfirmed same-name resource instead of reusing unknown data. `deploy:manual` runs the doctor, production build, common deployment pipeline, and remote verification.

## Creating Resources Manually

If you do not want `deploy:setup` to create resources, run:

```sh
cp .env.local.example .env.local
bun install
bunx wrangler d1 create edgeever
bunx wrangler kv namespace create edgeever-resources
bunx wrangler kv namespace create edgeever-resources-preview
```

Copy the returned D1 ID and the resource names into `.env.local`:

```text
EDGE_EVER_D1_DATABASE_ID=<database_id>
EDGE_EVER_KV_NAMESPACE_NAME=edgeever-resources
EDGE_EVER_KV_NAMESPACE_ID=<namespace_id>
EDGE_EVER_KV_PREVIEW_NAMESPACE_NAME=edgeever-resources-preview
EDGE_EVER_KV_PREVIEW_NAMESPACE_ID=<preview_namespace_id>
EDGE_EVER_RESOURCE_STORAGE_LIMIT_BYTES=786432000
EDGE_EVER_WORKERS_FREE_CONFIRMED=true
EDGE_EVER_AUTH_USERNAME=admin
EDGE_EVER_AUTH_PASSWORD=<strong password>
EDGE_EVER_SESSION_TTL_DAYS=400
```

Then run:

```sh
bun run deploy:doctor
bun run deploy:manual
```

`.env.local` is read only by local EdgeEver scripts. Never upload it, commit it, or copy it into a Cloudflare build as a file. The standard `bun run deploy` command is reserved for Cloudflare's one-click non-interactive entrypoint; local and Agent deployments use `bun run deploy:manual`.

The deployment pipeline applies remote D1 migrations without an interactive confirmation, deploys the Worker, and verifies required tables and the authentication Secret. It normalizes migration SQL to LF and runs Wrangler with its supported Node.js runtime for consistent behavior across Windows, macOS, and Linux.

EdgeEver fails closed: a production instance without completed D1 migrations or authentication configuration returns `database_not_ready` or `auth_not_configured` instead of exposing an unauthenticated workspace. The instance is ready only when `/api/health` returns `200` with `"ok": true` and login succeeds.

## Recovery

- Database not ready: confirm the D1 binding is exactly `DB`, then run `bun run deploy:manual`.
- Authentication not configured: set `EDGE_EVER_AUTH_PASSWORD` in `.env.local`, then run `bun run deploy:manual`.
- Invalid or lost account password: never write plaintext to `users.password_hash`. Run:

  ```sh
  EDGE_EVER_PASSWORD='<new password of at least 8 characters>' \
    bun run auth:reset-password -- --remote --username admin
  ```

The binding names must be exactly `DB` for D1 and `RESOURCES` for Workers KV. Files are limited to 25 MiB and the instance enforces a 750 MiB physical storage cap. On Workers Free, operations fail instead of producing overage charges when account-level KV quotas are exhausted. Existing installations using `EDGE_EVER_AUTH_PASSWORD_HASH` remain supported; when both password Secrets exist, the hash takes precedence.

## Enable Workers Builds and Automatic Updates

After the first CLI deployment, follow [Cloudflare Workers Builds](cloudflare-workers-builds.md) and run:

```sh
bun run deploy:builds:setup
```

This connects the Worker to the repository's `main` branch and securely copies the build variables required for future migrations and deployment. Every later push to `main` uses the same common deployment pipeline.

The repository's **Update deployed EdgeEver** workflow checks upstream formal Releases daily on the default `stable` channel. Set the GitHub repository variable `EDGE_EVER_UPDATE_CHANNEL=edge` to follow upstream `main` instead. GitHub disables scheduled workflows by default on public forks, so open **Actions** and enable this workflow after a fork-based installation. Update conflicts or failed local verification leave the deployed branch unchanged.
