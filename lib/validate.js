/**
 * dsh-web-app — 回传契约校验（纯函数，全部可单测）。
 *
 * 依据 docs/callback-contract.md：
 *   §2 app.json schema、§3 变量词表与保留占位符、§4 回传模板、
 *   §5 postMessage 协议（桥迹象）、§7 自检清单。
 *
 * 关键约定（client 半必须逐字节复刻的两处替换逻辑）：
 *
 *   renderTemplate / stampHtml 的替换规则：
 *     1. 全局替换：一处占位符出现多少次就替换多少次（split/join 语义）；
 *     2. 不做任何转义（HTML 转义是应用作者的责任）；
 *     3. 只替换已知占位符，其余 `{{...}}` 原样保留；
 *     4. 不识别空白变体（`{{ TEXT_1 }}` 不匹配，保持简单确定）。
 *
 *   slotType 的 JSON 特例：JSON_n 槽位的内容按**字符串**传输
 *   （skills 文档/示例应用一致），故 slotType('JSON_1') === 'string'。
 */

/** 变量槽位词表：TEXT_n / NUMBER_n / BOOLEAN_n / JSON_n，编号从 1 开始。 */
export const SLOT_RE = /^(TEXT|NUMBER|BOOLEAN|JSON)_([1-9]\d*)$/

/** HTML 里允许的全部保留占位符（§3）。HTML 中出现任何其他 {{...}} 都是 issue。 */
export const RESERVED = ['__NAME__', '__VERSION__', '__TOKEN__']

const RESERVED_SET = new Set(RESERVED)
/** 模板里除声明变量外仅允许这两个保留占位符（__TOKEN__ 不允许进模板）。 */
const TEMPLATE_RESERVED_SET = new Set(['__NAME__', '__VERSION__'])

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** index.html 必须同时含有的四个回传桥子串（callback-contract §5/§7）。 */
const BRIDGE_SIGNS = ['{{__TOKEN__}}', 'dsh-web-app', 'postMessage', 'submit']

/** @param {unknown} v */
function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 应用名是否合法 kebab-case（全小写、数字、连字符；数字允许开头，与 skills 命名一致）。
 * @param {unknown} name
 * @returns {boolean}
 */
export function validateName(name) {
  return typeof name === 'string' && NAME_RE.test(name)
}

/**
 * 槽位类型：'TEXT'→'string'、'NUMBER'→'number'、'BOOLEAN'→'boolean'、'JSON'→'string'。
 * @param {unknown} slot
 * @returns {'string'|'number'|'boolean'|null} 不合法槽位返回 null。
 */
export function slotType(slot) {
  const m = typeof slot === 'string' ? SLOT_RE.exec(slot) : null
  if (m === null) return null
  switch (m[1]) {
    case 'TEXT':
    case 'JSON':
      return 'string'
    case 'NUMBER':
      return 'number'
    case 'BOOLEAN':
      return 'boolean'
    /* v8 ignore next -- SLOT_RE 的捕获组限定在四个前缀内。 */
    default:
      return null
  }
}

/**
 * 校验 app.json 元数据（callback-contract §2）。
 * @param {unknown} metadata - 解析后的 app.json。
 * @param {string} [expectedName] - deploy 工具传入的期望名，不一致即 issue。
 * @returns {string[]} issues（空数组 = 通过）。
 */
export function validateAppJson(metadata, expectedName) {
  if (!isPlainObject(metadata)) return ['app.json 必须是一个 JSON object']
  const issues = []
  const { name, description, confirm, variables } = metadata
  if (!validateName(name)) {
    issues.push(`name ${JSON.stringify(name)} 不是合法 kebab-case（^[a-z0-9]+(?:-[a-z0-9]+)*$）`)
  } else if (expectedName !== undefined && name !== expectedName) {
    issues.push(`name "${name}" 与部署名 "${expectedName}" 不一致`)
  }
  if (typeof description !== 'string' || description.trim() === '') {
    issues.push('description 必须是非空 string')
  }
  if (typeof confirm !== 'boolean') {
    issues.push('confirm 必须显式声明为 boolean（不允许缺省/省略）')
  }
  if (!Array.isArray(variables)) {
    issues.push('variables 必须是数组')
  } else {
    const seen = new Set()
    variables.forEach((v, i) => {
      if (!isPlainObject(v)) {
        issues.push(`variables[${i}] 必须是 object`)
        return
      }
      if (typeof v.slot !== 'string' || !SLOT_RE.test(v.slot)) {
        issues.push(`variables[${i}].slot ${JSON.stringify(v.slot)} 不合法（须形如 TEXT_1，编号从 1 开始）`)
      } else if (seen.has(v.slot)) {
        issues.push(`slot "${v.slot}" 重复声明`)
      } else {
        seen.add(v.slot)
      }
      if (typeof v.label !== 'string' || v.label.trim() === '') {
        issues.push(`variables[${i}].label 必须是非空 string`)
      }
      if (typeof v.purpose !== 'string' || v.purpose.trim() === '') {
        issues.push(`variables[${i}].purpose 必须是非空 string`)
      }
    })
  }
  return issues
}

