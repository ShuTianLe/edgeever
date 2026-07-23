# AGENTS.md

本文件用于约束和指导参与本项目的 AI 代理与协作者。除非用户明确给出更高优先级的指令，否则应遵守以下规则。

## 项目背景与技术栈

涉及本项目的背景、定位、部署信息与技术栈说明时，请优先参考 `README.md`。

## 中英文文档同步约束

修改中文文档时，必须同步更新对应的英文文档，确保内容一致。

## Git 分支约束

严禁创建新的 Git 分支；所有修改、提交和推送都必须直接在 `main` 分支上完成。

## GitHub Issue 与 Release 约束

正式版本遵循 Semantic Versioning，标签与 Release 标题统一使用 `vX.Y.Z`。发布前检查远端标签与实际 GitHub Release；孤立标签不作为发布基线，每个正式标签最终都应有对应 Release。

Release 以上一个实际发布的正式 Release 为基线，审计完整提交区间并面向用户汇总所有可感知变化。Release 说明必须使用英文。标签必须指向 `main` 上经过验证的提交，默认发布为非 Draft、非 Prerelease。功能或修复 Release 须关联带对应 Label 的 Issue；发布后回链并关闭 Issue。正文结构：

```md
## 主要更新

- 面向用户说明本次变化及影响。

关联 Issue：#<issue-number>

## 验证

- 列出实际完成的测试、类型检查和构建结果。
```

验证失败时不得发布正式 Release。

每个正式 Release 必须附带可安装的 Android APK。APK 文件名统一使用 `edgeever-android-vX.Y.Z-<ABI>.apk`，例如 `edgeever-android-v0.4.14-arm64-v8a.apk`。GitHub APK 默认仅构建 `arm64-v8a`；只有出现明确兼容需求时才额外提供其他 ABI，Play AAB 仍保留全部架构。若完整变更区间影响移动端代码、其共享依赖、原生配置或 APK 构建，则从本次发布提交重新构建生产签名 APK；否则可复用最近的兼容 APK，并在正文中注明来源 Release。发布前验证 APK 版本、签名、SHA-256 及下载可用性。

## Cloudflare 自动部署约束

当用户要求根据 GitHub 项目链接将本项目安装部署到 Cloudflare 时，必须先完整阅读并严格按照 `docs/agent-deploy-cloudflare.md` 执行。该文档是此部署流程的唯一操作规范；不要在本文件重复维护部署命令、密码配置或 Workers Builds 步骤。

## 本地启动约束

- 默认使用 `bun run dev` 启动完整本地环境（本地 D1/KV 和固定演示种子），不得连接 `.env.local` 中的远程实例。
- 仅在用户明确指定远程实例并要求连接时，使用 `EDGE_EVER_INSTANCE=<实例名> bun run dev:remote`；私有配置以 `.env.local` 为准，不得硬编码实例名。
- 仅在用户明确要求只启动前端时使用 `bun run dev:web`。

## 组件复用与造轮子约束

UI 功能应尽量复用 `shadcn/ui` 等现有 UI 组件。在实现其他功能时，也应优先采用成熟、稳定的开源组件或库，绝对禁止在没有充分必要性的前提下自行从零造轮子。

为方便代码维护，当页面或功能模块出现复杂结构、重复布局或潜在复用场景时，应视情况封装为独立组件，保持页面入口聚焦于组合与数据传递。
