/**
 * dsh-web-app — 应用注册表（registry.json）。
 *
 * 文件位置：`<DSH_HOME>/dsh-web-app/registry.json`，形状：
 *   { version: 1, apps: { [name]: { description, repoPath, branch } } }
 *
 * 设计要点（mvp-design §7、callback-contract）：
 *   - 注册表只存部署指针的分支，**不存死 commit**——deployedRef.commit 每次
 *     读取时用 git.headCommit 现场解析（「默认指向主分支最新提交」）；
 *   - saveRegistry 原子写（tmp + rename），崩溃中途不留半个 JSON；
 *   - loadRegistry 对缺失/损坏降级为空表 + warn——注册表坏了不该拖垮插件；
 *   - listApps 是异步且宽容的：解析不到的条目照样列出来并标 error，绝不 throw。
 */

import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { registryPath } from './paths.js'
import { headCommit, shortCommit, isClean } from './git.js'

/** @returns {{version:1, apps:Object<string,{description:string,repoPath:string,branch:string}>}} */
export function emptyRegistry() {
  return { version: 1, apps: {} }
}

/**
 * 读取注册表。
 * @param {(message:string)=>void} [warn] - 降级时的告警通道（插件传 ctx.logger.warn）。
 * @returns {Promise<object>} 文件缺失/损坏时返回空表。
 */
export async function loadRegistry(warn = (m) => console.warn(m)) {
  let raw
  try {
    raw = await fs.readFile(registryPath(), 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') warn(`dsh-web-app: registry.json 读取失败，按空注册表处理（${error.message}）`)
    return emptyRegistry()
  }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || typeof parsed.apps !== 'object' || parsed.apps === null || Array.isArray(parsed.apps)) {
      throw new Error('形状不对（需要 { version, apps: {…} }）')
    }
    return { version: 1, apps: parsed.apps }
  } catch (error) {
    warn(`dsh-web-app: registry.json 损坏，按空注册表处理（${error.message}）`)
    return emptyRegistry()
  }
}

/**
 * 原子写注册表：先写临时文件再 rename（同目录 rename 在 Windows/Linux 都是原子的）。
 * @param {{apps:Object}} reg
 * @returns {Promise<void>}
 */
export async function saveRegistry(reg) {
  const file = registryPath()
  await fs.mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, JSON.stringify({ version: 1, apps: reg.apps ?? {} }, null, 2) + '\n', 'utf8')
  await fs.rename(tmp, file)
}

/**
 * @param {{apps:Object}} reg
 * @param {string} name
 * @returns {object|null}
 */
export function getApp(reg, name) {
  const entry = reg?.apps?.[name]
  return entry === undefined ? null : entry
}

/**
 * 登记/覆盖一个应用（deploy 用；branch 默认 main）。
 * @param {{apps:Object}} reg
 * @param {{name:string, description:string, repoPath:string, branch?:string}} entry
 */
export function putApp(reg, entry) {
  reg.apps[entry.name] = {
    description: entry.description,
    repoPath: entry.repoPath,
    branch: entry.branch ?? 'main',
  }
}

/**
 * 移除注册表条目（delete API 用；目录删除由调用方负责）。
 * @param {{apps:Object}} reg
 * @param {string} name
 * @returns {boolean} 是否真的删掉了东西。
 */
export function removeApp(reg, name) {
  if (!Object.hasOwn(reg.apps, name)) return false
  delete reg.apps[name]
  return true
}

/**
 * 列出全部应用，现场解析部署指针（headCommit）与仓库状态（exists/dirty）。
 * 这是注册表读取唯一正确的入口——registry.json 里不缓存 commit。
 * @param {{apps:Object}} reg
 * @returns {Promise<Array<{name:string, description:string, repoPath:string, branch:string,
 *   commit:string|null, version:string, exists:boolean, dirty:boolean, error?:string}>>}
 */
export async function listApps(reg) {
  const out = []
  for (const [name, entry] of Object.entries(reg?.apps ?? {})) {
    const repoPath = typeof entry?.repoPath === 'string' ? entry.repoPath : ''
    const branch = typeof entry?.branch === 'string' && entry.branch !== '' ? entry.branch : 'main'
    const base = {
      name,
      description: typeof entry?.description === 'string' ? entry.description : '',
      repoPath,
      branch,
    }
    try {
      const exists = repoPath !== '' && await fs.stat(repoPath).then((s) => s.isDirectory()).catch(() => false)
      const commit = exists ? await headCommit(repoPath, branch) : null
      const dirty = exists ? !(await isClean(repoPath)) : false
      out.push({
        ...base,
        commit,
        version: commit !== null ? `${branch}@${shortCommit(commit)}` : branch,
        exists,
        dirty,
      })
    } catch (error) {
      // 解析不到的条目也列出来并标 error——面板要能看到尸体，而不是静默消失。
      out.push({ ...base, commit: null, version: branch, exists: false, dirty: false, error: error?.message ?? String(error) })
    }
  }
  return out
}
