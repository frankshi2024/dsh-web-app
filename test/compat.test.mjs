/**
 * compat.test.mjs — DSH（harness）升级后的兼容性校验。
 *
 * 本插件依赖宿主的一批未冻结表面（Slots 名称/范围/owner props、标准 props、
 * 客户端装载器、patch 机制……）。每次 DSH 升级后跑一遍本文件即可逐项核对：
 *
 *   node --test test/compat.test.mjs
 *
 * 环境变量：
 *   DSH_ASAR    打包版 app.asar 路径（默认 D:\DeepSeek Harness\resources\app.asar）；
 *               找不到时静态检查整组 skip（CI/无 DSH 环境下 node --test 仍然全绿）。
 *   DSH_GUI_URL 运行中的 GUI 地址（如 http://127.0.0.1:51157）；给出时追加线上探针
 *               （/api/health、/api/list、铸票→伺服全链路），这是 host 半身的权威证明。
 *
 * 检查项与 docs/sdk-notes.md 的契约清单一一对应；契约变更时先改测试再改实现。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { openAsar } from '../scripts/asar.mjs'

const ASAR_PATH = process.env.DSH_ASAR ?? 'D:\\DeepSeek Harness\\resources\\app.asar'
const GUI_URL = process.env.DSH_GUI_URL ?? ''
const asarAvailable = fs.existsSync(ASAR_PATH)
const skipStatic = asarAvailable ? {} : { skip: `找不到 ${ASAR_PATH}（可用 DSH_ASAR 指定）` }

/* ---------------------------------------------------------------- *
 * 静态层：直接读打包产物（asar），核对 client 半身依赖的宿主表面。
 * 断点大多是"静默坏掉"的类型（槽位改名、props 换形），必须显式 grep。
 * ---------------------------------------------------------------- */
let asar = null
const bundles = {}
if (asarAvailable) {
  asar = openAsar(ASAR_PATH)
  for (const pkg of ['dsh-client-ui-chat', 'dsh-client-ui-conversation', 'dsh-client-ui-tool', 'dsh-client-ui-renderer', 'dsh-cordis-client-runner']) {
    bundles[pkg] = asar.readText(`dsh/node_modules/@deepseek-ai/${pkg}/lib/client.js`)
  }
}

test('compat: asar 可解析，harness 版本可读', { ...skipStatic }, (t) => {
  const root = JSON.parse(asar.readText('dsh/package.json'))
  const core = JSON.parse(asar.readText('dsh/node_modules/@deepseek-ai/dsh/package.json'))
  t.diagnostic(`desktop-runtime: ${root.name}@${root.version}`)
  t.diagnostic(`harness core: @deepseek-ai/dsh@${core.version}`)
  assert.match(core.version, /^\d+\.\d+\.\d+/)
})

test('compat: 五个 client 包均存在且带 lib/client.js', { ...skipStatic }, () => {
  for (const [pkg, text] of Object.entries(bundles)) {
    assert.ok(typeof text === 'string' && text.length > 10000, `${pkg} 缺失或异常`)
  }
})

test('compat: chat bundle — turnTail/commandview/TurnLocation/折叠策略', { ...skipStatic }, () => {
  const chat = bundles['dsh-client-ui-chat']
  // turn-tail 槽位仍在 TurnTailNodeView 中渲染
  assert.ok(chat.includes('renderSlot("conversation.chat.turnTail"'), 'turnTail renderSlot 消失')
  // owner prop turn 仍是 TurnLocation 对象（0.1.0 曾在此踩坑：误当数字）
  assert.ok(chat.includes('node.location.turn : void 0'), 'turn 不再是 location.turn 对象形态')
  // turn-process 折叠策略仍在（show 聚焦条设计的依据）
  assert.ok(chat.includes('foldCompletedTurns'), 'foldCompletedTurns 策略消失')
  assert.ok(chat.includes('conversation.chat.commandview'), 'commandview 槽位消失')
})

