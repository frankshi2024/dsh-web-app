/** lib/tools-check.js：对刚部署的 app 全过；破坏后对应项 fail。 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { checkExecute, registerCheckTool, CHECK_TOOL_NAME } from '../lib/tools-check.js'
import { deployExecute } from '../lib/tools-deploy.js'
import { appDir } from '../lib/paths.js'
import { useTmpDshHome, readExample } from './helpers.mjs'

async function deployExample() {
  const example = await readExample()
  const result = await deployExecute({ name: 'config-panel', ...example })
  assert.equal(result.ok, true)
  return example
}

test('check：examples/config-panel 全过（§7 六项）', async () => {
  const { restore } = useTmpDshHome()
  try {
    await deployExample()
    const result = await checkExecute({ name: 'config-panel' })
    assert.equal(result.ok, true)
    assert.equal(result.results.length, 6)
    assert.deepEqual(result.results.map((r) => r.id), ['files', 'schema', 'template', 'bridge', 'placeholders', 'git'])
    for (const r of result.results) {
      assert.equal(r.pass, true, `${r.id} 应通过：${r.detail ?? ''}`)
    }
  } finally {
    restore()
  }
})

test('check：应用不存在 → 结构化错误', async () => {
  const { restore } = useTmpDshHome()
  try {
    const result = await checkExecute({ name: 'nope' })
    assert.equal(result.ok, false)
    assert.match(result.error, /未部署/)
  } finally {
    restore()
  }
})

test('check：破坏 app.json（去掉 confirm）→ schema 项 fail', async () => {
  const { restore } = useTmpDshHome()
  try {
    await deployExample()
    const dir = appDir('config-panel')
    const appJson = JSON.parse(await fs.readFile(join(dir, 'app.json'), 'utf8'))
    delete appJson.confirm
    await fs.writeFile(join(dir, 'app.json'), JSON.stringify(appJson, null, 2), 'utf8')
    const result = await checkExecute({ name: 'config-panel' })
    assert.equal(result.ok, false)
    const schema = result.results.find((r) => r.id === 'schema')
    assert.equal(schema.pass, false)
    assert.match(schema.detail, /confirm/)
  } finally {
    restore()
  }
})

test('check：HTML 塞变量占位符 → placeholders 项 fail', async () => {
  const { restore } = useTmpDshHome()
  try {
    await deployExample()
    const dir = appDir('config-panel')
    const html = await fs.readFile(join(dir, 'index.html'), 'utf8')
    await fs.writeFile(join(dir, 'index.html'), html + '\n<!-- {{TEXT_1}} -->\n', 'utf8')
    const result = await checkExecute({ name: 'config-panel' })
    const ph = result.results.find((r) => r.id === 'placeholders')
    assert.equal(ph.pass, false)
    assert.match(ph.detail, /TEXT_1/)
  } finally {
    restore()
  }
})

test('check：删掉回传桥 → bridge 项 fail', async () => {
  const { restore } = useTmpDshHome()
  try {
    await deployExample()
    const dir = appDir('config-panel')
    const html = await fs.readFile(join(dir, 'index.html'), 'utf8')
    await fs.writeFile(join(dir, 'index.html'), html.replaceAll('postMessage', 'sendMessage'), 'utf8')
    const result = await checkExecute({ name: 'config-panel' })
    assert.equal(result.results.find((r) => r.id === 'bridge').pass, false)
  } finally {
    restore()
  }
})

test('check：弄脏工作树 → git 项 fail', async () => {
  const { restore } = useTmpDshHome()
  try {
    await deployExample()
    await fs.writeFile(join(appDir('config-panel'), 'index.html'), 'dirty', 'utf8')
    const result = await checkExecute({ name: 'config-panel' })
    const git = result.results.find((r) => r.id === 'git')
    assert.equal(git.pass, false)
    assert.match(git.detail, /未提交/)
  } finally {
    restore()
  }
})

test('check 工具注册形状', async () => {
  const ctx = (await import('./helpers.mjs')).fakeCtx()
  registerCheckTool(ctx)
  const def = ctx.__tools[0]
  assert.equal(def.name, CHECK_TOOL_NAME)
  assert.deepEqual(def.parameters.required, ['name'])
  assert.equal(def.parameters.additionalProperties, false)
  const [card] = def.output.render(null, {
    ok: false, name: 'x',
    results: [
      { id: 'a', label: '通过项', pass: true },
      { id: 'b', label: '失败项', pass: false, detail: '原因' },
    ],
  })
  assert.match(card.text, /✅ 通过项/)
  assert.match(card.text, /❌ 失败项/)
})
