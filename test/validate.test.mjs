/** lib/validate.js 纯函数全覆盖。 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SLOT_RE,
  RESERVED,
  validateName,
  slotType,
  validateAppJson,
  scanPlaceholders,
  validateHtml,
  validateTemplate,
  renderTemplate,
  validateValues,
  stampHtml,
} from '../lib/validate.js'

test('validateName：kebab-case', () => {
  assert.equal(validateName('config-panel'), true)
  assert.equal(validateName('a'), true)
  assert.equal(validateName('1st-app2'), true) // 数字允许开头（与 skills 命名一致）
  assert.equal(validateName('Config-Panel'), false)
  assert.equal(validateName('config_panel'), false)
  assert.equal(validateName('config panel'), false)
  assert.equal(validateName('-config'), false)
  assert.equal(validateName('config-'), false)
  assert.equal(validateName('config--panel'), false)
  assert.equal(validateName(''), false)
  assert.equal(validateName(undefined), false)
  assert.equal(validateName(null), false)
  assert.equal(validateName(42), false)
})

test('SLOT_RE 词表与编号', () => {
  assert.ok(SLOT_RE.test('TEXT_1'))
  assert.ok(SLOT_RE.test('NUMBER_12'))
  assert.ok(SLOT_RE.test('BOOLEAN_1'))
  assert.ok(SLOT_RE.test('JSON_3'))
  assert.ok(!SLOT_RE.test('TEXT_0')) // 编号从 1 开始
  assert.ok(!SLOT_RE.test('TEXT_01')) // 不允许前导零
  assert.ok(!SLOT_RE.test('text_1'))
  assert.ok(!SLOT_RE.test('TEXT'))
  assert.ok(!SLOT_RE.test('FOO_1'))
  assert.ok(!SLOT_RE.test('JSON_n'))
})

test('slotType：JSON_n 是 string', () => {
  assert.equal(slotType('TEXT_1'), 'string')
  assert.equal(slotType('JSON_1'), 'string') // 关键特例：JSON 内容按字符串传输
  assert.equal(slotType('NUMBER_2'), 'number')
  assert.equal(slotType('BOOLEAN_1'), 'boolean')
  assert.equal(slotType('FOO_1'), null)
  assert.equal(slotType('TEXT_0'), null)
  assert.equal(slotType(42), null)
})

const goodVariables = [
  { slot: 'TEXT_1', label: '目标环境', purpose: '部署目标' },
  { slot: 'NUMBER_1', label: '并发数', purpose: '正整数' },
  { slot: 'BOOLEAN_1', label: '缓存', purpose: '开关' },
  { slot: 'JSON_1', label: '标签', purpose: 'JSON 数组字符串' },
]

test('validateAppJson：合法元数据通过', () => {
  assert.deepEqual(validateAppJson({
    name: 'config-panel',
    description: '一句话简介',
    confirm: true,
    variables: goodVariables,
  }), [])
})

test('validateAppJson：非 object 直接拒绝', () => {
  assert.equal(validateAppJson(null).length, 1)
  assert.equal(validateAppJson('x').length, 1)
  assert.equal(validateAppJson([]).length, 1)
})

test('validateAppJson：name 与 expectedName', () => {
  const issues = validateAppJson({
    name: 'other-name',
    description: 'ok',
    confirm: true,
    variables: [],
  }, 'config-panel')
  assert.ok(issues.some((i) => i.includes('不一致')))
})

test('validateAppJson：confirm 必须显式 boolean', () => {
  const base = { name: 'x', description: 'ok', variables: [] }
  assert.ok(validateAppJson(base).some((i) => i.includes('confirm')))
  assert.ok(validateAppJson({ ...base, confirm: 'yes' }).some((i) => i.includes('confirm')))
  assert.ok(validateAppJson({ ...base, confirm: 1 }).some((i) => i.includes('confirm')))
  assert.deepEqual(validateAppJson({ ...base, confirm: false }), [])
})

test('validateAppJson：description 非空 string', () => {
  const base = { name: 'x', confirm: true, variables: [] }
  assert.ok(validateAppJson({ ...base, description: '' }).some((i) => i.includes('description')))
  assert.ok(validateAppJson({ ...base, description: '   ' }).some((i) => i.includes('description')))
  assert.ok(validateAppJson({ ...base, description: 42 }).some((i) => i.includes('description')))
})

test('validateAppJson：variables 数组与各项 shape', () => {
  const base = { name: 'x', description: 'ok', confirm: true }
  assert.ok(validateAppJson(base).some((i) => i.includes('variables 必须是数组')))
  assert.ok(validateAppJson({ ...base, variables: 'nope' }).some((i) => i.includes('variables 必须是数组')))
  const bad = validateAppJson({
    ...base,
    variables: [
      { slot: 'BOGUS_1', label: '', purpose: '' },
      { slot: 'TEXT_0', label: 'ok', purpose: 'ok' },
      { slot: 'TEXT_1', label: 'ok', purpose: 'ok' },
      { slot: 'TEXT_1', label: 'dup', purpose: 'dup' },
      'not-an-object',
    ],
  })
  assert.ok(bad.some((i) => i.includes('BOGUS_1')))
  assert.ok(bad.some((i) => i.includes('TEXT_0')))
  assert.ok(bad.some((i) => i.includes('重复声明')))
  assert.ok(bad.some((i) => i.includes('variables[0].label')))
  assert.ok(bad.some((i) => i.includes('variables[0].purpose')))
  assert.ok(bad.some((i) => i.includes('variables[4]')))
})

test('scanPlaceholders：收集全部 {{...}} 名', () => {
  assert.deepEqual([...scanPlaceholders('a {{TEXT_1}} b {{ NUMBER_2 }} c {{__NAME__}} d')].sort(),
    ['NUMBER_2', 'TEXT_1', '__NAME__'])
  assert.deepEqual([...scanPlaceholders('')], [])
  assert.deepEqual([...scanPlaceholders(null)], [])
  assert.deepEqual([...scanPlaceholders('no placeholders')], [])
})

test('RESERVED 词表', () => {
  assert.deepEqual(RESERVED, ['__NAME__', '__VERSION__', '__TOKEN__'])
})

test('validateHtml：合法桥页面通过', async () => {
  const { readFile } = await import('node:fs/promises')
  const html = await readFile(new URL('../examples/config-panel/index.html', import.meta.url), 'utf8')
  assert.deepEqual(validateHtml(html), [])
})

test('validateHtml：变量占位符出现在 HTML 里也是 issue', () => {
  const issues = validateHtml('<html>{{TEXT_1}}</html>')
  assert.ok(issues.some((i) => i.includes('{{TEXT_1}}')))
})

test('validateHtml：缺桥迹象', () => {
  const base = '<html><script>{{__TOKEN__}} dsh-web-app postMessage submit</script></html>'
  assert.deepEqual(validateHtml(base), [])
  for (const missing of ['{{__TOKEN__}}', 'dsh-web-app', 'postMessage', 'submit']) {
    const broken = base.replace(missing, missing === 'submit' ? 'send' : 'x')
    const issues = validateHtml(broken)
    assert.ok(issues.length > 0, `缺少 ${missing} 应报错`)
  }
})

const goodTemplate = '[webapp 回传] 应用：{{__NAME__}}（{{__VERSION__}}）\n环境 {{TEXT_1}} 并发 {{NUMBER_1}} 缓存 {{BOOLEAN_1}} 标签 {{JSON_1}}'

test('validateTemplate：占位符 ⊆ 声明 ∪ 保留，开头检查', () => {
  assert.deepEqual(validateTemplate(goodTemplate, goodVariables), [])
  // 未声明占位符
  assert.ok(validateTemplate('[webapp 回传] {{TEXT_9}}', goodVariables).some((i) => i.includes('TEXT_9')))
  // __TOKEN__ 不允许进模板
  assert.ok(validateTemplate('[webapp 回传] {{__TOKEN__}}', goodVariables).some((i) => i.includes('__TOKEN__')))
  // 开头不对
  assert.ok(validateTemplate('应用：{{TEXT_1}}', goodVariables).some((i) => i.includes('开头')))
  // 非空 string
  assert.equal(validateTemplate('', goodVariables).length, 1)
})

test('validateTemplate：声明变量须被模板或页面使用', () => {
  // BOOLEAN_1/JSON_1 没出现在模板里 → issue
  const partial = '[webapp 回传] 应用：{{__NAME__}}（{{__VERSION__}}）\n环境 {{TEXT_1}} 并发 {{NUMBER_1}}'
  const issues = validateTemplate(partial, goodVariables)
  assert.ok(issues.some((i) => i.includes('BOOLEAN_1')))
  assert.ok(issues.some((i) => i.includes('JSON_1')))
  // 传了 html 且页面里用了 → 通过
  const html = '<script>var b = "{{BOOLEAN_1}}"; var j = "{{JSON_1}}";</script>'
  assert.deepEqual(validateTemplate(partial, goodVariables, html), [])
})

test('renderTemplate：全局替换 + 边界', () => {
  const out = renderTemplate('n={{__NAME__}} v={{__VERSION__}} t={{TEXT_1}} t2={{TEXT_1}} n={{__NAME__}}', {
    name: 'config-panel',
    version: 'main@abc1234',
    values: { TEXT_1: 'prod' },
  })
  assert.equal(out, 'n=config-panel v=main@abc1234 t=prod t2=prod n=config-panel')
  // 重复出现的占位符全部替换；String(v) 语义（number/boolean）
  const out2 = renderTemplate('{{NUMBER_1}}/{{BOOLEAN_1}}', {
    name: 'x', version: 'y', values: { NUMBER_1: 4, BOOLEAN_1: true },
  })
  assert.equal(out2, '4/true')
  // values 里没有的键不影响输出；未声明占位符原样保留
  const out3 = renderTemplate('{{TEXT_9}} {{__TOKEN__}}', { name: 'x', version: 'y', values: {} })
  assert.equal(out3, '{{TEXT_9}} {{__TOKEN__}}')
})

test('validateValues：键集合严格相等 + 类型', () => {
  const vars = [{ slot: 'TEXT_1' }, { slot: 'NUMBER_1' }, { slot: 'BOOLEAN_1' }, { slot: 'JSON_1' }]
  assert.deepEqual(validateValues({
    TEXT_1: 'prod', NUMBER_1: 4, BOOLEAN_1: false, JSON_1: '[]',
  }, vars), [])
  // 缺键
  assert.ok(validateValues({ TEXT_1: 'prod' }, vars).some((i) => i.includes('缺少')))
  // 多键
  assert.ok(validateValues({ TEXT_1: 'a', NUMBER_1: 1, BOOLEAN_1: true, JSON_1: '[]', TEXT_2: 'x' }, vars)
    .some((i) => i.includes('未声明')))
  // 类型错误
  assert.ok(validateValues({ TEXT_1: 1, NUMBER_1: 4, BOOLEAN_1: false, JSON_1: '[]' }, vars)
    .some((i) => i.includes('TEXT_1')))
  assert.ok(validateValues({ TEXT_1: 'a', NUMBER_1: '4', BOOLEAN_1: false, JSON_1: '[]' }, vars)
    .some((i) => i.includes('NUMBER_1')))
  // JSON_1 必须 string，不是数组
  assert.ok(validateValues({ TEXT_1: 'a', NUMBER_1: 4, BOOLEAN_1: false, JSON_1: [] }, vars)
    .some((i) => i.includes('JSON_1')))
  // number 必须 finite
  assert.ok(validateValues({ TEXT_1: 'a', NUMBER_1: Infinity, BOOLEAN_1: false, JSON_1: '[]' }, vars)
    .some((i) => i.includes('finite')))
  assert.ok(validateValues({ TEXT_1: 'a', NUMBER_1: NaN, BOOLEAN_1: false, JSON_1: '[]' }, vars)
    .some((i) => i.includes('finite')))
  // values 非 object
  assert.equal(validateValues('nope', vars).length, 1)
})

test('stampHtml：三个保留占位符全局替换 + meta 注入', () => {
  const html = '<head></head><body><script>const N="{{__NAME__}}",V="{{__VERSION__}}",T="{{__TOKEN__}}",N2="{{__NAME__}}";</script></body>'
  const out = stampHtml(html, { name: 'config-panel', version: 'main@abc1234', token: 'tok-1' })
  assert.ok(out.includes('const N="config-panel",V="main@abc1234",T="tok-1",N2="config-panel";'))
  assert.ok(out.includes('<meta name="dsh-web-app" content="config-panel">'))
  assert.ok(out.indexOf('<meta name="dsh-web-app"') < out.indexOf('</head>'))
  // 已含 meta 不重复注入
  const out2 = stampHtml('<head><meta name="dsh-web-app" content="x"></head>{{__TOKEN__}}', { name: 'a', version: 'b', token: 'c' })
  assert.equal((out2.match(/dsh-web-app" content=/g) ?? []).length, 1)
  // 没有 </head> 也能工作（追加到尾部）
  const out3 = stampHtml('{{__TOKEN__}}', { name: 'a', version: 'b', token: 'c' })
  assert.ok(out3.includes('c'))
  assert.ok(out3.includes('<meta name="dsh-web-app" content="a">'))
})
