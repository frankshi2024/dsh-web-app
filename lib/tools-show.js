/**
 * dsh-web-app — `dsh-web-app-show` 工具。
 *
 * 主动插入一张应用卡片（mvp-design §4 显示面补充，decisions Q22）：
 * 模型在对话中途想把某个已部署应用推到用户面前时调用——比如刚讨论完
 * 一个既有应用的改进，或者想引导用户体验一个相关应用。
 *
 * 与「turn 结束自动浮现」的分工：本工具是**主动**插入（卡片落在本次
 * tool call 的位置）；自动浮现是**被动**兜底（turn 内发生过部署/提交时
 * turn 末尾自动出现折叠卡片）。两者都用 client 半的同一折叠卡片组件。
 *
 * expand 参数：false（默认）= 折叠卡片（「立即体验」按钮，用户点了才展开
 * iframe）；true = 立即展开（等同 /webapp <name> 的打开态）。折叠是默认
 * 因为主动插入不该打断阅读流。
 *
 * 渲染发生在 client 半的 keyed toolview（tool.call.toolview，key =
 * 本工具名）；host 侧只负责校验应用存在并回传卡片需要的数据。
 */

import { loadRegistry, getApp } from './registry.js'
import { headCommit, shortCommit } from './git.js'

export const SHOW_TOOL_NAME = 'dsh-web-app-show'

const PARAMETERS = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: {
      type: 'string',
      description: '要展示的已部署应用名（kebab-case）。',
    },
    expand: {
      type: 'boolean',
      description: 'true=立即展开成可交互 iframe；false（默认）=折叠卡片，用户点「立即体验」才展开。',
    },
  },
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ok: { type: 'boolean' },
    name: { type: 'string' },
    description: { type: 'string' },
    version: { type: 'string', description: '形如 main@abc1234（分支@短hash）。' },
    expand: { type: 'boolean' },
    error: { type: 'string' },
  },
  required: ['ok'],
}

/**
 * 主流程（与工具 execute 同一实现，便于直接单测）。
 * @param {{name:string, expand?:boolean}} args
 * @param {(message:string)=>void} [warn]
 * @returns {Promise<object>}
 */
export async function showExecute(args, warn) {
  const name = args?.name
  const expand = args?.expand === true
  const reg = await loadRegistry(warn)
  const app = getApp(reg, name)
  if (app === null) {
    return { ok: false, error: `未部署的应用 ${JSON.stringify(name)}——只能用 dsh-web-app-deploy 部署过的应用名。` }
  }
  const branch = app.branch ?? 'main'
  const commit = await headCommit(app.repoPath, branch)
  return {
    ok: true,
    name,
    description: app.description ?? '',
    version: commit !== null ? `${branch}@${shortCommit(commit)}` : branch,
    expand,
  }
}

/**
 * 注册 show 工具；返回 disposer。
 * @param {object} ctx - cordis context（需 ctx.tools、ctx.logger）。
 */
export function registerShowTool(ctx) {
  const warn = (message) => ctx.logger?.warn?.(message)
  return ctx.tools.register({
    name: SHOW_TOOL_NAME,
    description:
      '在对话中插入一张 webapp 卡片：expand=false（默认）为折叠卡片（用户点「立即体验」才展开应用），expand=true 立即展开为可交互应用。' +
      '用途：主动把某个已部署应用推到用户面前；本 turn 内部署/更新过的应用会在 turn 结束时自动浮现折叠卡片，无需为此调用本工具。',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: value?.ok
          ? `✅ 已插入应用卡片 "${value.name}"（${value.version}，${value.expand ? '立即展开' : '折叠，待用户点击'}）`
          : `❌ ${value?.error ?? '插入失败'}`,
      }],
    },
    execute: (args) => showExecute(args, warn),
  })
}
