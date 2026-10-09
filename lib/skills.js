/**
 * dsh-web-app — 分层 skills 注册（mvp-design §3.3、sdk-notes §7）。
 *
 * 从包目录读 skills/dsh-web-app-author.md 与 skills/dsh-web-app-interpret.md
 * （路径由 fileURLToPath(import.meta.url) 推出包根），剥掉 frontmatter 后把
 * markdown 全文作为 content 注册：
 *
 *   ctx.skills.register({ name, description, whenToUse, content, source:'bundled', path })
 *
 * skills 是可选依赖：ctx.get('skills') 拿不到就 warn 跳过，不拖垮插件。
 * frontmatter 解析是 10 行简易版，只认 name/description/whenToUse 三个标量字段
 * （值可带双引号）；其余字段一律忽略。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL_FILES = ['dsh-web-app-author.md', 'dsh-web-app-interpret.md']

/** 注册结果的自检状态（给 /dsh-web-app/api/health 诊断端点用）。 */
export const skillsStatus = { state: 'not-run', detail: '' }

/** 包根 = lib/ 的上一级（本文件在 <pkg>/lib/skills.js）。 */
function packageRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)))
}

/**
 * 把 `---\n...\n---\n` frontmatter 与正文分开。
 * @param {string} raw
 * @returns {{frontmatter:string, content:string}}
 */
export function splitFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (m === null) return { frontmatter: '', content: raw }
  return { frontmatter: m[1], content: raw.slice(m[0].length) }
}

/**
 * 简易 frontmatter 解析：只认 `key: value` 标量行（value 去首尾空白与成对引号）。
 * @param {string} text
 * @returns {Record<string,string>}
 */
export function parseFrontmatter(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line)
    if (m === null) continue
    let value = m[2].trim()
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1)
    }
    out[m[1]] = value
  }
  return out
}

/**
 * 注册两个 bundled skills；返回 disposer（无 skills 服务时返回 no-op）。
 * @param {object} ctx - cordis context。
 */
export function registerSkills(ctx) {
  const skills = typeof ctx.get === 'function' ? ctx.get('skills') : undefined
  if (!skills) {
    skillsStatus.state = 'skipped'
    skillsStatus.detail = 'ctx.get(skills) 返回空'
    ctx.logger?.warn?.('dsh-web-app: ctx 上没有 skills 服务，跳过 bundled skills 注册')
    return () => {}
  }
  const disposers = []
  for (const file of SKILL_FILES) {
    const path = join(packageRoot(), 'skills', file)
    let raw
    try {
      raw = readFileSync(path, 'utf8')
    } catch (error) {
      ctx.logger?.warn?.(`dsh-web-app: 读不到 skill 文件 ${path}（${error?.message ?? error}），跳过`)
      continue
    }
    const { frontmatter, content } = splitFrontmatter(raw)
    const meta = parseFrontmatter(frontmatter)
    if (!meta.name || !meta.description) {
      ctx.logger?.warn?.(`dsh-web-app: ${file} 的 frontmatter 缺 name/description，跳过`)
      continue
    }
    // 注意：必须用上面 ctx.get 拿到的局部变量——本插件没把 skills 声明进
    // inject，直接读 ctx.skills 会被 restricted ctx 以 "without inject" 拒绝。
    disposers.push(skills.register({
      name: meta.name,
      description: meta.description,
      ...(meta.whenToUse ? { whenToUse: meta.whenToUse } : {}),
      content,
      source: 'bundled',
      path,
    }))
  }
  skillsStatus.state = disposers.length > 0 ? 'registered' : 'skipped'
  skillsStatus.detail = `已注册 ${disposers.length} 个：${disposers.length > 0 ? SKILL_FILES.join(', ') : '无'}`
  return () => {
    for (const dispose of disposers) dispose()
  }
}
