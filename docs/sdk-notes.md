# SDK 侦查笔记（dsh-web-app 实现用 API 小抄）

> 证据路径约定：`@deepseek-ai/*` 均相对 `.scratch\dsh-src\dsh\node_modules\@deepseek-ai\`；`compact-manager` 相对 `D:\vibe_coding_projects\dsh-compact-manager\`；`genui` 相对 `C:\Users\huama\.dsh\profiles\desktop\node_modules\@changfenhuang\dsh-genui\`。
> 所有结论均附代码证据；拿不准的明确标「未证实」。

---

## 1. webServer 路由的鉴权（Q1，生死攸关）

**结论：插件自己 `webServer.register` 的路由没有任何鉴权——iframe 直接 `src="/dsh-web-app/apps/<name>/"` 可以不带任何凭证拿到 200。有鉴权的只有 `/api` 前缀（client-connection 挂载）和 SPA index.html 本身。**

### 路由匹配与处理管线

- `WebServer` 是裸 `node:http` server：每个请求先查 exact 表 → 最长前缀表 → fallback（SPA dist 伺服）。**命中任何插件注册的路由就直接交给 handler，全程无 token/会话校验。**
  证据：`dsh-host-webserver/lib/index.js:229-245`（handle：`const route = this.match(rawPath); if (route) { await route.handler(req,res); return; }`）、`:322-332`（match：exact → longest-prefix）。
- 绑定地址只允许 `127.0.0.1` 或 `0.0.0.0`。桌面 GUI 的 19387 端口即该 server（`dsh-desktop-host/lib/index.js:231-235` 固定 `--port 19387`）。默认回环绑定 ⇒ 「无鉴权」的实际暴露面是本机进程；但若以 `0.0.0.0` + `trustedHosts` 做 LAN 部署，任何人都能访问插件路由——我们的路由会伺服用户 HTML，属于暴露面，需靠设计中的「按次发票 token」兜底。
  证据：`dsh-host-webserver/lib/index.js:141-147`（Config host union）、`dsh-client-connection/lib/index.js:127-141`（trustedHosts 只作用于 /api 的 fence，注释明说 "this fence is not an auth layer"）。

### /api 前缀（特殊，有鉴权）

- `client-connection` host 插件注册 `{kind:'prefix', path:'/api'}`，handler 先 `connection.admit(req)`：Host/Origin fence（Host 必须 loopback/trusted、`sec-fetch-site: cross-site` 拒绝、Origin 必须同 authority）→ 再验签名 cookie（`dsh-auth-*`，HttpOnly + SameSite=Strict，由 `/?token=<launchToken>` 303 交换发放）。不过则 401/403。
  证据：`dsh-client-connection/lib/index.js:586-594`（requestRejection/admit）、`:829-844`（/api 路由注册 + admit）、`:388-451`（authorizeIndex / isAuthenticated / writeUnauthorized）、`:205-219`（isTrustedApiRequest）。
- 推论：**`connection.fetch.register` 的 exact 路由全部挂在 `/api` 之下**（路径必须以 `/api/` 开头，断言见 `:758-762`），因此它们需要 GUI 页面的签名 cookie。GUI 页面内同源 `fetch('/api/...')` 会自动带 cookie（compact-manager 就是这么干的，`compact-manager/lib/client.js:22-23,305`）。但 **sandbox iframe（无 `allow-same-origin`）是 opaque origin**，它发出的请求若带 `Origin: null` 会被 fence 拒（`dsh-client-connection/lib/index.js:212-218`）；GET 不带 Origin 能过 fence 但过不了 cookie 401。**⇒ webapp 的 iframe 不要走 `/api`，全部数据通道放插件自己的 `webServer` 前缀路由**（如 `/dsh-web-app/api/...`，无鉴权，靠门票 token）。
- SPA index.html 也要求 cookie/token 交换；**非 index 静态资源公开**。
  证据：`dsh-host-frontend-static/lib/index.js:49-75`（`authorizeIndex` 只包 index）、`:87-96`。

### client 如何合法获得带凭证 URL

- `ctx.connection.authenticatedUrl(baseUrl)` 把进程 launch token 写成 `?token=` 拼到 URL 上；仅 host 侧可用（`dsh-desktop-host/lib/index.js:337`、`dsh-web-app(官方)/lib/index.js:198-206` 打印/打开浏览器用）。**client（浏览器）侧没有对应 API**——也不需要：页面本身已持 cookie。
  证据：`dsh-client-connection/lib/index.js:374-378,600-602`。
- `window.__DSH_BOOT__` 由 `webserver/index-inject` 行渲染进 index.html（`kind:"global"` 行 → `<script>globalThis["__DSH_BOOT__"]=...</script>`），它是 client 插件图（不是凭证）。
  证据：`dsh-host-webserver/lib/index.js:24-52`（renderRow）、`dsh-client-modules/lib/client.js:108-173`（parseBootManifest）。

### 最小示例（host 半静态伺服 + 盖章）

```js
ctx.effect(() => ctx.webServer.register({
  kind: 'prefix',
  path: '/dsh-web-app/apps',          // 匹配 /dsh-web-app/apps/<name>/...
  handler: async (req, res) => {     // node 风格 req/res，无鉴权层
    // 读 registry → 按 deployedRef 读文件 → 替换 {{__TOKEN__}} 等占位符 → res.end(html)
  },
}), 'dsh-web-app: app route')
```

坑：
- 重复注册同 (kind,path) 会 throw（`dsh-host-webserver/lib/index.js:177-184`）。
- 路由只按 pathname 匹配（query 不参与，`new URL(req.url,'http://x').pathname`，`:232`）。
- 前缀匹配要求 `pathname === prefix || pathname.startsWith(prefix + '/')`（`:327-328`）——裸 `/dsh-web-app/apps`（无尾斜杠）也匹配。
- 压缩：`compression: 'gzip'` 时由 server 级 middleware 处理（`:106-131`），与路由无关。
- `/api` 是保留前缀：插件不能注册名为 `/api` 的 rpc channel（`dsh-client-connection/lib/index.js:755-757`），但注册 `/api/xxx` 的 **webServer exact 路由会 shadow** connection 的共享 handler（exact 表优先）——别这么干。

---

## 2. host.call 的 host 侧应答（Q2）

**结论：`host.call(method,args)` 只存在于「dynamic Cordis 包」的 client 半（evaluator 用 `new Function` 注入 `React/console/styles/host/harness` 等闭包参数）；手写 classic-script 插件（本项目形态，同 compact-manager/genui）拿不到 `host` builtin。机制存在且可用（HTTP POST `/api/dynamicCordisRunner/invoke`，host 半用 `harness.handle(method, fn)` 注册），但不适合本项目——推荐替代：插件自己注册 `webServer` JSON 路由（iframe 内 `fetch('/dsh-web-app/rpc/...')`）或 client 半 `fetch('/api/...')` 走 connection.fetch。**

### 机制细节（dynamic 包专用）

- client 半函数签名：factory/evaluate 形参含 `host`；`host.call(method, args)` → `env.invoke(pluginId, pluginRunId, method, args)` → `ctx.remote.dynamicCordisRunner.invoke(...)` → HTTP POST 同域 `api/dynamicCordisRunner/invoke`（unary 走 HTTP，WebSocket 只用于 `/api/remote.mux` stream mux）。信封 `{type:'client-request',rpcId,method,payload}` / `{type:'server-response',rpcId,result:{ok,value}|{ok:false,error}}`。
  证据：`dsh-cordis-client-runner/lib/client.js:54-55,66-70,152-181,535,6162-6164,6539-6560,6603-6611`、`dsh-api-gateway/lib/client.js:1785-1807,2043-2045`、`dsh-client-connection/lib/client.js:1209-1239,1288-1312`。
- host 半注册 API：`harness.handle(method, fn)`（**没有** `registerMethod`）。校验 method 非空 string、fn 为 function；返回 dispose。fn 只收一个参数（wire JSON 解码后的 args，省略为 null），**不注入 ctx**——需闭包捕获 host 半 `apply(ctx)` 的 ctx。返回值经跨 realm JSON 克隆（返回 `undefined` 报错，建议 `return null`）。错误码：`plugin-not-running / stale-run / method-not-found / handler-error`。
  证据：`dsh-cordis-host-runner/lib/index.js:525-533,1207-1224,2115-2148,2264-2279`、`dsh-cordis-host-runner/lib/types/guard.js:540-552`、`dsh-api-gateway/lib/index.js:624,631-643`。
- **第三方实证**：genui 源码 0 处用 `host.call`；它走 `ctx.inject` + host 半 `webServer.register({kind:'prefix',...})` 伺服资产。证据：`genui/src/plugin/index.ts:216-222`。
- 死胡同备忘：`dsh-client-modules` 是 client 模块加载器，与 RPC 无关；`dsh-sdk-jsonrpc-server` 是进程外 SDK 的 stdio JSON-RPC，插件用不上。

### 推荐替代（本项目）

client 半（classic script）⇄ host 半通信，二选一：
1. **webServer JSON 路由**（推荐，iframe 内可用）：host 半 `ctx.webServer.register({kind:'prefix', path:'/dsh-web-app/rpc'})`，client 半（卡片组件，非 iframe）`fetch('/dsh-web-app/rpc/list')`；iframe 内部也可用（同源、无 cookie 要求）。
2. **connection.fetch**：host 半 `ctx.connection.fetch.register({path:'/api/dsh-web-app/state', methods:['GET'], requestBody:'buffered', fetch})`；client 半卡片组件里 `fetch('/api/dsh-web-app/state')`（cookie 自动携带）。**iframe 内不可用**（sandbox opaque origin）。

---

## 3. 插件数据目录（Q3）

**结论：没有「插件数据目录」cordis 服务。第一方约定是 `$DSH_HOME/<package-name>/`（纯函数库 `dsh-home-paths` 解析 home，README 明说 "Use it as a direct library dependency, not through cordis.yml"）。本项目用 `dshHomePath('dsh-web-app', 'apps', name)` 放 Git 仓库。**

- `dsh-home-paths` 是纯库（非服务），导出：`resolveDshHome(configured?, env?)`、`dshHomePath(...segments)`、`dshCachePath(seg?, ...)`、`expandHomePath(p)`、`dshHomeDisplay(home)`。
  优先级：显式 configured > `$DSH_HOME` 环境变量（空白视为未设）> `~/.dsh`（Windows 即 `%USERPROFILE%\.dsh`）。
  证据：`dsh-home-paths/lib/index.js:11-15,49-51,73-84`；`dsh-home-paths/README.md:31-41`。
- 第一方使用先例（均为直接 import + `join(resolveDshHome(), '<name>', ...)`）：
  - `dsh-llm-deepseek/lib/index.js:804` → `$DSH_HOME/llm-deepseek/files-v3.json`
  - `dsh-desktop-host/lib/index.js:329` → `$DSH_HOME/dsh-runtimes/dsh-primary-runtime`
  - `dsh-credentials-local/lib/index.js:58` → `$DSH_HOME/.credentials.yaml`
  - `dsh-attachment-local/lib/index.js:995-997` → `$DSH_HOME/cache/attachments`
  - 配置式 home：`dsh-agent-instructions/lib/index.js:69`、`dsh-shell-env/lib/index.js:50`（`resolveDshHome(config.dshHome)`）。
- Profile（桌面 GUI 实例）目录是 `$DSH_HOME/profiles/<name>`，插件装在 profile 的 `node_modules` 下。证据：`dsh-app-boot/lib/index.js:466-485,524-526`。

### 推荐用法（host 半）

```js
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
const appsRoot = dshHomePath('dsh-web-app', 'apps')   // <home>\dsh-web-app\apps\<name>\
```
- 跨会话共享 ✔（home 级，不在 profile 下）；随 `$DSH_HOME` 迁移 ✔；harness 升级不影响 ✔。
- 坑：`dshHomePath` 只算路径不建目录（`README.md:41`）；目录创建/权限归插件。若不想依赖该包，fallback = `join(os.homedir(), '.dsh', 'dsh-web-app', 'apps')`，但会漏掉 `$DSH_HOME` 覆盖（**不推荐**，标「备用方案」）。
- 备选：compact-manager 用 `ctx.storageDomain.open(domain)` 做 JSON 持久化（适合注册表 registry.json！），但它是 KV 表不是文件系统，放不了 Git 仓库。证据：`compact-manager/lib/index.js:120-127`（`storageDomain` 服务）。**建议：registry.json 用 storageDomain 或 home 下 JSON 文件均可；apps/<name>/ Git 仓库必须落文件系统 ⇒ dshHomePath。**

---

## 4. classic-script client 的模块加载（Q4）

**结论：`window.__ModuleLoader__.load({id, factory:(require)=>...})` 的 require 解析顺序 = ① seed（平台种子表）→ ② 已物化缓存 → ③ boot 图行（其他插件包）→ ④ 已注册 factory；找不到即 throw。builtin（React/host/styles/console）对 static bundle 插件而言：React 从 seed require；`host`/`styles` 拿不到（dynamic 包专属，见 Q2）；CSS 靠 `<style data-plugin>` 约定。`dsh.client.inject` = 「本包加载前必须先到达（arrive）这些包」的图依赖，不是 seed 白名单。**

### require 可解析清单

- **seed 表**（shell 在页面引导时注入 `__ModuleLoader__` seeds；第一方 web bundle 的种子见 dist）：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。
  证据：`dsh-web-frontend/dist/assets/index-5SrrfWpU.js:126`（`rM()` 返回的种子表）；解析顺序见 `dsh-client-modules/lib/client.js:24-31`（"seed word → shell instance; memoized record → exports; graph row → ...; registered factory → materialize; anything else → throw"）。
- **其他 client 插件包**：`require('<pkg>/client')` 或裸包名归一化到同一 exports（`stripClientSuffix`，`dsh-client-modules/lib/client.js:98-100`）。图由 `window.__DSH_BOOT__.entries`（id/url/rev/inject/external）驱动；classic script 按 url 加载后必须先 `__ModuleLoader__.load({id})` 注册 factory，否则报 "loaded without registering"。证据：`dsh-client-modules/lib/client.js:108-173,610-641`。
- **`host`/`styles`/`console` builtin 不是 require 出来的，静态 bundle 插件拿不到**：它们只是「dynamic Cordis 包」client 半的 `new Function` 闭包形参（`dsh-cordis-client-runner/lib/client.js:152-181`，形参表 `React, console, styles, host, harness`；`styles.insert(css)` 实现 `:71-105`，tag 带 `data-dyn`）。classic script 的 factory 只收一个 `require` 参数（`compact-manager/lib/client.js:15-18`），compact-manager/genui 全篇只用 `require('react')`。
- factory 的 `id` **必须等于 package.json 的 name**（`stripClientSuffix(registration.id)` 即 ownerId，参与 styles 认领与重载）。证据：`dsh-client-modules/lib/client.js:569-580`。
- `require.async(spec)`：非 `./` 开头走异步 import（可等晚到达的包）；`./chunk` 走包内 chunk（文件名须匹配 `client.*.js`）。证据：`dsh-client-modules/lib/client.js:707-713,470`。

### `dsh.client.inject` 的语义（加载顺序保证）

- 校验：`{platform: string, inject?: string[], external?: string[], immediately?: boolean}`。证据：`dsh-client-modules/lib/client.js:61-75`。
- 行为：图到达（arriveGraphRow）时**先递归 arrive `row.inject` 里的每个包，再 arrive 自己**——即「我的 client 半运行时，这些包的 bundle 一定已加载」。`external` 则是「require 了但不需要先加载」的弱依赖边（materialize 时才解析）。证据：`dsh-client-modules/lib/client.js:644-661`（`for (const packageName of row.inject) await this.arriveDependency(...)` 在 `await this.arrive(row)` 之前）。
- 对比实证：compact-manager `inject: ['@deepseek-ai/dsh-client-ui-sidebar','@deepseek-ai/dsh-client-ui-layout']`（`compact-manager/package.json:32-38`）；genui `inject: []`。两者都正常——boot 时所有 row 本就属于 initial-load batch（`dsh-client-modules/lib/client.js:160-167` 强制每 row 必有 batch），所以 inject 只在「目标 bundle 可能晚于消费方到达」（post-boot 同步、动态 import）时才必须。**本项目若不 require 其他 client 包，写 `inject: []` 即可。**
- 细则：① host 侧图排序只看 `dsh.client.external`，不看 inject（`dsh-client-modules/lib/index.js:415-437`）；② inject 名字不是 graph row 时**静默跳过**（`dsh-client-modules/lib/client.js:657-659`）；③ 校验仅要求 string 数组（`:66`）。
- `immediately: true`：页面引导后即加载（不等被 import）。证据：`dsh-client-modules/lib/client.js:68,135-139`。

---

## 5. slot 注册精确形状（Q5）

**结论：slot 四种 kind：single/keyed/list/chain。注册走 `ctx.slots.register(options, Component)`（必须已被某父级 children 表声明），`ctx.slots.inject(slotKey, () => disposer)` 挂在声明生命周期上。commandview=keyed(session scope)；panellist=list(id=main key)；main=keyed；shell.overlay=list（全屏浮层用这个，别用 rightbar）。**

### ctx.slots 服务面

- `slots.register: SlotCore['register']`——原型方法，cordis 代理把 `this.ctx` 绑定为**调用方 ctx**，因此 disposal 走调用方 fiber（插件卸载自动注销）。
- `slots.registerFactory(options, component)`——可复用 Factory（store 句柄按渲染实例铸模）。
- `slots.inject(key, callback)`：slot 声明生命周期内运行 callback（已声明则同步跑）；callback 返回 disposer 或可迭代 disposers；声明坍塌自动 dispose、再声明重跑。
证据：`dsh-cordis-client-runner/lib/client.js:1361-1397`（服务目录含完整签名与语义）、`dsh-client-ui-slots/lib/index.js:163-243`（SlotCore.register：kind 校验、key/id/select 必填、重复检测、priority/order 排序）。

### register options 字段语义

| 字段 | 适用 | 语义 |
|---|---|---|
| `name` | 全部 | slot 名（= 注册的 seat） |
| `key` | keyed | 单元键；占用即替换该 key 的渲染器（commandview 用命令名） |
| `id` | list | 单元键；新 id 并排追加，复用 shipped id 会替换它 |
| `order` | list | 升序排位（默认 0） |
| `label` | list 等 | `string \| () => string`；thunk 每次投影重读 ⇒ 语言切换无需重新注册 |
| `priority` | 全部 | 影子优先级，最小者渲染（默认 0） |
| `inject` | 全部 | `(sessionId?) => props`，组件收到的自定义 props（session scope 的 slot 会传 sessionId） |
| `locale` | 全部 | 命名空间标记，消费方渲染 label 时用它取词典（见 Q8） |
| `children` | 全部 | 顺手声明子 slot（动态插件专用，一般不用） |
| `store` | 全部 | 每入口 store 工厂/句柄 |

证据：`dsh-client-ui-slots/lib/index.js:204-219`、`dsh-cordis-client-runner/lib/client.js:2454-2496`（commandview 条目）、`:4816-4870`（shell.overlay 条目）、`:5067-5110`（panellist 条目）。

### 四个注册模板（本项目用）

```js
// ① /webapp 命令卡片 —— keyed，session scope，key=命令名
ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
  name: 'conversation.chat.commandview',
  key: 'webapp',
  locale: NS,
  inject: (sessionId) => ({ sessionId }),   // 组件 props 额外字段
}, WebappCommandCard))
// 组件收到：owner props {node: CommandNode} + inject 的 {sessionId} + standardProps（Q6）
// 证据：dsh-cordis-client-runner/lib/client.js:2454-2496；dsh-client-ui-chat/lib/client.js:6132-6147
// （owner 实际只传 {node}；catalog 里的 compaction? 来自 /compact 专用渲染器，普通命令卡片拿不到）

