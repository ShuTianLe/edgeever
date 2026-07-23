# Cloudflare 手动部署指南

该入口用于高级首次安装、自定义配置、故障排查和紧急恢复。大多数用户应优先使用 [Cloudflare 一键部署](deploy-cloudflare-button.zh-CN.md)。AI 助手必须遵循 [AI Agent 部署约定](agent-deploy-cloudflare.md)，其底层调用的也是本文命令。

所有入口共用同一套部署内核：

```text
build:cloudflare -> db:migrate:remote -> deploy:worker -> deploy:verify
```

手动入口只是在该流水线外增加本地配置检查。日常更新统一由 Cloudflare Workers Builds 执行，不依赖本地电脑。

## 自动化 CLI 初始化

1. 基于 [tianma-if/edgeever](https://github.com/tianma-if/edgeever) 创建 GitHub 仓库，然后克隆：

   ```sh
   git clone <你的仓库 URL>
   cd edgeever
   ```

2. 安装 Node.js 22 或更高版本以及 Bun。Wrangler 已包含在项目依赖中，无需全局安装。

3. 安装依赖并初始化 Cloudflare 资源：

   ```sh
   cp .env.local.example .env.local
   bun install
   bun run deploy:setup
   bun run deploy:doctor
   bun run deploy:manual
   ```

   模板使用 `admin` / `admin123` 作为初始登录账号密码。如果希望初始化时指定密码，请用下面的命令替代普通 setup：

   ```sh
   EDGE_EVER_PASSWORD='<你的密码>' bun run deploy:setup
   ```

`deploy:setup` 使用项目内置 Wrangler；缺少授权时启动 `wrangler login`，创建 D1 和生产/预览 Workers KV namespace，并把非 Secret 配置写入 Git 忽略的 `.env.local`。发现同名资源但未明确配置 ID 时会停止，避免复用未知数据。`deploy:manual` 会执行 doctor、生产构建、统一部署流水线和远端验证。

## 完全手动创建资源

如果不希望 `deploy:setup` 创建资源，请执行：

```sh
cp .env.local.example .env.local
bun install
bunx wrangler d1 create edgeever
bunx wrangler kv namespace create edgeever-resources
bunx wrangler kv namespace create edgeever-resources-preview
```

将返回的 D1 ID 和资源名称写入 `.env.local`：

```text
EDGE_EVER_D1_DATABASE_ID=<database_id>
EDGE_EVER_KV_NAMESPACE_NAME=edgeever-resources
EDGE_EVER_KV_NAMESPACE_ID=<namespace_id>
EDGE_EVER_KV_PREVIEW_NAMESPACE_NAME=edgeever-resources-preview
EDGE_EVER_KV_PREVIEW_NAMESPACE_ID=<preview_namespace_id>
EDGE_EVER_RESOURCE_STORAGE_LIMIT_BYTES=786432000
EDGE_EVER_WORKERS_FREE_CONFIRMED=true
EDGE_EVER_AUTH_USERNAME=admin
EDGE_EVER_AUTH_PASSWORD=<强密码>
EDGE_EVER_SESSION_TTL_DAYS=400
```

然后执行：

```sh
bun run deploy:doctor
bun run deploy:manual
```

`.env.local` 仅供本地 EdgeEver 脚本读取。不得上传、提交到 Git，或作为文件复制到 Cloudflare 构建环境。标准的 `bun run deploy` 专供 Cloudflare 一键部署的非交互入口使用；本地和 Agent 部署使用 `bun run deploy:manual`。

部署流水线会非交互执行远程 D1 migration、发布 Worker，并验证必需数据表和鉴权 Secret。迁移 SQL 会统一为 LF，Wrangler 始终通过其支持的 Node.js runtime 运行，确保 Windows、macOS 和 Linux 行为一致。

EdgeEver 采用安全关闭策略：生产实例未完成 D1 migration 或鉴权配置时会返回 `database_not_ready` 或 `auth_not_configured`，不会暴露免登录工作区。只有 `/api/health` 返回 `200` 和 `"ok": true`，且登录成功，实例才算可用。

## 故障恢复

- 数据库未就绪：确认 D1 binding 名称严格为 `DB`，然后运行 `bun run deploy:manual`。
- 鉴权未配置：在 `.env.local` 设置 `EDGE_EVER_AUTH_PASSWORD`，然后运行 `bun run deploy:manual`。
- 账号密码无效或丢失：不要向 `users.password_hash` 写入明文，请执行：

  ```sh
  EDGE_EVER_PASSWORD='<至少 8 位的新密码>' \
    bun run auth:reset-password -- --remote --username admin
  ```

D1 和 Workers KV 的 binding 名称必须分别为 `DB` 和 `RESOURCES`。单文件上限为 25 MiB，实例总物理存储硬限制为 750 MiB；Workers Free 达到账号级 KV 配额后操作会失败而不会产生超额费用。已有实例仍可使用 `EDGE_EVER_AUTH_PASSWORD_HASH`；两个密码 Secret 同时存在时优先使用 hash。

## 开启 Workers Builds 和自动更新

CLI 首次部署完成后，按照 [Cloudflare Workers Builds 自动部署](cloudflare-workers-builds.zh-CN.md) 执行：

```sh
bun run deploy:builds:setup
```

该命令会把 Worker 连接到仓库 `main` 分支，并安全复制后续 migration 和部署所需的构建变量。此后任何推送到 `main` 的提交都会使用同一套部署内核。

仓库中的 **Update deployed EdgeEver** 工作流默认使用 `stable` 通道，每天检查上游正式 Release。设置 GitHub Repository Variable `EDGE_EVER_UPDATE_CHANNEL=edge` 后可改为跟随上游 `main`。GitHub 默认会禁用公共 Fork 中的定时工作流，因此通过 Fork 安装后需要打开 **Actions** 并启用该工作流。更新冲突或本地验证失败时不会修改已部署分支。
