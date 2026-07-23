# Cloudflare Workers Builds

Cloudflare Workers Builds deploys EdgeEver whenever `main` changes. Cloudflare one-click deployment connects it automatically; CLI installations use local `bun run deploy:manual` only for first installation or emergency recovery.

## Setup

Cloudflare one-click installations do not need this setup command. For CLI or Agent installations, complete the [first deployment](manual-deploy.md), then run:

```sh
bun run deploy:builds:setup
```

The command reads the repository remote and `.env.local`, configures the build, and starts one verification build on first setup. It is safe to rerun after instance settings change.

Only complete the following steps when the command asks for them.

### GitHub authorization

Approve installation of the **Cloudflare Workers & Pages** GitHub App for the deployment repository. This is the app's name; an EdgeEver instance does not require a Pages project. The command handles the repository connection after authorization.

### Configuration API token

If `EDGE_EVER_BUILDS_API_TOKEN` is missing, create a custom **User API Token** at [My Profile -> API Tokens](https://dash.cloudflare.com/profile/api-tokens) with:

- **Account** -> **Workers Builds Configuration** -> **Edit**
- **Account** -> **Workers Scripts** -> **Read**

Do not use an Account API Token or a prebuilt template. Limit the token to the relevant account, then save the value shown by Cloudflare once in `.env.local`:

```text
EDGE_EVER_BUILDS_API_TOKEN=<token>
```

Never commit or share this token.

![Redacted Cloudflare User API Token permissions](assets/cloudflare-workers-builds-user-token.svg)

### Deployment API token

If the command reports that no deployment API token is available, open **Worker** -> **Settings** -> **Builds** -> **API token** and create or select one that can deploy the Worker and update D1 and the Workers KV binding, then rerun the command. When several are available, select one by name in the terminal.

## Updates and Troubleshooting

After setup, every push to `main` makes Cloudflare install dependencies, check and build the app, apply new D1 migrations, deploy the Worker, and verify the result. The **Update deployed EdgeEver** GitHub workflow supplies upstream updates daily: `stable` follows formal Releases by default, while the repository variable `EDGE_EVER_UPDATE_CHANNEL=edge` follows upstream `main`. No Cloudflare deployment secrets or local redeployment are required in GitHub Actions.

If a build fails, inspect its log in the Worker **Deployments** tab. Rerun `bun run deploy:builds:setup` when instance settings change.