// ② 侧边栏图标 —— list，id 必须等于 main 面板 key
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
  name: 'sidebar.panellist',
  id: PANEL_ID,            // = main 注册 key
  order: 10,               // 升序；shipped: plugin-manager、schedule 已在列
  locale: NS,
  label: () => t('panel'), // thunk，跟随语言
}, PanelIcon))
// 图标组件 props：{size:number, active:boolean}
// 证据：dsh-cordis-client-runner/lib/client.js:5067-5093；实例 compact-manager/lib/client.js:566-572、
//   dsh-client-ui-schedule/lib/client.js:6804-6810

// ③ 中央管理面板 —— keyed，key = panellist id
ctx.slots.inject('main', () => ctx.slots.register({
  name: 'main',
  key: PANEL_ID,
  locale: NS,
  inject: () => ({ lang }),
}, ManagePage))
// 打开：ctx.layout.selectPanel(PANEL_ID)；selectPanel(null) 回会话；未注册 key 会 throw
// 证据：dsh-cordis-client-runner/lib/client.js:3884-3917、1132-1139；dsh-client-ui-layout/lib/client.js:462-465；
//   实例 compact-manager/lib/client.js:574-579、schedule :6793-6803
// 坑：main 的 replaceRisk=shadows-shipped-ui —— 别注册 key='conversation'。

