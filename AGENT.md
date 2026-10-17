# AGENT.md — 智能体守则

> 本文件是智能体（AI 协作者）在本仓库工作时必须遵守的守则。人类 maintainer 可修改。

## 文档纪律

| 位置 | 用途 | 规则 |
| --- | --- | --- |
| `README.md` + `docs/` | 技术文档 | 权威设计来源。只写**当前有效**的设计；设计变更时直接改写，不记流水账 |
| `notes/` | 具体日志 | 文件名 = 日期+时分（`YYYY-MM-DD-HHmm.md`）。一次工作/讨论一篇，记录过程、上下文、关键细节与理由 |
| `LOG.md` | 追加式简单日志 | 一行一条，**只追加、不修改历史**。每条：日期时间 ｜ 一句话 ｜ 指向 `notes/` 具体文件的指针 |
| `AGENT.md` | 本文件 | 守则本身；修改它等同于修改流程，需在 LOG.md 记一笔 |

## 工作流程

1. 开始一块工作前：读 `README.md` + `docs/`，确认当前设计与待定项。
2. 完成一块工作后（按顺序）：
   a. 写 `notes/<日期>-<时分>.md` 详录本次工作；
   b. `LOG.md` 追加一行（含指向该 note 的指针）；
   c. 若设计有变更，同步改写 `docs/`（不是追加 changelog）；
   d. 若关闭了某个「待定/挂起」项，更新 `docs/decisions.md` 状态列。
3. 待定项在 docs 中以「🕐 待定 / ⏸ 挂起」显式标注；不要悄悄把待定写成定论。

## 设计依据

一切设计结论以 `docs/decisions.md`（grilling 定稿记录）为准；与之冲突的改动必须先记录理由再修改。

## DSH 升级后的兼容性校验

插件依赖宿主的一批未冻结表面（Slots、owner props、standard props、装载器），升级后必须跑 `test/compat.test.mjs`：

1. 静态层（默认读 `D:\DeepSeek Harness\resources\app.asar`，可用环境变量 `DSH_ASAR` 改指）：逐项 grep 打包产物里的 client 契约表面，清单与 `docs/sdk-notes.md` 一一对应。
2. 线上层（GUI 在跑时追加）：`$env:DSH_GUI_URL="http://127.0.0.1:<port>"` 后跑同一文件，探 `/api/health`、`/api/list`、铸票→伺服全链路——这是 host 半身的权威证明。
3. 无 DSH 环境（CI 等）自动 skip 相关用例，`node --test` 总盘保持绿。
4. 契约确认变化时：先改测试断言，再改实现，并同步改写 `docs/sdk-notes.md`（不记流水账）。
