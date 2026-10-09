/**
 * dsh-web-app — `dsh-web-app-deploy` 工具。
 *
 * 首次部署（callback-contract §1、mvp-design §3.1/§7）：
 *   接收 name + html + metadata + template → 全量契约校验 → 创建
 *   apps/<name>/（index.html / app.json / callback.template.md）→ git init
 *   + 首次提交 → 登记注册表。
 *
 * 纪律：
 *   - **同名拒绝**（Q17）：注册表已有或目录已存在都拒绝，建议换名；
 *   - 校验不过**不创建任何东西**（连目录都不建），返回结构化错误让模型改；
 *   - 部署成功后，此后所有修改直接改仓库 + git 提交（不再走本工具），
 *     用户点卡片刷新即拉取部署指针处内容——这条写进 nextSteps 教给模型。
 *
 * 测试方式：用假 ctx 捕获 tools.register 的 definition，直接调 execute(args)，
 * 配合 process.env.DSH_HOME 指向临时目录。
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { appDir } from './paths.js'
import { loadRegistry, saveRegistry, getApp, putApp } from './registry.js'
import { initRepo, headCommit, shortCommit } from './git.js'
import { validateName, validateAppJson, validateHtml, validateTemplate } from './validate.js'

export const DEPLOY_TOOL_NAME = 'dsh-web-app-deploy'

const DEFAULT_BRANCH = 'main'

const PARAMETERS = {
  type: 'object',
  required: ['name', 'html', 'metadata', 'template'],
  additionalProperties: false,
  properties: {
    name: {
      type: 'string',
      description: '应用名，kebab-case（小写字母/数字/连字符），创建后不可改；同名一律拒绝。',
    },
    html: {
      type: 'string',
      description: '单文件 index.html 全文（全部内联）。只允许 {{__NAME__}}/{{__VERSION__}}/{{__TOKEN__}} 三个保留占位符，且必须含回传桥（postMessage submit）。',
    },
    metadata: {
      type: 'object',
      description: 'app.json 元数据：{ name, description, confirm:boolean, variables:[{slot,label,purpose}] }；confirm 必须显式 boolean，variables 槽位形如 TEXT_1/NUMBER_1/BOOLEAN_1/JSON_1。',
    },
    template: {
      type: 'string',
      description: 'callback.template.md 回传填空模板，以「[webapp 回传]」开头；占位符只能是声明的变量加 {{__NAME__}}/{{__VERSION__}}，且每个声明变量至少被模板或页面用到一次。',
    },
  },
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ok: { type: 'boolean', description: 'true=部署成功；false=校验/冲突失败，未创建任何东西。' },
    name: { type: 'string' },
    repoPath: { type: 'string', description: '应用 Git 仓库的绝对路径。' },
    branch: { type: 'string' },
    commit: { type: 'string', description: '首提交完整 hash。' },
    version: { type: 'string', description: '形如 main@abc1234（分支@短hash）。' },
    serveUrl: { type: 'string', description: '伺服 URL：/dsh-web-app/apps/<name>/' },
    nextSteps: { type: 'array', items: { type: 'string' } },
    error: { type: 'object', additionalProperties: true, description: 'ok=false 时的结构化错误。' },
  },
  required: ['ok'],
}

/**
 * 部署主流程（与工具 execute 同一实现，便于直接单测）。
 * @param {{name:string, html:string, metadata:object, template:string}} args
 * @param {(message:string)=>void} [warn]
 * @returns {Promise<object>} 成功 {ok:true,…}；失败 {ok:false, error:{message,…}}。
 */
