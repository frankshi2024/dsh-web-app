/** lib/skills.js（frontmatter 解析 + 注册）与 lib/command.js（/webapp handler）。 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { splitFrontmatter, parseFrontmatter, registerSkills } from '../lib/skills.js'
import { registerCommand } from '../lib/command.js'
import { deployExecute } from '../lib/tools-deploy.js'
import { useTmpDshHome, readExample, fakeCtx } from './helpers.mjs'

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')

test('splitFrontmatter：剥离 --- 块，保留正文', () => {
  const raw = '---\r\nname: x\r\n---\r\n# 正文\r\n'
  const { frontmatter, content } = splitFrontmatter(raw)
  assert.equal(frontmatter, 'name: x')
  assert.equal(content, '# 正文\r\n')
  const none = splitFrontmatter('# 无 frontmatter')
  assert.equal(none.frontmatter, '')
  assert.equal(none.content, '# 无 frontmatter')
})

test('parseFrontmatter：只认标量字段，值去引号', () => {
  const meta = parseFrontmatter('name: dsh-web-app-author\ndescription: "带引号的一段话"\nwhenToUse: 无引号\nother: [a, b]')
  assert.equal(meta.name, 'dsh-web-app-author')
  assert.equal(meta.description, '带引号的一段话')
  assert.equal(meta.whenToUse, '无引号')
  assert.equal(meta.other, '[a, b]') // 简易版不做数组语义，原样保留
})

test('registerSkills：读包内 skills 目录并注册（含 whenToUse/content/source/path）', () => {
  const registered = []
  const service = { register: (d) => { registered.push(d); return () => {} } }
  const ctx = {
    ...fakeCtx(),
    skills: service,
    get: (name) => (name === 'skills' ? service : undefined),
  }
  const dispose = registerSkills(ctx)
  assert.equal(registered.length, 2)
  const author = registered.find((s) => s.name === 'dsh-web-app-author')
  assert.ok(author)
  assert.equal(author.source, 'bundled')
  assert.match(author.path, /skills[/\\]dsh-web-app-author\.md$/)
  assert.match(author.content, /# dsh-web-app-author/)
  assert.ok(!author.content.startsWith('---'), 'frontmatter 应被剥掉')
  assert.match(author.description, /回传/)
  assert.ok(author.whenToUse)
  const interpret = registered.find((s) => s.name === 'dsh-web-app-interpret')
  assert.ok(interpret)
  // 磁盘上的 frontmatter 与注册值一致
  const raw = readFileSync(join(SKILLS_DIR, 'dsh-web-app-author.md'), 'utf8')
  assert.equal(author.description, parseFrontmatter(splitFrontmatter(raw).frontmatter).description)
  dispose()
})

test('registerSkills：无 skills 服务时 warn 跳过、返回 no-op', () => {
  const warnings = []
  const ctx = { ...fakeCtx(), get: () => undefined, logger: { warn: (m) => warnings.push(m) } }
  const dispose = registerSkills(ctx)
  assert.equal(typeof dispose, 'function')
  dispose()
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /skills/)
})

test('/webapp 命令 handler：空输入/未部署/已部署', async () => {
  const { restore } = useTmpDshHome()
  try {
    const captured = []
    const ctx = { ...fakeCtx(), commands: { register: (d) => { captured.push(d); return () => {} } } }
    registerCommand(ctx)
    assert.equal(captured.length, 1)
    const def = captured[0]
    assert.equal(def.name, 'webapp')
    assert.match(def.description, /不触发模型调用/)
    assert.equal(def.input.hint, '应用名（可选，留空在卡片中选择）')

    const handler = def.handler
    assert.deepEqual(await handler({ rawInput: '   ' }), { kind: 'success', text: '在卡片中选择应用' })

    const missing = await handler({ rawInput: 'nope-app' })
    assert.equal(missing.kind, 'error')
    assert.match(missing.text, /未部署的应用 "nope-app"/)

    await deployExecute({ name: 'config-panel', ...(await readExample()) })
    assert.deepEqual(await handler({ rawInput: ' config-panel ' }), { kind: 'success', text: '打开 config-panel' })
  } finally {
    restore()
  }
})
