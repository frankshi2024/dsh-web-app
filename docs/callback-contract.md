# 回传契约（草案）

> 约束对象：`dsh-web-app-author` skill 指导下的 AI 开发者。`dsh-web-app-check` 按本文档校验。

## 1. 应用目录结构

每个 webapp 一个文件夹 = 一个 Git 仓库：

```
apps/<name>/
├── index.html              # 单文件应用（全部内联）
├── app.json                # 元数据（见 §2）
├── callback.template.md    # 回传填空模板（见 §4）
└── .git/                   # 首次部署时初始化
```

`name`：kebab-case，创建后不可改；同名创建一律拒绝。

## 2. app.json

```json
{
  "name": "kebab-case",
  "description": "一句话简介，显示在选择器与管理面板",
  "confirm": true,
  "variables": [
    { "slot": "TEXT_1", "label": "展示名", "purpose": "语义声明（模板作者自觉填写）" },
    { "slot": "NUMBER_1", "label": "...", "purpose": "..." }
  ]
}
```

- `confirm`：默认 `true`（回传前用户确认）。AI 开发期判断内容不适合打扰用户时可设 `false`，卡片将常驻风险提示。
- `variables`：固定词表 + 自增编号（见 §3）。

## 3. 变量词表（Q14）

固定基本类型 + 自增编号：`TEXT_1..n`、`NUMBER_1..n`、`BOOLEAN_1..n`、`JSON_1..n`。

- 插件只做**类型与存在性**校验，不做语义校验；
- 语义由模板作者自觉声明（`purpose` + 模板上下文）。解读侧（`dsh-web-app-interpret` skill）以模板作者声明为准。
- 注入机制（Q14a 已定）：**伺服时盖章**——仓库存带占位符的干净源码，`webServer` 路由在响应时替换保留占位符后把成品发给 webapp：
  - 保留占位符词表：`{{__NAME__}}`（应用名）、`{{__VERSION__}}`（当前部署指针：分支@提交）、`{{__TOKEN__}}`（本次加载的一次性门票，见 §5）；
  - webapp 收到的是成品 HTML，**无需任何初始化接收代码**；仓库零污染；token 每次加载新发；版本号盖的是当前部署指针（部署时盖章会鸡生蛋：提交前不知道 commit hash）；
  - 降级提示：直接双击打开磁盘上的源文件时占位符保持原样（独立使用的可接受降级）；经伺服 URL 访问总是盖章后的成品。

## 4. 回传模板 callback.template.md

Markdown「小作文」，占位符形如 `{{TEXT_1}}`。回传时由插件填充后作为**用户消息**注入会话。模板必须携带：

1. webapp 名称与版本（分支/提交）；
2. 动作类型（这次提交代表什么操作）；
3. 各变量值 + 语义上下文（让没有上下文的模型读懂这组数据）。

示例骨架：

```markdown
[webapp 回传] 应用：{{__NAME__}}（{{__VERSION__}}）动作：提交配置
用户在我的「配置面板」里完成了设置：
- 目标环境：{{TEXT_1}}
- 并发数：{{NUMBER_1}}
请基于以上配置继续。
```

`__NAME__` / `__VERSION__` 为保留占位符，回传时由插件自动填充。注意区分两次填充：**HTML 里的保留占位符在伺服时盖**（§3），**本模板里的占位符在回传时填**。

## 5. postMessage 协议（Q5 已定）

- **门票发放**：`{{__TOKEN__}}` 由伺服路由在每次响应时盖章进 HTML——每次加载都是一张新票，无需 URL query 或 init 消息；
- iframe → 插件（唯一消息）：`{ source: "dsh-web-app", type: "submit", token, values: {...} }`
- 桥校验：`source` 正确、token 等于该卡片当前发票、`values` 的键与类型和 `app.json` 声明一致；任一不符即丢弃并提示；
- 威胁模型：MVP 防「AI 代码缺陷/多实例串话」，兜底是 Q8 用户确认；对抗性页面由确认环节拦截。

## 6. 确认与去重（Q7/Q8/Q19）

- 确认 UI 展示**渲染后的完整文本** + 确认/取消；
- 去重键：`(sessionId, turnId, hash(values + 模板版本))`；**同一 turn、未被压缩/打断、payload 严格一致** ⇒ 拦截第二次并提示；
- turn 边界由会话事件判定；压缩/打断后视为新 turn；
- 除此之外一律照传（用户刻意双端各发一次也照传，只要不完全相同）。

## 7. 自检清单（dsh-web-app-check）

- [ ] 三件套齐全：`index.html` / `app.json` / `callback.template.md`
- [ ] `app.json` 通过 schema 校验（含显式 `confirm` 声明）
- [ ] 模板每个占位符都有变量声明；每个声明的变量都被模板或页面使用
- [ ] `index.html` 含回传桥代码（读取 `{{__TOKEN__}}`、调用 `submit`）
- [ ] `index.html` 只使用保留占位符词表（`__NAME__`/`__VERSION__`/`__TOKEN__`），无其他未声明的 `{{...}}`
- [ ] git 工作树干净、至少一次提交