export async function deployExecute(args, warn) {
  const name = args?.name
  const metadata = args?.metadata

  // ① 全量契约校验：任何一项不过都不创建东西。
  const issues = []
  if (!validateName(name)) {
    issues.push(`name ${JSON.stringify(name)} 不是合法 kebab-case（^[a-z0-9]+(?:-[a-z0-9]+)*$）`)
  }
  issues.push(...validateAppJson(metadata, validateName(name) ? name : undefined))
  issues.push(...validateHtml(args?.html))
  const variables = Array.isArray(metadata?.variables) ? metadata.variables : []
  issues.push(...validateTemplate(args?.template, variables, args?.html))
  if (issues.length > 0) {
    return {
      ok: false,
      error: { message: `部署校验未通过（${issues.length} 项问题），未创建任何东西`, issues },
    }
  }

  // ② 同名拒绝：注册表已有或磁盘目录已存在都算。
  const reg = await loadRegistry(warn)
  const dir = appDir(name)
  const inRegistry = getApp(reg, name) !== null
  const onDisk = await fs.stat(dir).then(() => true).catch(() => false)
  if (inRegistry || onDisk) {
    return {
      ok: false,
      error: {
        message: `应用 "${name}" 已存在（同名部署一律拒绝）。请换一个名字；若要修改已有应用，直接编辑仓库 ${dir} 下的文件并用 git 提交。`,
      },
    }
  }

  // ③ 写三件套。
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, 'index.html'), args.html, 'utf8')
  await fs.writeFile(join(dir, 'app.json'), JSON.stringify(metadata, null, 2) + '\n', 'utf8')
  await fs.writeFile(join(dir, 'callback.template.md'), args.template, 'utf8')

  // ④ git init + 首提交（身份缺失时 repo-local 重试，见 git.js）。
  await initRepo(dir, `deploy: ${name} 首次部署`)

  // ⑤ 登记注册表（commit 不存死，每次读取现场解析）。
  const commit = await headCommit(dir, DEFAULT_BRANCH)
  const version = commit !== null ? `${DEFAULT_BRANCH}@${shortCommit(commit)}` : DEFAULT_BRANCH
  putApp(reg, { name, description: metadata.description, repoPath: dir, branch: DEFAULT_BRANCH })
  await saveRegistry(reg)

  // ⑥ 返回人话摘要需要的全部字段。
  return {
    ok: true,
    name,
    repoPath: dir,
    branch: DEFAULT_BRANCH,
    commit,
    version,
    serveUrl: `/dsh-web-app/apps/${name}/`,
    nextSteps: [
      `此后修改：直接编辑仓库 ${dir} 下的文件并 git 提交，用户点卡片刷新即拉取部署指针（${DEFAULT_BRANCH} 最新提交）处内容。`,
      '用 dsh-web-app-check 工具自检三件套与回传桥。',
      `用户在对话输入 /webapp ${name} 内嵌打开应用。`,
    ],
  }
}

/**
 * 注册 deploy 工具；返回 disposer。
 * @param {object} ctx - cordis context（需 ctx.tools、ctx.logger）。
 */
export function registerDeployTool(ctx) {
  const warn = (message) => ctx.logger?.warn?.(message)
  return ctx.tools.register({
    name: DEPLOY_TOOL_NAME,
    description:
      '首次部署一个可回传的 webapp：建档（index.html/app.json/callback.template.md）+ git init + 首次提交 + 登记注册表。' +
      '同名一律拒绝，换名重来；此后修改不再走本工具——直接改仓库目录里的文件再 git 提交即可。',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderSummary(value) }],
    },
    execute: (args) => deployExecute(args, warn),
  })
}

/** 给模型看的人话摘要（render 的输出，进上下文）。 */
function renderSummary(value) {
  if (!value?.ok) {
    const lines = [`❌ 部署失败：${value?.error?.message ?? '未知错误'}`]
    for (const issue of value?.error?.issues ?? []) lines.push(`  - ${issue}`)
    return lines.join('\n')
  }
  return [
    `✅ 已部署 webapp "${value.name}"（${value.version}）`,
    `仓库：${value.repoPath}`,
    `打开：/webapp ${value.name}（伺服 URL ${value.serveUrl}）`,
    ...value.nextSteps.map((s) => `· ${s}`),
  ].join('\n')
}
