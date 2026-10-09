/**
 * dsh-web-app — host 半入口。
 *
 * 职责（mvp-design §3.1）：注册表 + deploy/check 工具 + JSON 通道 + 静态伺服
 * + /webapp 命令 + bundled skills。浏览器半（lib/client.js，他人负责）通过
 * 本插件的 webServer 路由取数据。
 *
 * 启动顺序即职责顺序；每一步都挂在 ctx.effect 上（插件卸载自动注销），
 * 任何单步失败 catch 住 warn——半残的插件也比整个图加载失败强。
 * skills 是可选依赖（ctx.get 探测），其余三个（commands/tools/webServer）
 * 由 inject 声明强制满足。
 */

import { appsRoot } from './paths.js'
import { loadRegistry } from './registry.js'
import { registerDeployTool } from './tools-deploy.js'
import { registerCheckTool } from './tools-check.js'
import { registerJsonApi } from './json-api.js'
import { registerServe } from './serve.js'
import { registerCommand } from './command.js'
import { registerSkills } from './skills.js'

export const name = 'dsh-web-app'

export const inject = ['commands', 'tools', 'webServer']

export function apply(ctx) {
  const steps = [
    ['deploy 工具', () => registerDeployTool(ctx)],
    ['check 工具', () => registerCheckTool(ctx)],
    ['JSON API', () => registerJsonApi(ctx)],
    ['静态伺服', () => registerServe(ctx)],
    ['/webapp 命令', () => registerCommand(ctx)],
    ['bundled skills', () => registerSkills(ctx)],
  ]
  for (const [label, register] of steps) {
    try {
      ctx.effect(register, `dsh-web-app: ${label}`)
    } catch (error) {
      ctx.logger?.warn?.(`dsh-web-app: ${label} 注册失败（${error?.message ?? error}），其余组件不受影响`)
    }
  }

  // 启动摘要（含数据目录，排查「应用存哪了」的第一问）。
  loadRegistry((message) => ctx.logger?.warn?.(message))
    .then((reg) => {
      const names = Object.keys(reg.apps)
      ctx.logger?.info?.(
        `dsh-web-app: 启动完成；注册表 ${names.length} 个应用${names.length > 0 ? `（${names.join('、')}）` : ''}；数据目录 ${appsRoot()}`,
      )
    })
    .catch((error) => {
      ctx.logger?.warn?.(`dsh-web-app: 启动摘要读取注册表失败（${error?.message ?? error}）`)
    })
}
