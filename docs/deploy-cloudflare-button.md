# Deploy EdgeEver with Cloudflare

The **Deploy to Cloudflare** button is the recommended first-installation path. It creates a repository in your GitHub account, provisions the Worker, D1 database, and Workers KV namespace, applies the database migrations, and connects the repository to Cloudflare Workers Builds.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ShuTianLe/edgeever)

## First Installation

1. Sign in to Cloudflare and GitHub, then open the button above.
2. Authorize the **Cloudflare Workers & Pages** GitHub App when requested.
3. Choose the destination repository, Worker name, D1 database name, and Workers KV namespace.
4. Set `EDGE_EVER_AUTH_PASSWORD` to a strong password that is unique to this instance. The field is a Worker Secret and must not be committed to Git.
5. Save and deploy. Cloudflare runs the repository's common deployment pipeline: build, remote D1 migrations, Worker deployment, and deployment verification.
6. Open the resulting `*.workers.dev` URL. Confirm `/api/health` returns `200` with `"ok": true`, then sign in as `admin` with the password chosen during setup.

EdgeEver fails closed. If the D1 migrations or authentication Secret are missing, the instance returns `database_not_ready` or `auth_not_configured` instead of exposing an unauthenticated workspace.

## Automatic Updates

The generated repository is connected to Workers Builds, so every push to `main` builds, migrates, verifies, and deploys the instance. It also contains the **Update deployed EdgeEver** workflow, which checks the upstream repository once per day.

The default `stable` channel follows the latest formal GitHub Release. Before publishing an update, the workflow merges it locally and verifies dependency installation, local D1 migrations, automated tests, type checking, and the production web build. A failed merge or check leaves the deployed `main` branch unchanged and attempts to create an Issue with recovery guidance.

To follow the latest upstream `main` instead, create a GitHub repository variable named `EDGE_EVER_UPDATE_CHANNEL` with the value `edge`. You can also run the workflow manually and select either channel for that run.

GitHub may delay scheduled workflows and may disable them for an inactive public repository. If daily updates stop, open the repository's **Actions** tab, enable **Update deployed EdgeEver**, and run it manually once. Do not force-push over update conflicts; resolve them or return to an unmodified deployment repository.

## Alternative Entry Points

- Use [AI Agent Cloudflare Deployment](agent-deploy-cloudflare.md) when an agent should perform the same deterministic CLI deployment with custom configuration.
- Use [Cloudflare Manual Deployment](manual-deploy.md) for advanced configuration, troubleshooting, or emergency recovery.

All three entry points share the same build, migration, Worker deployment, and verification commands. After first installation, they converge on Workers Builds and the same automatic-update workflow.
