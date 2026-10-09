/** lib/git.js 真跑 git（临时目录）。 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initRepo, headCommit, shortCommit, isClean, commitCount, showFile } from '../lib/git.js'

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), 'dsh-web-app-git-'))
}

test('initRepo：init -b main + add -A + commit', async () => {
  const dir = await tmpRepo()
  await fs.writeFile(join(dir, 'a.txt'), 'hello', 'utf8')
  await fs.mkdir(join(dir, 'sub'))
  await fs.writeFile(join(dir, 'sub', 'b.txt'), 'world', 'utf8')
  await initRepo(dir, '首次部署')
  assert.match(await headCommit(dir), /^[0-9a-f]{40}$/)
  assert.equal(await isClean(dir), true)
  assert.equal(await commitCount(dir), 1)
  assert.equal(await showFile(dir, 'main', 'a.txt'), 'hello')
  assert.equal(await showFile(dir, 'main', 'sub/b.txt'), 'world')
})

test('headCommit：无提交仓库返回 null', async () => {
  const dir = await tmpRepo()
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  await promisify(execFile)('git', ['-C', dir, 'init', '-b', 'main'])
  assert.equal(await headCommit(dir), null)
  assert.equal(await headCommit(dir, 'no-such-branch'), null)
  assert.equal(await commitCount(dir), 0)
})

test('isClean：脏工作树', async () => {
  const dir = await tmpRepo()
  await fs.writeFile(join(dir, 'a.txt'), '1', 'utf8')
  await initRepo(dir, 'c1')
  assert.equal(await isClean(dir), true)
  await fs.writeFile(join(dir, 'a.txt'), '2', 'utf8')
  assert.equal(await isClean(dir), false)
  // 未跟踪文件也算脏
  await fs.writeFile(join(dir, 'new.txt'), 'n', 'utf8')
  assert.equal(await isClean(dir), false)
})

test('showFile：文件不存在返回 null', async () => {
  const dir = await tmpRepo()
  await fs.writeFile(join(dir, 'a.txt'), 'x', 'utf8')
  await initRepo(dir, 'c1')
  assert.equal(await showFile(dir, 'main', 'nope.txt'), null)
  assert.equal(await showFile(dir, 'deadbeef'.repeat(5), 'a.txt'), null)
})

test('shortCommit：前 7 位；showFile 按 ref 读历史版本', async () => {
  const dir = await tmpRepo()
  await fs.writeFile(join(dir, 'a.txt'), 'v1', 'utf8')
  await initRepo(dir, 'c1')
  const first = await headCommit(dir)
  assert.equal(shortCommit(first), first.slice(0, 7))
  assert.match(shortCommit('abc123def456'), /^abc123d/)
  assert.equal(shortCommit(null), null)
  assert.equal(shortCommit('short'), null)
  await fs.writeFile(join(dir, 'a.txt'), 'v2', 'utf8')
  const { git } = await import('../lib/git.js')
  await git(dir, ['add', '-A'])
  await git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'c2'])
  // 工作树是 v2，但 first 提交处仍是 v1
  assert.equal(await showFile(dir, first, 'a.txt'), 'v1')
  assert.equal(await showFile(dir, 'main', 'a.txt'), 'v2')
})
