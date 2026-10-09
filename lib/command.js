/**
 * dsh-web-app — `/webapp` 斜杠命令（host 半登记；mvp-design §5、sdk-notes §10）。
 *
 * UX：/webapp [name]。name 可选做深链——
 *   留空     → 卡片内渲染应用选择器（client 半的 commandview 干这事）；
 *   非空     → host 侧先校验存在性：不在注册表直接报错，在则放行，
 *              client 半卡片据 node.outcome/args 直开 iframe。
 *
 * 注意：命令**不触发模型调用**（mvp-design §2/§5），返回的 text 只进
 * command/done → 卡片折叠行，模型看不到。
 */

import { loadRegistry, getApp } from './registry.js'

/**
 * 注册 /webapp 命令；返回 disposer。
 * @param {object} ctx - cordis context（需 ctx.commands、ctx.logger）。
 */
export function registerCommand(ctx) {
  const warn = (message) => ctx.logger?.warn?.(message)
  return ctx.commands.register({
    name: 'webapp',
    description: '在对话内嵌打开一个 webapp（不触发模型调用）',
    input: { hint: '应用名（可选，留空在卡片中选择）' },
    handler: async (invocation) => {
      const name = (invocation?.rawInput ?? '').trim()
      if (name === '') {
        return { kind: 'success', text: '在卡片中选择应用' }
      }
      const reg = await loadRegistry(warn)
      if (getApp(reg, name) === null) {
        return {
          kind: 'error',
          text: `未部署的应用 "${name}"。用 /webapp 留空选择，或先部署。`,
        }
      }
      return { kind: 'success', text: `打开 ${name}` }
    },
  })
}
