/**
 * 测试共享 helper：隔离 DSH_HOME、捕获 tools.register 的 definition、
 * 部署 examples/config-panel 三件套。
 */

import { promises as fs } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'config-panel')

function dirname(p) {
  return p.replace(/[/\\][^/\\]*$/, '')
}

/** 建一个临时 DSH_HOME 并写进 process.env；返回恢复函数。 */
export function useTmpDshHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-web-app-test-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  return {
    home,
    restore() {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    },
  }
}

/** 读取 examples/config-panel 三件套。 */
export async function readExample() {
  const [html, appJsonRaw, template] = await Promise.all([
    fs.readFile(join(EXAMPLES, 'index.html'), 'utf8'),
    fs.readFile(join(EXAMPLES, 'app.json'), 'utf8'),
    fs.readFile(join(EXAMPLES, 'callback.template.md'), 'utf8'),
  ])
  return { html, metadata: JSON.parse(appJsonRaw), template }
}

/** 假 ctx：捕获 tools.register / commands.register 的 definition，吞掉 logger。 */
export function fakeCtx() {
  const tools = []
  const commands = []
  return {
    tools: { register: (d) => { tools.push(d); return () => {} } },
    commands: { register: (d) => { commands.push(d); return () => {} } },
    skills: { register: (d) => { commands.push({ kind: 'skill', ...d }); return () => {} } },
    get: () => undefined,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    effect: (fn) => fn(),
    __tools: tools,
    __commands: commands,
  }
}

export { join }
