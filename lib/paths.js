/**
 * dsh-web-app — 数据目录解析。
 *
 * 职责：内联实现 `@deepseek-ai/dsh-home-paths` 的语义（该包是纯函数库，
 * 不是 cordis 服务；sdk-notes §3 建议直接依赖它，但本项目零运行时依赖，
 * 故按其行为复刻，见 `.scratch/dsh-src/dsh/node_modules/@deepseek-ai/dsh-home-paths`）：
 *
 *   resolveDshHome 优先级：
 *     1. 显式 configured（非空白 string）；
 *     2. `$DSH_HOME` 环境变量（空白视为未设置；`~` 开头展开为 os.homedir()）；
 *     3. `os.homedir() + '/.dsh'`（Windows 即 `%USERPROFILE%\.dsh`）。
 *
 * 布局（与第一方约定一致，home 级、跨 profile 共享）：
 *   <home>/dsh-web-app/apps/<name>/   每个 webapp 一个 Git 仓库
 *   <home>/dsh-web-app/registry.json  应用注册表
 *
 * 注意：env 默认绑定 process.env，但每次调用时读取——测试通过改写
 * process.env.DSH_HOME 即可把整个插件隔离到临时目录。
 */

import os from 'node:os'
import { join } from 'node:path'

/**
 * 展开路径开头的 `~`（等价于 dsh-home-paths 的 expandHomePath）。
 * 只处理单独的 `~` 与 `~/`（或 `~\`）前缀，其余原样返回。
 * @param {string} p
 * @returns {string}
 */
export function expandHomePath(p) {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(os.homedir(), p.slice(2))
  return p
}

/**
 * 解析 DSH home 目录（语义同 `@deepseek-ai/dsh-home-paths` 的 resolveDshHome）。
 * @param {string} [configured] - 显式配置值；非空白 string 时优先。
 * @param {NodeJS.ProcessEnv} [env] - 环境变量表；默认 process.env，调用时现读。
 * @returns {string} 绝对路径，结尾不带分隔符。
 */
export function resolveDshHome(configured, env = process.env) {
  const fromConfig = typeof configured === 'string' && configured.trim() !== ''
  const fromEnv = !fromConfig && typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== ''
  if (fromConfig) return expandHomePath(configured.trim())
  if (fromEnv) return expandHomePath(env.DSH_HOME.trim())
  return join(os.homedir(), '.dsh')
}

/**
 * 所有 webapp Git 仓库的根目录：`<home>/dsh-web-app/apps`。
 * @returns {string}
 */
export function appsRoot(configured, env) {
  return join(resolveDshHome(configured, env), 'dsh-web-app', 'apps')
}

/**
 * 注册表文件路径：`<home>/dsh-web-app/registry.json`。
 * @returns {string}
 */
export function registryPath(configured, env) {
  return join(resolveDshHome(configured, env), 'dsh-web-app', 'registry.json')
}

/**
 * 单个应用的仓库目录。name 必须是已过 validateName 的 kebab-case。
 * @param {string} name
 * @returns {string}
 */
export function appDir(name, configured, env) {
  return join(appsRoot(configured, env), name)
}
