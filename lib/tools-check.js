/**
 * dsh-web-app — `dsh-web-app-check` 自检工具。
 *
 * 按 callback-contract §7 自检清单逐项检查一个已部署应用：
 *   1. 三件套齐全：index.html / app.json / callback.template.md
 *   2. app.json 通过 schema 校验（含显式 confirm 声明）
 *   3. 模板占位符与变量声明双向对应（模板占位符都有声明；每个声明的变量
 *      都被模板或页面使用）
 *   4. index.html 含回传桥（{{__TOKEN__}} + dsh-web-app + postMessage + submit）
 *   5. index.html 只使用保留占位符词表（__NAME__/__VERSION__/__TOKEN__）
 *   6. git 工作树干净、至少一次提交
 *
 * 返回 { ok, name, results:[{id,label,pass,detail?}] }；output.render 给
 * 逐项 ✅/❌ 清单。应用不存在 → 结构化错误。
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { loadRegistry, getApp } from './registry.js'
import { isClean, commitCount } from './git.js'
import { validateAppJson, validateTemplate, htmlBridgeIssues, htmlPlaceholderIssues } from './validate.js'

export const CHECK_TOOL_NAME = 'dsh-web-app-check'

const PARAMETERS = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', description: '已部署应用名（kebab-case）。' },
  },
  additionalProperties: false,
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ok: { type: 'boolean', description: '全部检查项通过。' },
    name: { type: 'string' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          pass: { type: 'boolean' },
          detail: { type: 'string' },
        },
        required: ['id', 'label', 'pass'],
      },
    },
    error: { type: 'string', description: 'ok=false 且应用不存在时的错误说明。' },
  },
  required: ['ok'],
}

/**
 * 自检主流程（与工具 execute 同一实现，便于直接单测）。
 * @param {{name:string}} args
 * @param {(message:string)=>void} [warn]
 * @returns {Promise<object>}
 */
export async function checkExecute(args, warn) {
  const name = args?.name
  const reg = await loadRegistry(warn)
  const app = getApp(reg, name)
  if (app === null) {
    return { ok: false, name, results: [], error: `未部署的应用 "${name}"——先用 dsh-web-app-deploy 部署，或检查名字拼写。` }
  }
  const dir = app.repoPath
  /** @type {Array<{id:string,label:string,pass:boolean,detail?:string}>} */
  const results = []
  const push = (id, label, pass, detail) => {
    const item = { id, label, pass: !!pass }
    if (detail) item.detail = detail
    results.push(item)
  }

  // ① 三件套齐全
  const required = ['index.html', 'app.json', 'callback.template.md']
  const missing = []
  for (const file of required) {
    const ok = await fs.stat(join(dir, file)).then((s) => s.isFile()).catch(() => false)
    if (!ok) missing.push(file)
  }
  push('files', '三件套齐全（index.html / app.json / callback.template.md）', missing.length === 0,
    missing.length > 0 ? `缺少：${missing.join('、')}` : undefined)

  // ② app.json schema（含显式 confirm）
  let metadata = null
  let parseError = null
  try {
    metadata = JSON.parse(await fs.readFile(join(dir, 'app.json'), 'utf8'))
  } catch (error) {
    parseError = error?.message ?? String(error)
  }
  const schemaIssues = parseError !== null ? [`app.json 解析失败：${parseError}`] : validateAppJson(metadata, name)
  push('schema', 'app.json 通过 schema 校验（含显式 confirm）', schemaIssues.length === 0,
    schemaIssues.length > 0 ? schemaIssues.join('；') : undefined)

  // ③ 模板与变量双向对应（validateTemplate 内含「声明变量被模板或页面使用」）
  const template = await fs.readFile(join(dir, 'callback.template.md'), 'utf8').catch(() => null)
  const html = await fs.readFile(join(dir, 'index.html'), 'utf8').catch(() => null)
  const templateIssues = template === null
    ? ['callback.template.md 读取失败']
    : validateTemplate(template, Array.isArray(metadata?.variables) ? metadata.variables : [], html ?? undefined)
  push('template', '模板占位符与变量声明双向对应', templateIssues.length === 0,
    templateIssues.length > 0 ? templateIssues.join('；') : undefined)

  // ④ index.html 含回传桥
  const bridgeIssues = html === null ? ['index.html 读取失败'] : htmlBridgeIssues(html)
  push('bridge', 'index.html 含回传桥（读取 {{__TOKEN__}}、postMessage、submit）', bridgeIssues.length === 0,
    bridgeIssues.length > 0 ? bridgeIssues.join('；') : undefined)

  // ⑤ index.html 只用保留占位符
  const phIssues = html === null ? ['index.html 读取失败'] : htmlPlaceholderIssues(html)
  push('placeholders', 'index.html 只使用保留占位符（__NAME__/__VERSION__/__TOKEN__）', phIssues.length === 0,
    phIssues.length > 0 ? phIssues.join('；') : undefined)

  // ⑥ git 工作树干净且 ≥1 提交
  const clean = await isClean(dir)
  const count = await commitCount(dir)
  push('git', 'git 工作树干净且至少一次提交', clean && count >= 1,
    clean && count >= 1 ? `${count} 个提交` : [!clean && '工作树有未提交改动', count < 1 && '没有任何提交'].filter(Boolean).join('；') || undefined)

  return { ok: results.every((r) => r.pass), name, results }
}

/**
 * 注册 check 工具；返回 disposer。
 * @param {object} ctx - cordis context（需 ctx.tools、ctx.logger）。
 */
export function registerCheckTool(ctx) {
  const warn = (message) => ctx.logger?.warn?.(message)
  return ctx.tools.register({
    name: CHECK_TOOL_NAME,
    description: '按回传契约自检一个已部署的 webapp：三件套齐全、app.json schema、模板与变量双向对应、回传桥、占位符词表、git 状态。',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderChecklist(value) }],
    },
    execute: (args) => checkExecute(args, warn),
  })
}

/** 逐项 ✅/❌ 清单文本。 */
function renderChecklist(value) {
  if (value?.error) return `❌ ${value.error}`
  const lines = value.results.map((r) => `${r.pass ? '✅' : '❌'} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`)
  lines.push(value.ok ? '全部通过。' : '存在问题，按 ❌ 项修复后重新提交并再跑自检。')
  return lines.join('\n')
}