// ④ 全屏浮层（iframe 放大）—— list，frame 级、点击穿透默认、自担 pointer-events
ctx.slots.inject('shell.overlay', () => ctx.slots.register({
  name: 'shell.overlay',
  id: 'dsh-web-app.fullscreen',
  order: 100,
  locale: NS,
  inject: () => ({ close: () => setOpen(false) }),
}, FullscreenOverlay))
// 证据：dsh-cordis-client-runner/lib/client.js:4816-4870（"frame-wide floating layer... additive seat"）；
//   实例 schedule :6740-6748、workspace 对话框 :4377-4391
// 官方告诫：root slot 千万别注册（动态注册反而 shadow 掉整个 frame）；浮层一律走 shell.overlay。
//   证据：dsh-cordis-client-runner/lib/client.js:4304
```

### rightbar 与「全屏」的正解

- `layout.openRightbar(track: boolean, fullscreen: boolean)`——**两个参数都是布尔**：track=普通宽度是否占网格轨道；fullscreen=面板覆盖整个 frame 并隐藏外把手。**不接收组件**。rightbar 是 single slot，被 client-ui-sidebar-right 的 RightbarRoot 独占，内容走 session 标签页（`sidebarRight.openTab`），不适合任意 iframe 全屏。
  证据：`dsh-cordis-client-runner/lib/client.js:1152-1161,4238-4297`；`dsh-client-ui-layout/lib/client.js` selectPanel 实现 `:462-465`。
- **本项目全屏方案：卡片内状态 + `shell.overlay` 入口**，把 iframe 以覆盖层形式放大；workspace 的重命名/确认对话框就是这么做的（`dsh-client-ui-workspace/lib/client.js:4377-4391`）。

---

## 6. commandview 卡片的 standardProps 与去重器数据源（Q6）

**结论：卡片 props = standardKit（hooks/renderSlot/t/…）→ entry.inject() → ownerProps `{node}` 顺序展开（后者覆盖前者）；`sessionId` 直接是内置 prop。去重器要的三样东西都能从 `useChat` 快照读：最新 turn 号 = `timeline.turnOrder.at(-1)`；结束原因 = 该 turn 的 `end.data.reason.kind`（闭集）；压缩 = 节点里存在 kind 为 `compaction`/`manual-compaction` 的节点。**

### props 组装规则与 node 形状

- `renderSlot("conversation.chat.commandview", owner, {entryKey, fallback})`：`entryKey` 只是分派选项（不作为 prop 传入）；`fallback` 同理。组件实际收到 = kit + inject 结果 + `{node}`。
  证据：`dsh-client-ui-renderer/lib/client.js:752-789`（renderEntry/ContextualEntry）、`:715-746`（standardKit）；`dsh-client-ui-chat/lib/client.js:6130-6147`（CommandNodeView，owner={node: command}）。
- `node`（CommandNode）：`{ kind:'command', seq, time, commandId, name, args, outcome: null | { kind:'success'|'error', text?, sourceEventSeq? } }`。
  证据：`dsh-client-ui-chat/lib/client.js:8910-8939`。
- `sessionId: SessionId` 是内置 prop；session scope 的 `inject` 回调签名 `inject: (sessionId) => ({...})`。
  证据：`dsh-client-ui-session/lib/client.js:121-130`（BUILTIN_SOURCE）、`dsh-client-ui-chat/lib/client.js:12409`。

### 可用 hooks（统一签名 `useX(selector, equality?)`，uSES 选择器）

commandview 的 standardProps 清单（`dsh-cordis-client-runner/lib/client.js:2471-2487`）：`useResource, useWorkspaces, usePanelInfo, useSessions, useSessionStatus, useSessionRetainInfo, useChat, useConversation, useInput, inputActions, useSession, sessionId, useProjection, useTrajectory`。

- `useSession(sel)` → SessionSnapshot `{ sessionId, running, openState, openError, hasMore, loadingOlder, promptError, blank, lastAgentError, promptAttempted, awaitingFirstTurn, pendingSubmissions, removed, subagent }`（是快照不是方法对象）。
  证据：`dsh-api-session-controller/lib/client.js:2273-2297,1950-1960`。
- `useChat(sel)` → ChatSnapshot `{ order: string[], nodes, locations, navigation, timeline, legacy }`；`timeline = { turnOrder: number[], turns: Map<number, Turn> }`；`Turn = { turn, start, end, status:'open'|'closed'|'unknown', steps, data }`，`end` 是原始 `turn/end` 事件 `{type:'turn/end', seq, time, data:{turn, reason}}`；`nodes` 有 `.get(key)`。
  证据：`dsh-client-ui-chat/lib/client.js:12317-12320,8827-8835`；`dsh-client-ui-conversation/lib/client.js:1561-1602`。
- `useProjection(key)`（keyed）→ 具名 projection 值（如 `"inbox"`、`"turnOutline"`）。证据：`dsh-client-ui-session/lib/client.js:123-127`；用法 `dsh-client-ui-chat/lib/client.js:5144-5146`。
- `useChatNode(key, sel)` / `useChatNodeProcess` / `useChatGroup`（keyed）。证据：`dsh-client-ui-chat/lib/client.js:12417-12421`。
- `useConversation(sel)` → 会话分组视图快照；另有 prop `inputActions`。证据：`dsh-client-ui-conversation/lib/client.js:18126-18142`。
- 根级：`useSessions`（list 快照）、`useSessionStatus`（`Map<sessionId, {running, pendingInteraction, completionUnread}>`）、`useWorkspaces`、`useResource`、`usePanelInfo`。
  证据：`dsh-client-ui-session/lib/client.js:469-475,342-358`。
- 坑：`loadOlder/loadThrough` 只在 conversation.view 注册上有，commandview 卡片拿不到。默认相等比较（Object.is?）**未证实**。

### 去重器：turn 号 / 结束原因 / 压缩

- `turn/end` 的 `data.reason` 闭集（host 侧生成）：
  - `{kind:'completed'}` 正常结束
  - `{kind:'max-tokens'}`
  - `{kind:'error', error:{message, code}}`
  - `{kind:'aborted', reason:{kind:'user'|'parent'|'disposed'} | {kind:'hook', reason:string}}`（user = 用户打断）
  - 合成闭包（崩溃恢复/fork）：`{kind:'interrupted'}`、`{kind:'forked'}`
  证据：`dsh-agent-loop/lib/index.js:964,1011-1023,1151-1155,731-745`；`dsh-session/lib/index.js:785-793,905,932`；客户端消费 `dsh-client-ui-chat/lib/client.js:9822,9918,12291`。
- 压缩表示：事件 `compaction/start|summary|end|prune`（带 `compactionId`、`sourceCommandId`）；chat 里折叠成节点 kind `'compaction'`（自动；data 含 `summary/shadowedItemCount/shadowedTokenCount`）或 `'manual-compaction'`（/compact；data={command, compaction}）。checkpoint 是一条 `user/message` 替换事件（`data.source.kind==='compact-checkpoint'`）。
  证据：`dsh-client-ui-chat/lib/client.js:8908-9107`；事件词表 `dsh-api-session-controller/lib/client.js:147-150`。

```js
// —— 去重器可直接用的 selector（模式与官方 ChatView 一致，ChatView 证据 dsh-client-ui-chat/lib/client.js:5130-5143）——
// ① 最新 turn 号 + 结束原因（reason===null → 该 turn 还在跑）
const last = useChat((s) => {
  const n = s.timeline.turnOrder.at(-1)
  if (n === undefined) return undefined
  const t = s.timeline.turns.get(n)
  return { turn: n, reason: t?.end?.data.reason ?? null, status: t?.status }
})
// ② 是否发生过压缩（同一 turn 内去重键失效的依据之一）
const compacted = useChat((s) => s.order.some((k) => {
  const kind = s.nodes.get(k)?.kind
  return kind === 'compaction' || kind === 'manual-compaction'
}))
// ③ 本会话是否在跑：useSession((s) => s.running) 或 useSessionStatus((m) => m.get(sessionId)?.running)
```

设计对照（callback-contract §6）：「同一 turn、未被压缩/打断、payload 严格一致 ⇒ 拦截」⇒ 实现为：提交时记录 `(turn=last.turn, hash(payload))`；重发时若 `last.turn` 未变 且 `last.reason?.kind==='completed'` 且未出现 compaction 节点 且 hash 相同 ⇒ 拦截；`aborted`/`interrupted`/`forked` 或出现过 compaction ⇒ 视为新 turn 照传。

---

## 7. skills.register 落地细节（Q7）

**结论：`content` 直接内联 markdown 全文；`invocation` 默认 `{modelInvocable:true, userInvocable:true}`；name 限 kebab-case。模型看到 skill 是「catalog 消息（list）→ `skill` 工具加载（get）」两层，不是 wire 事件协议。genui 用 `skills.registerProvider` 而不是 `skills.register`（为了 bundled 优先级）。**

### 精确形状（`dsh-skill/lib/index.js`）

`skills.register(skill)`，字段（`:465-490` 校验）：
- `name`：必填，kebab-case `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`（注意：可数字开头，与命令名规则不同）。`:17,466`
- `description`：必填非空 string。`:467`
- `content`：**直接给 markdown 全文 string**（runtime skill 的对象本身就是 definition/locator，get() 返回时跑 validateDefinition，content 必须 string）。`:437-450,488`
- `invocation`：可选 `{modelInvocable, userInvocable}`，**默认双双 true**（`:201-208`）。`modelInvocable:false` → 不进模型目录、skill 工具拒载，只能用户 `/name`；`userInvocable:false` → 不进 `/` 菜单。
- `source`：必填 string（来源标签，不解析；genui 用 `'bundled'`）。`:459,486`
- `path`：可选 string（UI 文件预览用）。`:463,489`
- `resourceBase`：可选闭集 `{kind:'directory',path} | {kind:'url',url} | {kind:'opaque',description}`；模型加载时渲染成 `<skill_resources>` 引导语（告诉模型相对资源怎么解析）。`:54-79`
- `provider`：可选，默认 `'runtime'`（保留名）。`:207`
- `whenToUse`、`metadata`：可选。
- 语义：返回 cordis effect disposer；同层同名 first-wins + warn + no-op disposer（`:193-200`）；层按 host/preset scope 划分，就近层遮蔽；同层优先级 project > runtime > user。
  证据：`dsh-skill/lib/index.js:193-215`；README「Catalog collection / The registry keeps all four combinations」。

### 本项目模板

```js
ctx.effect(() => ctx.skills.register({
  name: 'dsh-web-app-author',
  description: '...',            // 必填，进目录与 / 菜单
  whenToUse: '...',              // 可选，展示给模型/用户
  content: AUTHOR_SKILL_MD,      // markdown 全文，直接内联
  source: 'bundled',
}), 'dsh-web-app: author skill')
```

### genui 的做法（provider 路线，备选）

`ctx.skills.registerProvider(() => bundledSkillProvider())`：provider 从插件安装目录 `readFileSync` 读 SKILL.md、剥 frontmatter（`content: raw.slice(end+5)`），candidate 带 `source:'bundled'`、`path`、`resourceBase:{kind:'directory',path:dirname}`、`rank:600`，`get()` 返回完整 definition。注释说明走 provider 是为了让 source=bundled 也获得 bundled 优先级。
证据：`genui/src/plugin/index.ts:146-178,210-212`。

### 模型何时看到 skill（list → get 两层）

- **第一层（目录）**：首个请求前，若存在 modelInvocable 技能且 `skill` 工具可见，模型收到一条 durable user-role 消息：`<available_skills>`（name + 截断描述，默认 cap 500 字符）+ 「摘要不作指令，要用 skill 工具加载」；目录变化后追加全量替换消息（空目录 = 退役旧名）。证据：`dsh-tool-skill/README`「Session catalog」、`dsh-tool-skill/lib/index.js:45`（catalogDescription）。
- **第二层（加载）**：模型调 `skill` 工具，参数 `{name: string}`（schema `dsh-tool-skill/lib/index.js:60-65`）；返回 `<skill_content name=...>` 包裹的 resourceBase 引导 + 全文指令，作为普通 tool result 留在上下文。错误文案固定三种（invalid / unknown / not model invocable）。
- 用户侧：`/name` 由 dsh-client-ui-skill 提供自动补全（`remote.skills.list({sessionId})`，`dsh-client-ui-skill/lib/client.js:321-345,377-432`）；用户 `/name` 把同样 `<skill_content>` 直接注入。
- **未发现独立的 skill/list、skill/get wire 事件协议**（ctx.skills.list/get 是进程内 API + remote.skills RPC 供 UI）；模型侧协议 = catalog 消息 + skill 工具。

---

## 8. locale（Q8）

**结论：`ctx.locale.register/bind` 只存在于 client 半（host 半没有同名 API）。slot 注册项上的 `locale: NS` 由 dsh-client-ui-renderer 在渲染 entry 时换成 prop `t` 注入组件。**

### 精确签名（dsh-client-locale，client 半）

- `register(ns, localeOrDicts, dict?)`——两种形态：`register(ns, 'zh', dict)` 或 `register(ns, {zh, en})`。locale id 须 BCP-47 式；同 ns 同 locale 重复注册 throw；注册即 bump 快照 revision（已渲染的 outlet 会重取字典）但不发 `locale/change` 事件；返回注销 disposer。
  证据：`dsh-client-locale/lib/client.js:1387-1413,1436-1449`。
- `bind(ns)`——返回按 ns 记忆化的 `t = (key, params?) => string`。查找顺序：active locale 的 fallback 链（链尾恒追加 `'en'`）查本 ns 字典 → 再查公共命名空间 `'common'` → 都没有返回 key 本身；params 做 `{name}` 模板替换。
  证据：`dsh-client-locale/lib/client.js:1414-1428,1369-1385`（fallbackChain 恒追 en）、`:1351-1365`（addLanguage 强制链达 en）。active locale = 用户偏好 ?? `navigator.languages` 探测（`:1461-1495`）。

### 本项目模板（照抄 compact-manager）

```js
ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-web-app: dictionaries')
const t = ctx.locale.bind(NS)
// 组件里：label: () => t('panel')        // slot 注册 thunk，跟随语言
//        lang: t('lang') === 'zh' ? 'zh' : 'en'   // 经 inject 传给组件
```
证据：`compact-manager/lib/client.js:560-579`。

### slot 上 `locale: NS` 的机制

- 注册时原样存进 entry（`dsh-client-ui-slots/lib/index.js:217`）。
- 渲染时 `standardKit`（dsh-client-ui-renderer）检查 `entry.locale`：取 locale face（locale 插件经 `ctx.slots.installLocale` 安装，`dsh-client-ui-renderer/lib/client.js:1418-1433`；安装在 `dsh-client-locale/lib/client.js:1533`），`localeSeat(face, ns)` 生成 `t` 并作为 **prop `t`** 注入组件；`t` 按 (face, ns, revision) 缓存，语言切换换 revision 使 React.memo 失效。声明了 locale 但 face 未装 → throw SlotAssemblyError。
  证据：`dsh-client-ui-renderer/lib/client.js:715-725,521-537,928-931`。
- 坑：组件必须能接收 `t` prop（第一方组件都接 `{ t, ... }`）；不用 `t` 而自己 bind 也行（compact-manager 的 main 面板就是自己 bind 后 inject `lang`）。

---

## 9. CSS 注入与主题 token（Q9）

**结论：静态 classic bundle 的推荐做法 = 在 factory 闭包里创建 `<style data-plugin="<包名>" data-plugin-css="<包名>/<file>.css">` 插到 document.head（按 data-plugin-css 去重）；插件卸载/HMR 时 client-modules 按 `data-plugin` 属性自动清理。`styles.insert(css)` 是 dynamic 包专属 builtin，静态插件没有。全部颜色用 `var(--dsw-alias-*, <回退>)`。**

### 注入机制

- 第一方全部 148 处同款：bundler 内联 CSS 文本，物化时建 tag。证据：`dsh-client-ui-sidebar/lib/client.js:13-21,91-99`；theme 包自身也走此通道 + `ctx.effect` cleanup（`dsh-client-ui-theme/lib/client.js:1181-1193`）。
- 归属规则：物化期间创建的未打标 `<style>` 会被 `claimStyles` 补打 `data-plugin=ownerId`（`dsh-client-modules/lib/client.js:489-496`）；卸载时 `removeOwnedStyles` 按 `data-plugin` 删除（`:194-197`）。⇒ 手写插件在 factory 里 `document.head.appendChild(styleEl)` 并自己打上 `el.dataset.plugin = '<包名>'`、`el.dataset.pluginCss = '<包名>/main.css'` 即可获得官方同款生命周期（若想利用自动清理；不打车标也能工作，只是插件被卸载/HMR 时样式残留）。
- compact-manager 没有用 style 标签（全 inline style 对象 + var() 引用），等价可行。证据：`compact-manager/lib/client.js:150-174`。

### 常用 `--dsw-alias-*` token（定义：`dsh-client-ui-theme/lib/client.js:1148`；官方目录含描述：同文件 `BUILTIN_INSPECT_TOKENS` :1234-1333）

| 类别 | token |
|---|---|
| 背景 | `--dsw-alias-bg-base`、`--dsw-alias-bg-layer-1/2/3`、`--dsw-alias-bg-overlay`、`--dsw-alias-bg-module-platform`、`--dsw-alias-bg-skeleton` |
| 文字 | `--dsw-alias-label-primary`、`--label-secondary`、`--label-tertiary`、`--label-caption` |
| 边框 | `--dsw-alias-border-l1/l2/l3/l4`（l1 最浅） |
| 状态 | `--dsw-alias-state-error-primary`、`--state-warn-primary`、`--state-success-primary`、`--state-business-primary`（焦点环/强调色）、`--state-warn-tertiary`（警告底） |
| 品牌/交互 | `--dsw-alias-brand-primary`、`--link`、`--interactive-bg-hover`、`--interactive-bg-hover-danger` |

- light 定义在 `body{...}`，dark 覆盖在 `body[data-ds-dark-theme]`（同 :1148）——同一个 var 名自动跟主题。
- 实用写法（第三方实证）：`color: var(--dsw-alias-state-error-primary, #ff6b6b)` 带硬编码回退。证据：`compact-manager/lib/client.js:169-172`。
- 第三方主题还能 `ctx.theme.overrideTokens(source, tokens)` 叠层（本项目用不到）。

---

## 10. CommandDefinition 细节（Q10）

**结论：`recordInput` 默认 true（`command/run` 带 `args: rawInput` 原始输入串）；`success.text` 写进 `command/done` 事件 → 节点 `outcome.text` → 卡片折叠行摘要（含 `\n` 可展开 `<pre>`）；invocation 没有 sessionId，用 `invocation.agent.session.id`；命令定义没有 agent 字段，per-agent 靠挂载位置。**

### 字段全表（`dsh-commands/lib/index.js:149-182` 校验）

- `name`：必填，`/^[a-z][a-z0-9_-]*$/u`（小写字母开头；可含数字 `_` `-`）。`:78,150`
- `description`：必填非空 string。
- `handler`：必填函数。
- `definitionId`：可选，`CommandDefinitionId('<插件命名空间>')` 品牌字符串——稳定身份供 UI 发现，与执行期 commandId 无关。`:166`；示例 `dsh-command-compact/lib/index.js:94`。
- `input`：可选 `{ hint: string 非空, attachments?: true }`。`attachments:true` 声明后才接受图片/文件附件（executor 强制，`:352-378`）。
- `recordInput`：可选 bool，**默认 true**。true ⇒ `command/run` 事件带 `args: parsed.rawInput`（命令名后的原始输入，含分隔空白）；false ⇒ 不带（适用自己的领域事件已带输入的场景，如 feedback）。`:334-339`；`recordInput:false` 实例 `dsh-command-feedback/lib/index.js:170`；README 明说默认 true。
- **没有 agent 参数字段**。agent scope = 把（注入了 commands 的）插件挂在 `agent.ctx` 下注册，同名命令仅对该 agent 遮蔽全局定义（ScopedLayers，按 scope 分层、就近遮蔽）。证据：`dsh-commands/lib/index.js:89,249,266-269,423-425`（`view(agent) = layers.merge(agent, ...)`）、README「Agent-scoped commands」。本项目全局注册 `/webapp` 即可，不需要 agent scope。

### handler 与 invocation

- invocation（frozen）：`{ commandId, agent, rawInput, attachments, signal }`。**无 invocation.sessionId**；会话 id 用 `invocation.agent.session.id`（Agent 对象带 `.session`）。
  证据：`dsh-commands/lib/index.js:379-385`；`dsh-command-feedback/lib/index.js:94-97`（`invocation.agent.session` / `.id`）；`dsh-command-compact/lib/index.js:55`。
- 返回值：`{kind:'success', text?, sourceEventSeq?}`（text 可选；sourceEventSeq 指向更早的权威领域事件）或 `{kind:'error', text}`（text 必填非空）；抛异常/中止自动 settle 为 command/done error。`:184-204,397-407`
- `success.text` 显示位置：`command/done`.text → chat command 节点 `outcome.text` → GenericCommandCard 折叠行摘要（单行 shimmer），含 `\n` 时可展开 `<pre>` 正文。证据：`dsh-commands/lib/index.js:341-346`；`dsh-client-ui-chat/lib/client.js:8934-8938,6047-6054`。
  ⇒ 本项目：`/webapp` 的 handler 返回 text 会显示在我们的 keyed 卡片（key='webapp'）里——卡片自己渲染 `node.outcome` 即可；text 也适合放「部署完成」类回执，但模型看不到（不触发模型调用，见 mvp-design §5）。
- 生命周期：execute() 先 append `command/run`（`{commandId, name, args?, source:{kind:'user'}}`）→ handler → `command/done`；**无 turn 包裹**（命令节点不进 turn）；语法错/未知命令返回 undefined 且不记日志。commandId 形如 `cmd-<instanceToken8>-<单调序号>`。`:327-395,409-412`

### 本项目模板（host 半）

```js
ctx.effect(() => ctx.commands.register({
  name: 'webapp',
  description: '在对话内嵌打开一个 webapp（不触发模型调用）',
  input: { hint: '应用名（可选，深链）' },
  // recordInput 默认 true：/webapp my-app 会在 command/run 带 args='my-app'
  handler: async (invocation) => {
    const sessionId = invocation.agent.session.id
    const name = invocation.rawInput.trim() || null
    // 校验存在性 → 返回卡片初始数据或错误
    return { kind: 'success', text: name ? `打开 ${name}` : '选择应用' }
  },
}), 'dsh-web-app: /webapp')
```
