/**
 * dsh-web-app — 静态伺服 + 伺服时盖章（callback-contract §3 Q14a）。
 *
 * 路由（kind: prefix, path: /dsh-web-app/apps）：
 *   只接受 /dsh-web-app/apps/<name>/ 与 /dsh-web-app/apps/<name>/index.html，
 *   其余 404；name 先过 validateName 并 percent-decode。
 *
 * 内容来源：git show <branch>:index.html（部署指针处，工作树再脏也不影响
 * 线上内容）；git 读不到（如从未提交）降级读工作树文件；都没有 → 人话 404。
 *
 * 盖章：token 从 query 里的 load（loadId）经 json-api.consumeTicket 兑换
 * （存在、同名、未消费、未过期）；没有/失效 → token=''（降级为无票，桥的
 * 校验会拒掉这次回传）。version = 部署指针分支@短hash。最后 stampHtml 做
 * 三个保留占位符的全局替换并注入身份 meta。
 *
 * 响应 text/html; charset=utf-8 + cache-control: no-store（HTML 是盖章产物，
 * 绝不能缓存）；不加任何 CORS 头。
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { loadRegistry, getApp } from './registry.js'
import { showFile, headCommit, shortCommit } from './git.js'
import { validateName, stampHtml } from './validate.js'
import { consumeTicket } from './json-api.js'

const PREFIX = '/dsh-web-app/apps'

/** 人话 HTML 错误页。 */
function sendErrorPage(res, status, title, message) {
  const body = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
</head>
<body style="font-family:system-ui,sans-serif;padding:24px;color:#c0392b">
<h1 style="font-size:16px">${escapeHtml(title)}</h1>
<p style="font-size:13px;color:#666">${escapeHtml(message)}</p>
</body>
</html>`
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

/** 错误页里防一手（虽然 title/message 全部来自我们自己的文案）。 */
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 注册静态伺服路由；返回 disposer。
 * @param {object} ctx - cordis context（需 ctx.webServer、ctx.logger）。
 */
export function registerServe(ctx) {
  const warn = (message) => ctx.logger?.warn?.(message)
  return ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      try {
        await handle(req, res, warn)
      } catch (error) {
        sendErrorPage(res, 500, '伺服失败', error?.message ?? String(error))
      }
    },
  })
}

/** 解析 URL → 取部署指针处源码 → 盖章 → 响应。 */
async function handle(req, res, warn) {
  const url = new URL(req.url, 'http://dsh-web-app.local')
  const rest = url.pathname.slice(PREFIX.length)

  // 只接受 /<name>/ 与 /<name>/index.html（前缀裸匹配 /dsh-web-app/apps 无 name → 404）。
  const segments = rest.split('/').filter((s) => s !== '')
  const okShape = segments.length === 1 || (segments.length === 2 && segments[1] === 'index.html')
  if (!okShape) {
    sendErrorPage(res, 404, '没有这个页面', 'webapp 伺服只提供 /<name>/ 与 /<name>/index.html。')
    return
  }
  let name
  try {
    name = decodeURIComponent(segments[0])
  } catch {
    name = segments[0]
  }
  if (!validateName(name)) {
    sendErrorPage(res, 404, '应用名不合法', `"${name}" 不是 kebab-case 应用名。`)
    return
  }

  const reg = await loadRegistry(warn)
  const app = getApp(reg, name)
  if (app === null) {
    sendErrorPage(res, 404, `应用 "${name}" 未部署`, '用 dsh-web-app-deploy 部署，或检查名字拼写。')
    return
  }
  const dir = app.repoPath
  const branch = app.branch ?? 'main'

  // 部署指针处内容优先，工作树兜底。
  const html = (await showFile(dir, branch, 'index.html'))
    ?? await fs.readFile(join(dir, 'index.html'), 'utf8').catch(() => null)
  if (html === null) {
    sendErrorPage(res, 404, `应用 "${name}" 没有可伺服的内容`, `仓库 ${dir} 的 ${branch} 分支上没有 index.html。`)
    return
  }

  // 兑换门票；无效/缺失 → 空 token（回传桥的校验会拒掉无票提交）。
  const loadId = url.searchParams.get('load')
  const token = consumeTicket(loadId, name) ?? ''

  const commit = await headCommit(dir, branch)
  const version = commit !== null ? `${branch}@${shortCommit(commit)}` : branch
  const stamped = stampHtml(html, { name, version, token })

  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(stamped)
}
