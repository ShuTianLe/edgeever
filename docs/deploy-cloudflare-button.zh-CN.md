# 使用 Cloudflare 一键部署 EdgeEver

**Deploy to Cloudflare** 按钮是推荐的首次安装方式。它会在你的 GitHub 账号中创建仓库，自动创建 Worker、D1 数据库和 Workers KV namespace，执行数据库 migration，并将仓库连接到 Cloudflare Workers Builds。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ShuTianLe/edgeever)

## 首次安装

1. 登录 Cloudflare 和 GitHub，然后打开上方按钮。
2. 按提示授权 **Cloudflare Workers & Pages** GitHub App。
3. 选择目标仓库名、Worker 名称、D1 数据库名称和 Workers KV namespace。
4. 为 `EDGE_EVER_AUTH_PASSWORD` 设置仅供当前实例使用的强密码。该字段是 Worker Secret，不得提交到 Git。
5. 保存并部署。Cloudflare 会执行仓库统一的部署流水线：构建、远程 D1 migration、Worker 发布和部署验证。
6. 打开生成的 `*.workers.dev` 地址，确认 `/api/health` 返回 `200` 和 `"ok": true`，然后使用用户名 `admin` 和刚设置的密码登录。

EdgeEver 采用安全关闭策略。D1 migration 或鉴权 Secret 缺失时，实例会返回 `database_not_ready` 或 `auth_not_configured`，不会暴露免登录工作区。

## 自动更新

生成的仓库会连接 Workers Builds，因此任何推送到 `main` 的提交都会自动构建、迁移、验证并发布。仓库还包含 **Update deployed EdgeEver** 工作流，每天检查一次上游更新。

默认 `stable` 通道跟随最新的正式 GitHub Release。发布更新前，工作流会在本地合并并验证依赖安装、本地 D1 migration、自动化测试、类型检查和生产 Web 构建。合并冲突或验证失败时不会修改线上 `main`，并会尝试创建 Issue 提供恢复提示。

如果希望跟随上游最新 `main`，请创建名为 `EDGE_EVER_UPDATE_CHANNEL`、值为 `edge` 的 GitHub Repository Variable。也可以手动运行该工作流，并为本次运行选择任一通道。

GitHub 的定时任务可能延迟，也可能因公共仓库长期无活动而被停用。如果每日更新停止，请打开仓库的 **Actions** 页面，启用 **Update deployed EdgeEver** 并手动运行一次。遇到更新冲突时不要 force push，应解决冲突或恢复为未定制的部署仓库。

## 其他部署入口

- 需要由 Agent 使用自定义配置执行同一套确定性 CLI 部署时，使用 [AI Agent Cloudflare Deployment](agent-deploy-cloudflare.md)。
- 高级配置、故障排查或紧急恢复时，使用 [Cloudflare 手动部署指南](manual-deploy.zh-CN.md)。

三个入口共用同一套构建、migration、Worker 发布和验证命令。首次安装完成后，它们都会汇合到 Workers Builds 和同一套自动更新工作流。