/**
 * 扫描文本里全部 `{{...}}` 占位符名（容忍内部空白，如 `{{ TEXT_1 }}`）。
 * 注意：替换逻辑（renderTemplate）只认无空白变体，这里从宽是为了报出更好的 issue。
 * @param {unknown} text
 * @returns {Set<string>}
 */
export function scanPlaceholders(text) {
  const found = new Set()
  if (typeof text !== 'string') return found
  const re = /\{\{\s*([^{}]*?)\s*\}\}/g
  let m
  while ((m = re.exec(text)) !== null) found.add(m[1])
  return found
}

/**
 * index.html 占位符问题：HTML 里只允许 {{__NAME__}}/{{__VERSION__}}/{{__TOKEN__}}，
 * 连 {{TEXT_1}} 这类变量占位符也是 issue（变量值不允许盖进 HTML）。
 * @param {unknown} html
 * @returns {string[]}
 */
export function htmlPlaceholderIssues(html) {
  if (typeof html !== 'string') return ['index.html 内容必须是 string']
  const issues = []
  for (const ph of scanPlaceholders(html)) {
    if (!RESERVED_SET.has(ph)) {
      issues.push(`index.html 含未声明占位符 {{${ph}}}（HTML 只允许 ${RESERVED.map((r) => `{{${r}}}`).join(' ')}；变量占位符禁止出现在 HTML）`)
    }
  }
  return issues
}

/**
 * index.html 回传桥问题：必须同时含 {{__TOKEN__}}、dsh-web-app、postMessage、submit
 * 四个子串（callback-contract §5 的唯一消息 {source:"dsh-web-app",type:"submit",token,values}
 * 与 §7 第 4 条）。
 * @param {unknown} html
 * @returns {string[]}
 */
export function htmlBridgeIssues(html) {
  if (typeof html !== 'string') return ['index.html 内容必须是 string']
  const missing = BRIDGE_SIGNS.filter((s) => !html.includes(s))
  if (missing.length === 0) return []
  return [`index.html 缺少回传桥迹象：未找到 ${missing.map((s) => JSON.stringify(s)).join(' / ')}`]
}

/**
 * 校验单文件 HTML（占位符词表 + 回传桥迹象，两者都查）。
 * @param {unknown} html
 * @returns {string[]}
 */
export function validateHtml(html) {
  return [...htmlPlaceholderIssues(html), ...htmlBridgeIssues(html)]
}

/**
 * 校验回传模板（callback-contract §4 + §7 第 3 条）。
 * @param {unknown} template - callback.template.md 全文。
 * @param {Array<{slot?:unknown}>} variables - app.json 声明的变量数组。
 * @param {string} [html] - 可选：index.html 全文；传入后「声明的变量」可在模板
 *   或页面中出现（check 工具用它满足 §7 第 3 条的双向对应）。
 * @returns {string[]}
 */
