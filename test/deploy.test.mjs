/** lib/tools-deploy.js 核心流程（直接调 deployExecute，tmp HOME 隔离）。 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { deployExecute, registerDeployTool, DEPLOY_TOOL_NAME } from '../lib/tools-deploy.js'
import { registryPath, appDir } from '../lib/paths.js'
import { loadRegistry, getApp } from '../lib/registry.js'
import { headCommit, isClean, commitCount, showFile } from '../lib/git.js'
import { useTmpDshHome, readExample, fakeCtx } from './helpers.mjs'

test('deploy：examples/config-panel 三件套部署成功', async () => {
  const { home, restore } = useTmpDshHome()
  try {
    const example = await readExample()
    const result = await deployExecute({ name: 'config-panel', ...example })
    assert.equal(result.ok, true)
    assert.equal(result.name, 'config-panel')
    assert.equal(result.branch, 'main')
    assert.match(result.commit, /^[0-9a-f]{40}$/)
    assert.equal(result.version, `main@${result.commit.slice(0, 7)}`)
    assert.equal(result.serveUrl, '/dsh-web-app/apps/config-panel/')
    assert.ok(result.repoPath.startsWith(join(home, 'dsh-web-app', 'apps')))

    // 三件套落盘
    const dir = appDir('config-panel')
    assert.equal(await fs.readFile(join(dir, 'index.html'), 'utf8'), example.html)
    assert.equal(JSON.parse(await fs.readFile(join(dir, 'app.json'), 'utf8')).name, 'config-panel')
    assert.equal(await fs.readFile(join(dir, 'callback.template.md'), 'utf8'), example.template)

    // git 初始化 + 首提交
    assert.equal(await isClean(dir), true)
    assert.equal(await commitCount(dir), 1)
    assert.equal(await showFile(dir, 'main', 'app.json'), JSON.stringify(example.metadata, null, 2) + '\n')

    // 注册表登记（repoPath + branch，不存死 commit）
    const reg = await loadRegistry()
    const entry = getApp(reg, 'config-panel')
    assert.equal(entry.repoPath, dir)
    assert.equal(entry.branch, 'main')
    assert.equal(entry.description, example.metadata.description)
  } finally {
    restore()
  }
})

test('deploy：同名二次部署被拒', async () => {
  const { restore } = useTmpDshHome()
  try {
    const example = await readExample()
    const first = await deployExecute({ name: 'config-panel', ...example })
    assert.equal(first.ok, true)
    const second = await deployExecute({ name: 'config-panel', ...example })
    assert.equal(second.ok, false)
    assert.ok(second.error.message.includes('已存在'))
    assert.equal(await commitCount(appDir('config-panel')), 1) // 什么都没动
  } finally {
    restore()
  }
})

test('deploy：校验失败不创建任何东西', async () => {
  const { restore } = useTmpDshHome()
  try {
    const example = await readExample()
    // HTML 含变量占位符（违规）+ confirm 缺省（违规）
    const bad = await deployExecute({
      name: 'bad-app',
      html: example.html.replace('{{__TOKEN__}}', '{{TEXT_1}}'),
      metadata: { ...example.metadata, name: 'bad-app', confirm: undefined },
      template: example.template,
    })
    assert.equal(bad.ok, false)
    assert.ok(bad.error.issues.length >= 2)
    const dir = appDir('bad-app')
    assert.equal(await fs.stat(dir).then(() => true).catch(() => false), false)
    assert.equal(await fs.stat(registryPath()).then(() => true).catch(() => false), false)
  } finally {
    restore()
  }
})

test('deploy：非法 name 被拒', async () => {
  const { restore } = useTmpDshHome()
  try {
    const example = await readExample()
    const result = await deployExecute({ name: 'Bad_Name', ...example })
    assert.equal(result.ok, false)
    assert.ok(result.error.issues.some((i) => i.includes('kebab-case')))
  } finally {
    restore()
  }
})

test('deploy 工具注册形状：name/description/parameters/output', async () => {
  const ctx = fakeCtx()
  registerDeployTool(ctx)
  assert.equal(ctx.__tools.length, 1)
  const def = ctx.__tools[0]
  assert.equal(def.name, DEPLOY_TOOL_NAME)
  assert.match(def.description, /首次部署/)
  assert.match(def.description, /同名/)
  assert.deepEqual(def.parameters.required, ['name', 'html', 'metadata', 'template'])
  assert.equal(def.parameters.additionalProperties, false)
  assert.equal(typeof def.execute, 'function')
  assert.equal(typeof def.output.render, 'function')
  // render 给文本卡片
  const [card] = def.output.render(null, { ok: true, name: 'x', repoPath: '/p', branch: 'main', commit: 'a'.repeat(40), version: 'main@aaaaaaa', serveUrl: '/dsh-web-app/apps/x/', nextSteps: ['s1'] })
  assert.equal(card.type, 'text')
  assert.match(card.text, /已部署/)
  const [bad] = def.output.render(null, { ok: false, error: { message: 'm', issues: ['i1'] } })
  assert.match(bad.text, /❌/)
})
