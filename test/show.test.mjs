/**
 * dsh-web-app-show 工具测试：校验存在性、版本解析、expand 语义。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useTmpDshHome, readExample } from './helpers.mjs'
import { deployExecute } from '../lib/tools-deploy.js'
import { showExecute } from '../lib/tools-show.js'

test('show：已部署应用返回 ok + 版本 + expand 默认 false', async () => {
  const tmp = useTmpDshHome()
  try {
    const { html, metadata, template } = await readExample()
    const deployed = await deployExecute({ name: 'config-panel', html, metadata, template })
    assert.equal(deployed.ok, true)

    const shown = await showExecute({ name: 'config-panel' })
    assert.equal(shown.ok, true)
    assert.equal(shown.name, 'config-panel')
    assert.equal(shown.expand, false)
    assert.match(shown.version, /^main@[0-9a-f]{7}$/)
    assert.equal(shown.description, metadata.description)
  } finally {
    tmp.restore()
  }
})

test('show：expand=true 透传', async () => {
  const tmp = useTmpDshHome()
  try {
    const { html, metadata, template } = await readExample()
    await deployExecute({ name: 'config-panel', html, metadata, template })
    const shown = await showExecute({ name: 'config-panel', expand: true })
    assert.equal(shown.ok, true)
    assert.equal(shown.expand, true)
  } finally {
    tmp.restore()
  }
})

test('show：未部署应用返回结构化错误', async () => {
  const tmp = useTmpDshHome()
  try {
    const shown = await showExecute({ name: 'nope' })
    assert.equal(shown.ok, false)
    assert.match(shown.error, /未部署/)
  } finally {
    tmp.restore()
  }
})