export function validateTemplate(template, variables, html) {
  if (typeof template !== 'string' || template === '') {
    return ['callback.template.md 必须是非空 string']
  }
  const issues = []
  if (!template.startsWith('[webapp 回传]')) {
    issues.push('模板必须以「[webapp 回传]」开头')
  }
  const declared = new Set(
    (Array.isArray(variables) ? variables : [])
      .map((v) => (isPlainObject(v) ? v.slot : null))
      .filter((s) => typeof s === 'string'),
  )
  // 模板占位符 ⊆ declaredSlots ∪ {__NAME__, __VERSION__}
  for (const ph of scanPlaceholders(template)) {
    if (TEMPLATE_RESERVED_SET.has(ph)) continue
    if (!declared.has(ph)) {
      issues.push(`模板占位符 {{${ph}}} 没有对应变量声明（允许：${[...declared].join(' / ') || '（无）'} 及 {{__NAME__}}/{{__VERSION__}}）`)
    }
  }
  // 每个声明的变量至少在模板或（调用方传入的）页面中出现一次
  const htmlPh = html === undefined ? new Set() : scanPlaceholders(html)
  for (const slot of declared) {
    const inTemplate = template.includes(`{{${slot}}}`)
    const inHtml = htmlPh.has(slot)
    if (!inTemplate && !inHtml) {
      issues.push(`声明的变量 ${slot} 未被模板或 index.html 使用`)
    }
  }
  return issues
}

/**
 * 渲染回传模板（回传时填；与 HTML 伺服时盖章是两次独立填充）。
 * 替换规则（client 半必须逐字节一致）：
 *   1. 全局替换（split/join），不做转义；
 *   2. 顺序：先 {{__NAME__}}、{{__VERSION__}}，再 values 的每个键；
 *   3. values 里 template 中没有的键不影响输出；
 *   4. 其余占位符原样保留。
 * @param {string} template
 * @param {{ name: string, version: string, values?: Record<string, unknown> }} fill
 * @returns {string}
 */
export function renderTemplate(template, { name, version, values }) {
  let out = template
  out = out.split('{{__NAME__}}').join(String(name))
  out = out.split('{{__VERSION__}}').join(String(version))
  for (const [k, v] of Object.entries(values ?? {})) {
    out = out.split(`{{${k}}}`).join(String(v))
  }
  return out
}

/**
 * 校验回传 values（callback-contract §5：键与类型和 app.json 声明一致）。
 * 键集合与声明严格相等；类型按 slotType 校验（JSON_n 按 string；number 要求 finite）。
 * @param {unknown} values
 * @param {Array<{slot?:unknown}>} variables
 * @returns {string[]}
 */
export function validateValues(values, variables) {
  if (!isPlainObject(values)) return ['values 必须是 object']
  const issues = []
  const declared = new Set(
    (Array.isArray(variables) ? variables : [])
      .map((v) => (isPlainObject(v) ? v.slot : null))
      .filter((s) => typeof s === 'string' && SLOT_RE.test(s)),
  )
  for (const k of Object.keys(values)) {
    if (!declared.has(k)) issues.push(`values 含未声明的键 "${k}"`)
  }
  for (const slot of declared) {
    if (!Object.hasOwn(values, slot)) issues.push(`values 缺少声明的键 "${slot}"`)
  }
  for (const [k, v] of Object.entries(values)) {
    if (!declared.has(k)) continue
    const t = slotType(k)
    if (t === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) issues.push(`"${k}" 必须是 finite number（收到 ${JSON.stringify(v)}）`)
    } else if (typeof v !== t) {
      issues.push(`"${k}" 必须是 ${t}（收到 ${JSON.stringify(v)}）`)
    }
  }
  return issues
}

/**
 * 伺服时盖章：替换三个保留占位符 + 注入应用身份 meta。
 * 替换规则与 renderTemplate 同一套语义：全局、split/join、不转义。
 * `<meta name="dsh-web-app" content="<name>">` 的用途：给 DOM 侧一个可查询的
 * 应用身份标记（client 半可据此确认页面归属）；已存在则不重复注入。
 * @param {string} html - 仓库里的干净源码（含占位符）。
 * @param {{ name: string, version: string, token: string }} fill
 * @returns {string} 盖章后的成品 HTML。
 */
export function stampHtml(html, { name, version, token }) {
  let out = html
  out = out.split('{{__NAME__}}').join(String(name))
  out = out.split('{{__VERSION__}}').join(String(version))
  out = out.split('{{__TOKEN__}}').join(String(token))
  if (!out.includes('<meta name="dsh-web-app"')) {
    const meta = `<meta name="dsh-web-app" content="${name}">`
    if (/<\/head>/i.test(out)) {
      out = out.replace(/<\/head>/i, `${meta}\n</head>`)
    } else {
      out = `${out}\n${meta}`
    }
  }
  return out
}
