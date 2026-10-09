/**
 * dsh-web-app — git 助手。
 *
 * 职责：每个 webapp 目录是一个 Git 仓库（callback-contract §1），这里封装
 * 插件需要的全部 git 操作。
 *
 * 纪律：
 *   - 所有调用走 node:child_process 的 execFile（promisify），参数数组传递，
 *     绝不 shell 拼接路径（仓库路径是用户数据，可能含空格/特殊字符）；
 *   - 统一 `git -C <repo> ...`，不依赖进程 cwd；
 *   - 命令失败时返回 null/false/0 的助手绝不 throw（伺服路径要优雅降级）；
 *     只有 initRepo 会向上抛（部署是写路径，失败必须让调用方知道）。
 */

import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

const GIT_MAX_BUFFER = 16 * 1024 * 1024

/**
 * 在指定仓库目录执行 git 命令（自动带 -C <repo>）。
 * @param {string} repo - 仓库目录（git -C 的目标）。
 * @param {string[]} args - git 子命令参数（不含 `git` 本身）。
 * @returns {Promise<{stdout:string,stderr:string}>}
 * @throws 非零退出时抛出的 error 带 stdout/stderr/code。
 */
export async function git(repo, args) {
  return execFileP('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: GIT_MAX_BUFFER,
    // 与仓库内容无关的环境固定：避免用户全局 pager/别名干扰机器可读输出。
    env: { ...process.env, GIT_PAGER: 'cat', PAGER: 'cat' },
  })
}

/**
 * 初始化仓库并做首次提交：init -b main + add -A + commit。
 * commit 失败且报身份缺失时，用 repo-local 的 -c user.name/-c user.email
 * 重试一次（不污染用户全局 git 配置；很多机器没有配全局身份）。
 * @param {string} dir - 仓库目录（不存在则创建）。
 * @param {string} message - 首提交信息。
 * @returns {Promise<void>}
 * @throws 初始化或提交失败时抛出（带 stderr 摘要）。
 */
export async function initRepo(dir, message) {
  await fs.mkdir(dir, { recursive: true })
  await git(dir, ['init', '-b', 'main'])
  await git(dir, ['add', '-A'])
  try {
    await git(dir, ['commit', '-m', message])
  } catch (error) {
    const stderr = String(error?.stderr ?? '')
    if (!/user\.name|user\.email|who you are|unable to auto-detect/i.test(stderr)) throw error
    await git(dir, ['-c', 'user.name=dsh-web-app', '-c', 'user.email=dsh-web-app@localhost', 'commit', '-m', message])
  }
}

/**
 * 分支头提交的完整 hash。
 * @param {string} dir
 * @param {string} [branch='main']
 * @returns {Promise<string|null>} 无提交/分支不存在/命令失败返回 null。
 */
export async function headCommit(dir, branch = 'main') {
  try {
    const { stdout } = await git(dir, ['rev-parse', `refs/heads/${branch}`])
    const hash = stdout.trim()
    return /^[0-9a-f]{40}$/.test(hash) ? hash : null
  } catch {
    return null
  }
}

/**
 * 完整 hash → 短 hash（前 7 位；与 `git rev-parse --short` 的常规输出一致）。
 * @param {string|null|undefined} hash
 * @returns {string|null}
 */
export function shortCommit(hash) {
  return typeof hash === 'string' && hash.length >= 7 ? hash.slice(0, 7) : null
}

/**
 * 工作树是否干净（status --porcelain 输出为空）。
 * @param {string} dir
 * @returns {Promise<boolean>}
 */
export async function isClean(dir) {
  try {
    const { stdout } = await git(dir, ['status', '--porcelain'])
    return stdout.trim() === ''
  } catch {
    return false
  }
}

/**
 * 当前分支提交数。
 * @param {string} dir
 * @returns {Promise<number>} 命令失败返回 0。
 */
export async function commitCount(dir) {
  try {
    const { stdout } = await git(dir, ['rev-list', '--count', 'HEAD'])
    const n = Number.parseInt(stdout.trim(), 10)
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

/**
 * 读取 ref（分支/tag/hash）处某个文件的完整内容（`git show <ref>:<path>`）。
 * 这是「按部署指针出文件」的核心：伺服/JSON API 读的都是提交处内容，
 * 不是工作树（工作树可能脏）。
 * @param {string} dir
 * @param {string} ref - 如 'main' 或完整 hash。
 * @param {string} path - 仓库内相对路径（正斜杠）。
 * @returns {Promise<string|null>} 文件不存在/ref 无效/命令失败返回 null。
 */
export async function showFile(dir, ref, path) {
  try {
    const { stdout } = await git(dir, ['show', `${ref}:${path}`])
    return stdout
  } catch {
    return null
  }
}
