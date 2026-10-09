/** lib/paths.js 与 lib/registry.js。 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveDshHome, expandHomePath, appsRoot, registryPath, appDir } from '../lib/paths.js'
import { emptyRegistry, loadRegistry, saveRegistry, getApp, putApp, removeApp, listApps } from '../lib/registry.js'
import { initRepo } from '../lib/git.js'
import { useTmpDshHome } from './helpers.mjs'

test('resolveDshHome：优先级 configured > $DSH_HOME > ~/.dsh', () => {
  const env = { DSH_HOME: '  ' }
  assert.equal(resolveDshHome('/explicit/home', env), '/explicit/home')
  env.DSH_HOME = 'X:\\dsh-home'
  assert.equal(resolveDshHome(undefined, env), 'X:\\dsh-home')
  assert.equal(resolveDshHome('  ', env), 'X:\\dsh-home') // 空白 configured 视为未设
  env.DSH_HOME = '   ' // 空白 $DSH_HOME 视为未设
  const fallback = resolveDshHome(undefined, env)
  assert.ok(fallback.endsWith('.dsh'), fallback)
})

test('resolveDshHome：~ 展开', () => {
  const env = { DSH_HOME: '~/somewhere' }
  const home = resolveDshHome(undefined, env)
  assert.ok(!home.includes('~'), home)
  assert.ok(home.endsWith('somewhere'), home)
  assert.equal(expandHomePath('~'), expandHomePath('~'))
})

test('appsRoot / registryPath / appDir 布局', () => {
  const env = { DSH_HOME: 'H:\\dsh' }
  assert.equal(appsRoot(undefined, env), 'H:\\dsh\\dsh-web-app\\apps')
  assert.equal(registryPath(undefined, env), 'H:\\dsh\\dsh-web-app\\registry.json')
  assert.equal(appDir('config-panel', undefined, env), 'H:\\dsh\\dsh-web-app\\apps\\config-panel')
})

test('registry：save/load 往返', async () => {
  const { home, restore } = useTmpDshHome()
  try {
    const reg = emptyRegistry()
    putApp(reg, { name: 'config-panel', description: '简介', repoPath: join(home, 'dsh-web-app', 'apps', 'config-panel') })
    await saveRegistry(reg)
    const raw = JSON.parse(await fs.readFile(registryPath(), 'utf8'))
    assert.equal(raw.version, 1)
    assert.ok(raw.apps['config-panel'])
    const loaded = await loadRegistry(() => assert.fail('不应告警'))
    assert.deepEqual(loaded, reg)
    // 文件不存在 → 空表（ENOENT 不告警）
    await fs.rm(registryPath())
    const empty = await loadRegistry(() => assert.fail('ENOENT 不应告警'))
    assert.deepEqual(empty, emptyRegistry())
  } finally {
    restore()
  }
})

test('registry：损坏文件降级为空表 + warn', async () => {
  const { restore } = useTmpDshHome()
  try {
    await fs.mkdir(join(registryPath(), '..'), { recursive: true })
    await fs.writeFile(registryPath(), '{ not json', 'utf8')
    const warnings = []
    const reg = await loadRegistry((m) => warnings.push(m))
    assert.deepEqual(reg, emptyRegistry())
    assert.equal(warnings.length, 1)
  } finally {
    restore()
  }
})

test('registry：getApp/putApp/removeApp', () => {
  const reg = emptyRegistry()
  assert.equal(getApp(reg, 'nope'), null)
  putApp(reg, { name: 'a', description: 'd', repoPath: '/x/a' })
  assert.equal(getApp(reg, 'a').description, 'd')
  assert.equal(getApp(reg, 'a').branch, 'main') // branch 默认 main
  assert.equal(removeApp(reg, 'a'), true)
  assert.equal(removeApp(reg, 'a'), false)
  assert.equal(getApp(reg, 'a'), null)
})

test('registry：listApps 现场解析 commit/version/exists/dirty', async () => {
  const { home, restore } = useTmpDshHome()
  try {
    const repo = join(home, 'repo-a')
    await fs.writeFile(join(repo, 'index.html'), '<html></html>', 'utf8').catch(() => {})
    await fs.mkdir(repo, { recursive: true })
    await fs.writeFile(join(repo, 'index.html'), '<html></html>', 'utf8')
    await initRepo(repo, 'first')
    const reg = emptyRegistry()
    putApp(reg, { name: 'app-a', description: 'A', repoPath: repo })
    putApp(reg, { name: 'ghost', description: '目录不存在', repoPath: join(home, 'no-such-dir') })
    const apps = await listApps(reg)
    assert.equal(apps.length, 2)
    const a = apps.find((x) => x.name === 'app-a')
    assert.match(a.commit, /^[0-9a-f]{40}$/)
    assert.equal(a.version, `main@${a.commit.slice(0, 7)}`)
    assert.equal(a.exists, true)
    assert.equal(a.dirty, false)
    // 弄脏工作树
    await fs.writeFile(join(repo, 'index.html'), 'dirty', 'utf8')
    const apps2 = await listApps(reg)
    assert.equal(apps2.find((x) => x.name === 'app-a').dirty, true)
    const ghost = apps2.find((x) => x.name === 'ghost')
    assert.equal(ghost.exists, false)
    assert.equal(ghost.commit, null)
    assert.equal(ghost.version, 'main') // 解析不到时只给 branch
  } finally {
    restore()
  }
})
