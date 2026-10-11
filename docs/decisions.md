# 设计决策记录（grilling 定稿）

> 2026-10-08 grilling 访谈全量记录。状态：✅ 定稿 ｜ 🕐 待定 ｜ ⏸ 挂起。

## MVP

| # | 问题 | 结论 | 状态 |
| --- | --- | --- | --- |
| Q1 | 渲染载体 | commandview 内嵌 iframe 卡片（视觉等同 GenUI 卡片，但任意 HTML 走 iframe 而非白名单组件树）；全屏用 `openRightbar`/`shell.overlay` | ✅ |
| Q2 | 命令形态 | 单命令 `/webapp [name]`；无参时卡片内应用选择器，不要求记名字；不做动态命令注册 | ✅ |
| Q3 | 打开留痕 | 不向模型暴露「打开过某 webapp」；command 节点仅供用户侧回溯 | ✅ |
| Q4 | 模板契约 | AI 开发期编写；每应用一文件夹，模板独立文件；必带名称/版本/动作类型/变量语义 | ✅ |
| Q5 | 传输防伪造 | 采纳推荐：门票 token（伺服时盖章、每次加载新发）+ 结构校验，Q8 用户确认兜底 | ✅ |
| Q6 | 回传粒度 | 一次性「提交」；刷新丢状态接受（正常 Web UI 亦如此） | ✅ |
| Q7 | 并发去重 | 同一 turn、未压缩/打断、payload 严格一致 ⇒ 只发一次；其余照传 | ✅ |
| Q8 | 发送前确认 | 默认确认；`app.json` 可声明 `confirm:false`，UI 常驻风险提示 | ✅ |
| Q9 | session-id 选择器 | **MVP 砍掉**——commandview 天然 session 内；选择器留给 TUI 时代 | ✅ |
| Q10 | 跨会话护栏（冻结设计） | 未来若做：候选仅限「已用 /webapp 打开且运行中」的会话，并以标准方式警告不要跨会话回传 | ⏸ |
| Q11 | 部署流程 | 首次：工具收 html+metadata+name → 建档+git init+首提交；此后修改直接在仓库进行；部署指针=分支+提交；需配 skill | ✅ |
| Q12 | Git 的意义 | 由 Q11 回答：仓库即事实源，版本=分支+提交 | ✅ |
| Q13 | 宣布形式 | 侧边栏面板展示当前使用版本（`sidebar.panellist`+`main`）；细节引导与 AI 对话；对模型=工具返回值 | ✅ |
| Q14 | 特殊变量 | 固定词表+自增编号（TEXT/NUMBER/BOOLEAN/JSON_n）；语义由模板作者自觉；注入机制=**伺服时盖章**（仓库存占位符源码，路由响应时替换保留占位符） | ✅ |
| Q15 | 契约进上下文 | 分层 skills：制作/编辑（author）与结果解读（interpret）分开 | ✅ |
| Q16 | 调试闭环 | author skill 要求 Playwright/浏览器自动化目测 + `dsh-web-app-check` 自检模板与变量加载 | ✅ |
| Q17 | 同名再部署 | 拒绝同名，换名；metadata 加简介；旧版实例用户点刷新按钮拉新版 | ✅ |
| Q18 | 管理 UI | MVP 含删除；入口放侧边栏——参照已安装的「自动化任务」插件（知道此机制存在即可，无需调研） | ✅ |
| Q19 | 双端重复 | 用户刻意则照传；仅「同 turn+严格一致」去重 | ✅ |
| Q20 | 门票发放机制（Q5 实现细化） | 卡片先 `POST /dsh-web-app/api/load` 铸票（loadId+token 双 UUID、一次性、绑名、10min TTL），URL 只带 loadId 关联号，伺服时凭票盖章；token 永不进 URL | ✅ |
| Q21 | iframe sandbox 取值（Q5 实现细化） | 固定 `allow-scripts`（opaque origin），**不授予** `allow-same-origin`；应用无 cookie/DOM/`/api` 通路，数据通道 = 插件自有前缀路由 + 门票 | ✅ |
| Q22 | 部署后自动展示 | turn 结束时（**含 interrupted/aborted 等一切结束原因**——turn-tail 节点对所有 reason 都发布）若本 turn 内发生过部署或提交（常驻 watcher 提交差分 + turn 内 deploy 工具补扫双路检测），该 turn 尾部自动浮现**折叠**体验卡，用户点「立即体验」才展开 | ✅ |
| Q23 | 模型主动插入卡片 | 新工具 `dsh-web-app-show { name, expand? }`：expand=false（默认）折叠卡、true 立即展开；由 keyed slot `tool.call.toolview` 渲染（命中即替换通用工具卡） | ✅ |
| Q24 | turnTail owner prop 类型（0.1.1 修复） | Slots 契约：`conversation.chat.turnTail` 的 `turn` 是 **TurnLocation 对象**（`.turn` 数值 id / `.status` / `.end`），不是数字；0.1.0 误当数字用导致自动卡永不命中，0.1.1 归一化 `turnId = typeof turn === 'object' ? turn.turn : turn` | ✅ |
| Q25 | show 卡片的可见层级（0.1.1 修复） | 工具行处于 turn-process 折叠组内（`foldCompletedTurns`，组折叠为宿主表现策略，occupant 无权越级），故 show 的可见表面做在**组外**：调用瞬间在 composer 上方（`conversation.input.dock`）出聚焦条（点「立即体验」→ 全屏打开），同时喂 autoStore 让 turn 尾部卡照样浮现；工具行内卡片保留作留痕 | ✅ |

## 演化方向

| # | 方向 | 结论 | 状态 |
| --- | --- | --- | --- |
| ① | TUI 降级本地端口 | 用户：先挂着，不预留抽象；若成为真需求则**重构**处理，届时再统一「HTTP POST + 一次性 token」回传通道 | ⏸ |
| ② | 任意后端 | 阶段化推进：多文件静态 → 有限定要求的后端（调研阿里 meoo、Kimi App 等）→ 完整后端进程；详见 roadmap | ✅(方向) |
| ③ | 双向事件流 | 采纳修正：只做「webapp 订阅宿主事件流」；「模型随时主动推」（Agent 常驻化）从路线图删除 | ✅ |
