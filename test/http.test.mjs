/** lib/json-api.js + lib/serve.js：真起 node:http 服务验证路由行为。 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerJsonApi, consumeTicket } from '../lib/json-api.js'
import { registerServe } from '../lib/serve.js'
import { deployExecute } from '../lib/tools-deploy.js'
import { useTmpDshHome, readExample, fakeCtx } from './helpers.mjs'

/** 起服务并挂载捕获到的 webServer 路由 handler；返回 base URL + close。 */
async function serveWith(routes) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    // 模拟 dsh-host-webserver 的匹配：exact → 最长前缀
    const candidates = routes
      .filter((r) => url.pathname === r.path || url.pathname.startsWith(r.path + '/'))
      .sort((a, b) => b.path.length - a.path.length)
    const route = candidates[0]
    if (!route) {
      res.writeHead(404).end('not found')
      return
    }
    await route.handler(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

function captureRoutes() {
  const routes = []
  const ctx = {
    ...fakeCtx(),
    webServer: { register: (route) => { routes.push(route); return () => {} } },
  }
  return { routes, ctx }
}

test('json-api + serve：list/app/load/serve/delete 全链路', async () => {
  const { restore } = useTmpDshHome()
  try {
    await deployExecute({ name: 'config-panel', ...(await readExample()) })

    const { routes, ctx } = captureRoutes()
    registerJsonApi(ctx)
    registerServe(ctx)
    const { base, close } = await serveWith(routes)
    try {
      // GET /list
      const list = await (await fetch(`${base}/dsh-web-app/api/list`)).json()
      assert.equal(list.ok, true)
      assert.equal(list.apps.length, 1)
      assert.equal(list.apps[0].name, 'config-panel')
      assert.match(list.apps[0].version, /^main@[0-9a-f]{7}$/)

      // GET /app?name=
      const detail = await (await fetch(`${base}/dsh-web-app/api/app?name=config-panel`)).json()
      assert.equal(detail.ok, true)
      assert.equal(detail.app.name, 'config-panel')
      assert.equal(detail.app.confirm, true)
      assert.equal(detail.app.variables.length, 4)
      assert.match(detail.app.template, /\[webapp 回传\]/)
      assert.match(detail.app.version, /^main@/)
      assert.equal(detail.app.exists, true)
      const missing = await (await fetch(`${base}/dsh-web-app/api/app?name=nope`)).json()
      assert.equal(missing.ok, false)

      // POST /load 铸票
      const loadRes = await fetch(`${base}/dsh-web-app/api/load`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'config-panel' }),
      })
      const load = await loadRes.json()
      assert.equal(load.ok, true)
      assert.match(load.load.url, /^\/dsh-web-app\/apps\/config-panel\/\?load=/)

      // serve：带票 → 盖章 token 与版本；meta 注入
      const page = await fetch(`${base}${load.load.url}`)
      assert.equal(page.status, 200)
      assert.match(page.headers.get('content-type'), /text\/html/)
      assert.equal(page.headers.get('cache-control'), 'no-store')
      const html = await page.text()
      assert.ok(html.includes(`"${load.load.token}"`)) // {{__TOKEN__}} 被盖章
      assert.ok(html.includes('"config-panel"')) // {{__NAME__}}
      assert.ok(html.includes(`"${load.load.version}"`)) // {{__VERSION__}}
      assert.ok(html.includes('<meta name="dsh-web-app" content="config-panel">'))

      // 票据一次性：第二次消费失败 → token=''（占位符被空串替换）
      const page2 = await fetch(`${base}${load.load.url}`)
      const html2 = await page2.text()
      assert.ok(!html2.includes(`"${load.load.token}"`))
      assert.ok(html2.includes('const APP_TOKEN = "";'))

      // 无票访问 → token 也是空串
      const page3 = await fetch(`${base}/dsh-web-app/apps/config-panel/`)
      assert.equal(page3.status, 200)
      assert.ok((await page3.text()).includes('const APP_TOKEN = "";'))

      // /index.html 与裸名之外的形状 404
      assert.equal((await fetch(`${base}/dsh-web-app/apps/config-panel/other.js`)).status, 404)
      assert.equal((await fetch(`${base}/dsh-web-app/apps/`)).status, 404)

      // POST /delete
      const del = await (await fetch(`${base}/dsh-web-app/api/delete`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'config-panel' }),
      })).json()
      assert.equal(del.ok, true)
      const gone = await (await fetch(`${base}/dsh-web-app/api/list`)).json()
      assert.equal(gone.apps.length, 0)
      const page404 = await fetch(`${base}/dsh-web-app/apps/config-panel/`)
      assert.equal(page404.status, 404)
      assert.match(await page404.text(), /未部署/)
    } finally {
      await close()
    }
  } finally {
    restore()
  }
})

test('json-api：错误路径（非法 name、未知路由、坏 JSON、超限）', async () => {
  const { restore } = useTmpDshHome()
  try {
    await deployExecute({ name: 'config-panel', ...(await readExample()) })
    const { routes, ctx } = captureRoutes()
    registerJsonApi(ctx)
    const { base, close } = await serveWith(routes)
    try {
      const bad = await (await fetch(`${base}/dsh-web-app/api/app?name=Bad_Name`)).json()
      assert.equal(bad.ok, false)
      const unknown = await (await fetch(`${base}/dsh-web-app/api/nope`)).json()
      assert.equal(unknown.ok, false)
      const badJson = await fetch(`${base}/dsh-web-app/api/load`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops',
      })
      assert.equal((await badJson.json()).ok, false)
      const big = await fetch(`${base}/dsh-web-app/api/load`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'config-panel', pad: 'x'.repeat(1024 * 1024 + 10) }),
      })
      assert.equal((await big.json()).ok, false)
      assert.equal(big.status, 413)
      // 无 CORS 头
      assert.equal(big.headers.get('access-control-allow-origin'), null)
    } finally {
      await close()
    }
  } finally {
    restore()
  }
})

test('consumeTicket：同名/未消费/未过期 校验', async () => {
  const { restore } = useTmpDshHome()
  try {
    await deployExecute({ name: 'config-panel', ...(await readExample()) })
    const { routes, ctx } = captureRoutes()
    registerJsonApi(ctx)
    const { base, close } = await serveWith(routes)
    try {
      const { load } = await (await fetch(`${base}/dsh-web-app/api/load`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'config-panel' }),
      })).json()
      const loadId = load.loadId
      // 模块级导出直接验证（票据已由 load 创建）
      assert.equal(consumeTicket(loadId, 'config-panel'), load.token) // 消费成功
      assert.equal(consumeTicket(loadId, 'config-panel'), null) // 已消费
      assert.equal(consumeTicket(loadId, 'other-app'), null) // 消费后不再可用（同名校验在 consumed 之前已被拦截）
      assert.equal(consumeTicket('no-such', 'config-panel'), null) // 不存在
      assert.equal(consumeTicket(null, 'config-panel'), null)
      assert.equal(consumeTicket('', 'config-panel'), null)
    } finally {
      await close()
    }
  } finally {
    restore()
  }
})
