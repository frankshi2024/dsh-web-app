/**
 * dsh-web-app — HTTP JSON 通道（webServer 前缀路由，无鉴权、绝不设 CORS 头）。
 *
 * 为什么能无鉴权（sdk-notes §1）：插件自己 webServer.register 的路由本就没有
 * 鉴权层，默认回环绑定 ⇒ 暴露面是本机进程。回传防伪不靠这里，靠门票 token
 * （serv.js 伺服时盖章）+ 用户确认（callback-contract §5）。
 *
 * 路由（kind: prefix, path: /dsh-web-app/api）：
 *   GET  /dsh-web-app/api/list           → { ok, apps }（listApps，现场解析指针）
 *   GET  /dsh-web-app/api/app?name=      → { ok, app }（template/app.json 从 git 读，降级工作树）
 *   POST /dsh-web-app/api/load  {name}   → 铸门票 { ok, load:{loadId,token,url,version} }
 *   POST /dsh-web-app/api/delete {name}  → 移除注册表 + 删目录
 *
 * 门票：loadId/token 都是 crypto.randomUUID()；内存 Map，键 loadId，值
 * { name, token, createdAt, consumed }；>10 分钟清扫一次（含 interval + 每次请求顺扫）。
 * consumeTicket 导出给 serve.js：存在、同名、未消费、未过期 → 标记消费并返回 token。
 *
 * body 解析上限 1MB；一切错误 { ok:false, error } + 合适 status；不加任何 CORS 头。
 */

import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { appDir } from './paths.js'
import { loadRegistry, saveRegistry, getApp, removeApp, listApps } from './registry.js'
import { showFile, headCommit, shortCommit } from './git.js'
import { validateName } from './validate.js'
import { skillsStatus } from './skills.js'

const PREFIX = '/dsh-web-app/api'
const TICKET_TTL_MS = 10 * 60 * 1000
const BODY_LIMIT_BYTES = 1024 * 1024
const SWEEP_INTERVAL_MS = 60 * 1000

/** @type {Map<string, {name:string, token:string, createdAt:number, consumed:boolean}>} */
const tickets = new Map()

/** 清扫过期/已消费票据。 */
function sweepTickets() {
  const now = Date.now()
  for (const [loadId, ticket] of tickets) {
    if (ticket.consumed || now - ticket.createdAt > TICKET_TTL_MS) tickets.delete(loadId)
  }
}

/**
 * 消费一张加载门票（serve.js 在盖章前调用）。
 * @param {string|null|undefined} loadId - URL query 里的 load。
 * @param {string} name - 正在伺服的应用名（防多实例串话）。
 * @returns {string|null} 有效 → 该次加载的 token；否则 null。
 */
export function consumeTicket(loadId, name) {
  if (typeof loadId !== 'string' || loadId === '') return null
  const ticket = tickets.get(loadId)
  if (ticket === undefined) return null
  if (ticket.consumed) return null
  if (ticket.name !== name) return null
  if (Date.now() - ticket.createdAt > TICKET_TTL_MS) {
    tickets.delete(loadId)
    return null
  }
  ticket.consumed = true
  return ticket.token
}

/** 写 JSON 响应。绝不设 CORS 头。 */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/** 读取并解析 JSON body（上限 1MB）。超限后继续排空（drain）请求流——
 * 不能 req.destroy()：那会掐断响应要走的同一条 socket。 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let failed = false
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT_BYTES) {
        if (!failed) {
          failed = true
          reject(Object.assign(new Error('请求体超过 1MB 上限'), { status: 413 }))
        }
        return // 超限时丢弃数据但继续消费，让 'end' 能到达、响应能发出
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (failed) return
      if (chunks.length === 0) return resolve(null)
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

/**
 * 注册 JSON API 路由；返回 disposer（含清扫定时器）。
 * @param {object} ctx - cordis context（需 ctx.webServer、ctx.logger）。
 */
export function registerJsonApi(ctx) {
  const warn = (message) => ctx.logger?.warn?.(message)

  const disposeRoute = ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      try {
        await handleRequest(req, res, warn)
      } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : 500
        sendJson(res, status, { ok: false, error: error?.message ?? String(error) })
      }
    },
  })

  const timer = setInterval(sweepTickets, SWEEP_INTERVAL_MS)
  timer.unref?.()
  return () => {
    clearInterval(timer)
    disposeRoute()
  }
}