test('compat: conversation bundle — input.dock 声明（watcher/聚焦条的家）', { ...skipStatic }, () => {
  assert.ok(bundles['dsh-client-ui-conversation'].includes('conversation.input.dock'))
})

test('compat: tool bundle — toolview 槽位与 disclosure 传递', { ...skipStatic }, () => {
  const tool = bundles['dsh-client-ui-tool']
  assert.ok(tool.includes('tool.call.toolview'), 'tool.call.toolview 槽位消失')
  assert.ok(tool.includes('useDisclosure'), 'useDisclosure 传递链消失')
})

test('compat: renderer bundle — standardProps 构建器（sessionId/useChat 来源）', { ...skipStatic }, () => {
  assert.ok(bundles['dsh-client-ui-renderer'].includes('standardProps'))
})

test('compat: runner 槽位目录 — 我们注册的 7 个槽位 + 契约描述', { ...skipStatic }, () => {
  const runner = bundles['dsh-cordis-client-runner']
  for (const slot of [
    'conversation.chat.commandview',
    'conversation.chat.turnTail',
    'tool.call.toolview',
    'conversation.input.dock',
    'sidebar.panellist',
    'shell.overlay',
  ]) {
    assert.ok(runner.includes(slot), `槽位目录缺少 ${slot}`)
  }
  // turnTail ownerProps 仍声明为 TurnLocation；标准 props 仍含 useChat/sessionId
  assert.ok(runner.includes('TurnTailOwnerProps'), 'TurnTailOwnerProps 契约描述消失')
  assert.ok(runner.includes('useChat: UseChat'), 'standardProps 缺少 useChat')
  assert.ok(runner.includes('sessionId: SessionId'), 'standardProps 缺少 sessionId')
})

test('compat: web shell bundle 存在且含 __ModuleLoader__（client 装载前提）', { ...skipStatic }, () => {
  const entry = asar.list('dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/').find((p) => /index-[^/]+\.js$/.test(p))
  assert.ok(entry !== undefined, 'web-frontend 入口 bundle 缺失')
  assert.ok(asar.readText(entry).includes('__ModuleLoader__'), 'web shell 不再暴露 __ModuleLoader__')
})

test('compat: 收尾', { ...skipStatic }, () => { asar.close() })

/* ---------------------------------------------------------------- *
 * 线上层：GUI 在跑时核对 host 半身的真实装载结果（权威证明）。
 * ---------------------------------------------------------------- */
const skipLive = GUI_URL !== '' ? {} : { skip: '未提供 DSH_GUI_URL，跳过线上探针' }

test('live: /api/health —— 插件已装载且 skills 注册成功', { ...skipLive }, async () => {
  const body = await fetch(`${GUI_URL}/dsh-web-app/api/health`).then((r) => r.json())
  assert.equal(body.ok, true)
  assert.equal(body.skills?.state, 'registered', `skills 未注册：${body.skills?.detail ?? ''}`)
})

test('live: /api/list —— 注册表可读', { ...skipLive }, async () => {
  const body = await fetch(`${GUI_URL}/dsh-web-app/api/list`).then((r) => r.json())
  assert.equal(body.ok, true)
  assert.ok(Array.isArray(body.apps))
})

test('live: 门票全链路 —— POST /load 铸票 → GET 伺服盖章消费', { ...skipLive }, async (t) => {
  const list = await fetch(`${GUI_URL}/dsh-web-app/api/list`).then((r) => r.json())
  const app = list.apps?.[0]?.name
  if (!app) { t.skip('注册表为空，跳过'); return }
  const load = await fetch(`${GUI_URL}/dsh-web-app/api/load`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: app }),
  }).then((r) => r.json())
  assert.equal(load.ok, true)
  assert.ok(load.load?.url?.includes('load='), '门票 URL 缺 loadId')
  const page = await fetch(`${GUI_URL}${load.load.url}`)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /<meta name="dsh-web-app"/)
})
