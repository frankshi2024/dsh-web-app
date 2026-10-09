# dsh-web-app

**Reusable, callback-capable Web Apps for DeepSeek Harness** — 单文件 HTML 应用放进 Git 仓库，对话里 `/webapp` 内嵌打开，用户组好数据一键回传为连贯的「用户汇报」注入会话。

A DeepSeek Harness (DSH) plugin: AI deploys single-file HTML apps (metadata + callback template) into per-app Git repos; users open them inline in a conversation with `/webapp`, and submissions come back as template-filled user messages — after an explicit confirmation step.

## 它是干什么的

模型有时需要**结构化输入**才能继续干活：选环境、填参数、勾策略、标数据。纯对话收集又慢又易错。本插件让 AI 随手造一个一次性的（或可复用的）小 Web 应用：

1. **AI 部署**：`dsh-web-app-deploy` 工具收 `name + html + metadata + template`，建档三件套（`index.html` / `app.json` / `callback.template.md`）→ git init + 首提交 → 登记注册表；
2. **用户打开**：`/webapp [name]`（不触发模型调用），应用在对话卡片里以 sandbox iframe 内嵌运行；侧边栏「Web 应用」面板管版本与删除；
3. **用户回传**：应用 `postMessage` 提交结构化数据 → 桥的门票/结构校验 → **确认弹窗展示渲染全文** → 按填空模板渲染后注入当前会话的用户消息；
4. **模型续作**：读到一段连贯的用户汇报（含应用名、版本、各变量语义），直接继续决策。

为什么是「填空模板」而不是让模型去读 HTML：没有上下文的模型收到一组凭空数据不知道它是什么；读 HTML 源码 token 开销太大。模板由 AI 在开发期写好，回传时插件填值，模型读到的是人话。

## 特性

- **零模型调用的打开**：`/webapp` 是纯 UI 命令，打开应用这件事模型不可见
- **一次性门票**：每次加载铸新票（loadId+token 双 UUID、绑应用名、10 分钟过期），token 伺服时盖章进 HTML、永不进 URL
- **严格校验链**：`event.source` 比对 → `source/type` → 门票 → values 键集与类型严格匹配（TEXT/NUMBER/BOOLEAN/JSON 四型，JSON 按字符串传输）
- **默认用户确认**：确认弹窗展示渲染后的完整文本；`app.json` 可声明 `confirm:false`（卡片常驻风险提示）
- **同 turn 去重**：同一 turn、未压缩/打断、payload 严格一致 ⇒ 拦截重复提交；其余一律照传
- **Git 即事实源**：部署指针 = 分支+提交，伺服按指针出文件；改应用 = 改仓库 + 提交，卡片「刷新」即拉新版；同名拒绝再部署
- **全屏模式**：卡片一键全屏（显式退出按钮 + ESC）
- **分层 skills**：`dsh-web-app-author`（造/改应用）与 `dsh-web-app-interpret`（解读回传）随包注入

## 安装

```bash
# 在 DSH profile 目录（如 ~/.dsh/profiles/<profile>）中：
pnpm add link:/path/to/dsh-web-app
```

并在该 profile 的 `package.json` 的 `dsh.profile.bundles` 数组中加入 `"dsh-web-app"`。重启或热载后生效。

> 对等依赖（均为可选）：`dsh-commands` / `dsh-tools` / `dsh-host-webserver` 为硬注入；`dsh-skill`（skills 注册）缺失时跳过。

## 使用

| 动作 | 入口 |
| --- | --- |
| 打开应用 | 对话输入 `/webapp`（选择器）或 `/webapp <name>`（深链） |
| 全屏 | 卡片右上角「全屏」；红色「✕ 退出全屏」按钮或 ESC 退出 |
| 拉取新版本 | 改仓库 + `git commit` 后，点卡片「刷新」 |
| 管理 | 侧边栏「Web 应用」图标：版本/仓库状态/删除 |
| 部署新应用 | 让 AI 走 `dsh-web-app-author` skill 流程（`dsh-web-app-deploy` 工具 + `dsh-web-app-check` 自检） |

应用数据落在 `$DSH_HOME/dsh-web-app/`：`apps/<name>/` 为各应用 Git 仓库，`registry.json` 为注册表。

## 一个最小应用

```html
<script>
  const APP_TOKEN = "{{__TOKEN__}}"; // 伺服时盖章；仓库里保持占位符原样
  function submit(values) {
    window.parent.postMessage(
      { source: "dsh-web-app", type: "submit", token: APP_TOKEN, values }, "*");
  }
</script>
```

变量在 `app.json` 声明（`TEXT_1`/`NUMBER_1`/`BOOLEAN_1`/`JSON_1` 固定词表 + label + purpose），回传模板 `callback.template.md` 以 `[webapp 回传]` 开头、用 `{{SLOT}}` 占位。完整契约见 [docs/callback-contract.md](docs/callback-contract.md)，可运行的示例见 [examples/config-panel](examples/config-panel/)。

## 安全模型（摘要）

iframe 固定 `sandbox="allow-scripts"`（opaque origin，不授予 `allow-same-origin`——应用拿不到 cookie/DOM，也走不了 `/api` 鉴权通道）；数据通道是插件自有前缀路由（无鉴权，回环绑定下暴露面 = 本机进程）；伪造回传由门票 + 结构校验拦截，**用户确认是最终兜底**。

## 开发

```bash
node --test   # 52 项测试：契约校验 / 注册表 / git / 部署 / 自检 / HTTP 全链路
```

仓库结构：`lib/`（host 半 ESM + `client.js` 浏览器半）、`skills/`（分层 skill）、`examples/`（示例应用）、`docs/`（设计文档——[MVP 设计](docs/mvp-design.md) · [回传契约](docs/callback-contract.md) · [决策记录](docs/decisions.md) · [路线图](docs/roadmap.md) · [SDK 侦查笔记](docs/sdk-notes.md)）。

## License

[MIT](LICENSE)