/** 分发请求。 */
async function handleRequest(req, res, warn) {
  sweepTickets()
  const url = new URL(req.url, 'http://dsh-web-app.local')
  const route = url.pathname === PREFIX || url.pathname === `${PREFIX}/`
    ? ''
    : url.pathname.slice(PREFIX.length)

  if (route === '/list' && req.method === 'GET') {
    const reg = await loadRegistry(warn)
    sendJson(res, 200, { ok: true, apps: await listApps(reg) })
    return
  }

  // 自检端点：报告本插件 fiber 内各组件的注册状态（排查「skills 没注入」类问题）。
  if (route === '/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, skills: { ...skillsStatus } })
    return
  }

  if (route === '/app' && req.method === 'GET') {
    await handleGetApp(url, res, warn)
    return
  }

  if (route === '/load' && req.method === 'POST') {
    await handleLoad(await readBody(req), res, warn)
    return
  }

  if (route === '/delete' && req.method === 'POST') {
    await handleDelete(await readBody(req), res, warn)
    return
  }

  sendJson(res, 404, { ok: false, error: `未知路由 ${req.method} ${url.pathname}` })
}

/** GET /app?name=：应用详情；template 与 app.json 从部署指针（git）读，读不到降级工作树。 */
async function handleGetApp(url, res, warn) {
  const name = url.searchParams.get('name')
  if (!validateName(name)) {
    sendJson(res, 400, { ok: false, error: `name 参数不合法：${JSON.stringify(name)}` })
    return
  }
  const reg = await loadRegistry(warn)
  const app = getApp(reg, name)
  if (app === null) {
    sendJson(res, 404, { ok: false, error: `未部署的应用 "${name}"` })
    return
  }
  const dir = app.repoPath
  const branch = app.branch ?? 'main'

  const template = (await showFile(dir, branch, 'callback.template.md'))
    ?? await fs.readFile(join(dir, 'callback.template.md'), 'utf8').catch(() => null)

  let metadata = null
  const fromGit = await showFile(dir, branch, 'app.json')
  const rawAppJson = fromGit ?? await fs.readFile(join(dir, 'app.json'), 'utf8').catch(() => null)
  if (rawAppJson !== null) {
    try {
      metadata = JSON.parse(rawAppJson)
    } catch {
      metadata = null
    }
  }

  const commit = await headCommit(dir, branch)
  const exists = await fs.stat(dir).then((s) => s.isDirectory()).catch(() => false)
  sendJson(res, 200, {
    ok: true,
    app: {
      name,
      description: metadata?.description ?? app.description ?? '',
      confirm: typeof metadata?.confirm === 'boolean' ? metadata.confirm : true,
      variables: Array.isArray(metadata?.variables) ? metadata.variables : [],
      template,
      version: commit !== null ? `${branch}@${shortCommit(commit)}` : branch,
      branch,
      commit,
      exists,
    },
  })
}

/** POST /load {name}：铸一张加载门票。 */
async function handleLoad(body, res, warn) {
  const name = body?.name
  if (!validateName(name)) {
    sendJson(res, 400, { ok: false, error: `name 不合法：${JSON.stringify(name)}` })
    return
  }
  const reg = await loadRegistry(warn)
  const app = getApp(reg, name)
  if (app === null) {
    sendJson(res, 404, { ok: false, error: `未部署的应用 "${name}"` })
    return
  }
  const loadId = randomUUID()
  const token = randomUUID()
  tickets.set(loadId, { name, token, createdAt: Date.now(), consumed: false })
  const commit = await headCommit(app.repoPath, app.branch ?? 'main')
  const version = commit !== null ? `${app.branch ?? 'main'}@${shortCommit(commit)}` : (app.branch ?? 'main')
  sendJson(res, 200, {
    ok: true,
    load: {
      loadId,
      token,
      url: `/dsh-web-app/apps/${name}/?load=${loadId}`,
      version,
    },
  })
}

/** POST /delete {name}：移除注册表条目 + 删仓库目录。 */
async function handleDelete(body, res, warn) {
  const name = body?.name
  if (!validateName(name)) {
    sendJson(res, 400, { ok: false, error: `name 不合法：${JSON.stringify(name)}` })
    return
  }
  const reg = await loadRegistry(warn)
  if (getApp(reg, name) === null) {
    sendJson(res, 404, { ok: false, error: `未部署的应用 "${name}"` })
    return
  }
  removeApp(reg, name)
  await saveRegistry(reg)
  await fs.rm(appDir(name), { recursive: true, force: true })
  sendJson(res, 200, { ok: true })
}
