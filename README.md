# dsh-web-app

DeepSeek Harness（DSH）插件：**跨会话复用的可回传 Web App**。

AI 通过部署工具把单文件 HTML 应用（带元数据与回传模板）放进 Git 仓库目录；用户在对话中用 `/webapp` 斜杠命令把它**内嵌打开（此步不触发模型调用）**；用户在应用里组好数据后一键回传，插件按**预设填空模板**把数据注入会话，驱动模型进入决策。

> 状态：**设计定稿（grilling 访谈后），待实现**。本文档与 `docs/` 是实现的唯一依据。

## 为什么是"填空模板"而不是让模型去读 HTML

没有上下文的模型收到一组凭空的数据不知道它是什么；让它去读 HTML 源码则 token 开销太大。因此每个 webapp 携带一份 AI 在开发期写好的填空模板，回传时由插件把结构化变量值填进模板，模型读到的是一段连贯的"用户汇报"。

## 已核验的 SDK 落点（2026-10 于运行时 Inspect 核验）

| 能力 | SDK 机制 |
| --- | --- |
| 斜杠命令 | host `commands.register(CommandDefinition)`（人类命令，执行本身不触发模型调用） |
| 对话内嵌显示 | client slot `conversation.chat.commandview`（按命令名派发的 keyed slot，核验时零占用） |
| 全屏显示 | client `layout.openRightbar(track, fullscreen)` / slot `shell.overlay` |
| 回传注入会话 | host `sessionController.prompt`（@Remote，客户端可向指定 session 注入用户消息） |
| 静态伺服 | host `webServer.register(route)` |
| 部署/自检工具 | host `tools.register` |
| 模型契约注入 | `skills.register`（分层 skill）/ `systemPrompt.section` |
| 侧边栏管理面板 | slot `sidebar.panellist` + keyed slot `main` + `layout.selectPanel()`（与已安装的「自动化任务」插件同一机制） |

## 文档索引

- [MVP 设计](docs/mvp-design.md) — 架构、命令、显示面、回传链路、部署与版本、面板、调试闭环、安全模型
- [回传契约草案](docs/callback-contract.md) — 目录结构、`app.json`、模板格式、变量词表、postMessage 协议、确认与去重规则
- [设计决策记录](docs/decisions.md) — grilling 19+3 问的全量结论与待定项
- [演化路线图](docs/roadmap.md) — TUI 降级 / 任意后端 / 双向事件流（含概念修正）

## MVP 一句话范围

单文件 HTML + 元数据 + 回传模板，每应用一个 Git 仓库；`/webapp` 单命令内嵌打开；一次性回传、默认需用户确认；同名拒绝再部署、改版本靠提交与刷新；侧边栏面板做版本管理。

明确**不做**（见 decisions/roadmap）：session-id 选择器（留给 TUI 时代）、外部独立使用的回传、多文件与任意后端、双向事件流。
