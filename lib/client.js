/**
 * dsh-web-app — browser (client) half.
 *
 * Loaded by the shell as a CLASSIC script, so this file cannot be an ES module:
 * it self-registers a CJS factory whose `id` equals `package.json name`, and may
 * only `require` platform seed specifiers (here: just `react`). The dynamic-Cordis
 * builtins (`host`/`styles`) are NOT available to classic scripts, so there is no
 * JSX, no `styles.insert`, and all styling is inline style objects referencing the
 * `--dsw-alias-*` theme tokens (same approach as dsh-compact-manager).
 *
 * This half owns everything the user sees:
 *   1. the `/webapp` command card (keyed `conversation.chat.commandview`) — an app
 *      selector when invoked without args, otherwise an inline sandboxed iframe;
 *   2. the callback bridge — postMessage listener, per-load ticket check, strict
 *      value validation, template rendering, confirm UI, turn-aware dedup, and
 *      injection into the current session via the `remote.session.prompt` RPC
 *      (captured from `apply(ctx)` here in the closure — slot components never
 *      reach `ctx` themselves);
 *   3. a fullscreen overlay (`shell.overlay`) that reuses the same frame component
 *      with its own freshly-minted load ticket;
 *   4. the management page (`sidebar.panellist` + keyed `main`);
 *   5. a collapsible WebappTeaser experience card, reused by the turn-tail
 *      announcements (apps deployed/updated this turn, via an invisible
 *      `conversation.input.dock` registry watcher) and by the
 *      `dsh-web-app-show` tool row (keyed `tool.call.toolview`).
 *
 * All data flows through the plugin's own unauthenticated webServer routes under
 * `/dsh-web-app/api/*` — deliberately NOT `/api` (a sandboxed iframe is an opaque
 * origin and could never carry the signed cookie `/api` demands). Authorship of
 * content is instead gated by the per-load ticket stamped into the served HTML.
 */

window.__ModuleLoader__.load({
  id: 'dsh-web-app',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const NS = 'webapp'
    const PANEL_ID = 'dsh-web-app'
    const LIST_URL = '/dsh-web-app/api/list'
    const APP_URL = '/dsh-web-app/api/app'
    const LOAD_URL = '/dsh-web-app/api/load'
    const DELETE_URL = '/dsh-web-app/api/delete'
    const POLL_MS = 5000
    const FRAME_HEIGHT = 420

    /* ------------------------------------------------------------------ *
     * Dictionaries (sdk-notes §8). Slot entries carry `locale: NS`, so the
     * renderer injects a `t` prop; `ManagePage`-internal text uses it too.
     * ------------------------------------------------------------------ */
    const zh = {
      lang: 'zh',
      panel: 'Web 应用',
      title: 'Web 应用管理',
      subtitle: '部署可在对话内打开的 HTML 应用；在会话中输入 /webapp 打开，回传经确认后注入为当前会话的用户消息。',
      loading: '正在加载…',
      loadFailed: '加载失败',
      retry: '重试',
      deleted: '该应用已被删除',
      deletedHint: '此卡片对应的应用已从注册表移除，无法继续使用。',
      switchApp: '切换应用',
      selectApp: '选择一个应用',
      emptyList: '还没有已部署的应用。',
      open: '打开',
      openHint: '回到会话后输入 /webapp 应用名 即可在对话内打开。',
      delete: '删除',
      confirmDelete: '确认删除？此操作不可撤销',
      deleting: '删除中…',
      deleteDone: '已删除',
      name: '名称',
      desc: '简介',
      version: '版本',
      repo: '仓库状态',
      repoOk: '正常',
      repoDirty: '有未提交改动',
      repoMissing: '目录缺失',
      actions: '操作',
      refresh: '刷新',
      fullscreen: '全屏',
      manage: '管理面板',
      close: '关闭',
      commandError: '命令执行失败',
      noConfirmWarn: '此应用声明免确认：提交将不经确认直接注入会话。',
      invalidToken: '门票无效（可能页面已刷新），已丢弃。',
      invalidValues: '回传数据与声明的变量不一致，已丢弃。',
      confirmTitle: '确认发送以下内容？',
      variable: '变量',
      meaning: '含义',
      cancel: '取消',
      confirmSend: '确认发送',
      sending: '正在发送…',
      sent: '已发送给模型',
      sendFailed: '注入失败',
      dedupBlocked: '相同内容已发送过，已拦截重复提交。',
      clipboardFallback: '无法自动注入，内容已复制到剪贴板，请手动粘贴到输入框发送。',
      frameLoading: '正在加载应用…',
      frameFailed: '应用加载失败，请尝试刷新。',
      fullscreenLoading: '正在准备全屏…',
      exitFullscreen: '✕ 退出全屏',
      escHint: '按 Esc 退出（焦点在应用内时请用按钮）',
      tryNow: '立即体验',
      collapse: '收起',
      showInvalid: 'show 卡片参数无效',
      autoShowNote: '本回合交付 / 更新的应用',
      spotlightHint: '模型交付了一个 Web App',
    }

    const en = {
      lang: 'en',
      panel: 'Web Apps',
      title: 'Web app manager',
      subtitle: 'Deploy HTML apps that open inline in a conversation; type /webapp in a session to open one. Submissions are injected as a user message after confirmation.',
      loading: 'Loading…',
      loadFailed: 'Failed to load',
      retry: 'Retry',
      deleted: 'This app has been deleted',
      deletedHint: 'The app behind this card was removed from the registry and can no longer be used.',
      switchApp: 'Switch app',
      selectApp: 'Pick an app',
      emptyList: 'No apps deployed yet.',
      open: 'Open',
      openHint: 'Back in the conversation, type /webapp <name> to open it inline.',
      delete: 'Delete',
      confirmDelete: 'Really delete? This cannot be undone.',
      deleting: 'Deleting…',
      deleteDone: 'Deleted',
      name: 'Name',
      desc: 'Description',
      version: 'Version',
      repo: 'Repository',
      repoOk: 'Clean',
      repoDirty: 'Uncommitted changes',
      repoMissing: 'Directory missing',
      actions: 'Actions',
      refresh: 'Refresh',
      fullscreen: 'Fullscreen',
      manage: 'Manage',
      close: 'Close',
      commandError: 'Command failed',
      noConfirmWarn: 'This app declares confirm:false — submissions are injected without a confirmation step.',
      invalidToken: 'Invalid ticket (the page may have been refreshed); submission dropped.',
      invalidValues: 'Submission does not match the declared variables; dropped.',
      confirmTitle: 'Send the following?',
      variable: 'Variable',
      meaning: 'Meaning',
      cancel: 'Cancel',
      confirmSend: 'Send',
      sending: 'Sending…',
      sent: 'Sent to the model',
      sendFailed: 'Injection failed',
      dedupBlocked: 'Identical content was already sent; duplicate submission blocked.',
      clipboardFallback: 'Automatic injection unavailable; the text was copied to the clipboard — paste it into the input to send.',
      frameLoading: 'Loading app…',
      frameFailed: 'The app failed to load. Try refreshing.',
      fullscreenLoading: 'Preparing fullscreen…',
      exitFullscreen: '✕ Exit fullscreen',
      escHint: 'Press Esc to exit (use the button while the app has focus)',
      tryNow: 'Try it now',
      collapse: 'Collapse',
      showInvalid: 'Invalid show-card arguments',
      autoShowNote: 'Apps delivered or updated this turn',
      spotlightHint: 'The model delivered a web app',
    }

    /* ------------------------------------------------------------------ *
     * Styles — compact-manager convention: inline objects + var() tokens
     * with hard-coded fallbacks (sdk-notes §9).
     * ------------------------------------------------------------------ */
    const styles = {
      page: { display: 'grid', gap: '14px', padding: '20px 22px 40px', color: 'var(--dsw-alias-label-primary, #e8e8e8)', fontSize: '13px', lineHeight: '1.6', overflowY: 'auto', height: '100%', boxSizing: 'border-box' },
      card: { background: 'var(--dsw-alias-bg-layer-1, #212223)', border: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08))', borderRadius: '10px', padding: '14px 16px', display: 'grid', gap: '10px' },
      header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' },
      h1: { fontSize: '17px', fontWeight: 600, margin: 0 },
      h2: { fontSize: '13px', fontWeight: 600, margin: 0 },
      muted: { color: 'var(--dsw-alias-label-secondary, #9aa0a6)', fontSize: '12px' },
      row: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      button: { background: 'var(--dsw-alias-bg-layer-2, #2a2b2d)', color: 'inherit', border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.16))', borderRadius: '7px', padding: '5px 11px', fontSize: '12px', cursor: 'pointer' },
      ghost: { background: 'transparent', color: 'var(--dsw-alias-label-secondary, #9aa0a6)', border: '1px solid transparent', borderRadius: '6px', padding: '3px 9px', fontSize: '12px', cursor: 'pointer' },
      primary: { background: 'var(--dsw-alias-brand-primary, #4d6bfe)', color: '#fff', border: '1px solid transparent', borderRadius: '7px', padding: '5px 13px', fontSize: '12px', cursor: 'pointer' },
      danger: { background: 'transparent', color: 'var(--dsw-alias-state-error-primary, #ff6b6b)', border: '1px solid var(--dsw-alias-state-error-primary, #ff6b6b)', borderRadius: '7px', padding: '5px 11px', fontSize: '12px', cursor: 'pointer' },
      chip: { display: 'inline-block', padding: '1px 7px', borderRadius: '999px', border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.16))', fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #9aa0a6)' },
      error: { color: 'var(--dsw-alias-state-error-primary, #ff6b6b)', fontSize: '12px' },
      ok: { color: 'var(--dsw-alias-state-success-primary, #34c759)', fontSize: '12px' },
      warnBanner: { background: 'var(--dsw-alias-state-warn-tertiary, rgba(183,121,31,0.15))', color: 'var(--dsw-alias-state-warn-primary, #b7791f)', border: '1px solid var(--dsw-alias-state-warn-primary, #b7791f)', borderRadius: '8px', padding: '7px 10px', fontSize: '12px' },
      errorBanner: { background: 'var(--dsw-alias-state-error-primary, #ff6b6b)', color: '#fff', borderRadius: '8px', padding: '7px 10px', fontSize: '12px' },
      link: { background: 'none', border: 'none', color: 'var(--dsw-alias-brand-primary, #7f9bff)', cursor: 'pointer', fontSize: '12px', padding: 0 },
      pre: { margin: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
      table: { display: 'grid', gap: '0' },
      tableRow: { display: 'grid', gridTemplateColumns: 'minmax(120px, 180px) 1fr minmax(140px, 220px)', gap: '10px', alignItems: 'center', padding: '8px 4px', borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08))' },
      tableHead: { display: 'grid', gridTemplateColumns: 'minmax(120px, 180px) 1fr minmax(140px, 220px)', gap: '10px', padding: '4px', color: 'var(--dsw-alias-label-tertiary, #6b7076)', fontSize: '11px' },
      appRow: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 10px', alignItems: 'center', padding: '9px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08))', cursor: 'pointer' },
      frameWrap: { position: 'relative', width: '100%', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08))', background: 'var(--dsw-alias-bg-base, #17181a)' },
      iframe: { display: 'block', width: '100%', border: 'none', background: '#fff' },
      skeleton: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--dsw-alias-bg-skeleton, #26282b)', color: 'var(--dsw-alias-label-tertiary, #6b7076)', fontSize: '12px' },
      modalBackdrop: { position: 'absolute', inset: 0, zIndex: 10, background: 'var(--dsw-alias-bg-overlay, rgba(0,0,0,0.55))', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' },
      modal: { background: 'var(--dsw-alias-bg-layer-2, #2a2b2d)', border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.16))', borderRadius: '10px', padding: '14px 16px', display: 'grid', gap: '10px', width: 'min(560px, 100%)', maxHeight: '100%', boxSizing: 'border-box', overflowY: 'auto' },
      modalText: { margin: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '220px', overflowY: 'auto', background: 'var(--dsw-alias-bg-base, #17181a)', borderRadius: '7px', padding: '10px', border: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08))' },
      varTable: { display: 'grid', gap: '4px', fontSize: '12px' },
      varRow: { display: 'grid', gridTemplateColumns: 'minmax(110px, 160px) 1fr', gap: '10px', padding: '3px 0', borderBottom: '1px dashed var(--dsw-alias-border-l1, rgba(255,255,255,0.08))' },
      overlayRoot: { position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--dsw-alias-bg-base, #17181a)', display: 'flex', flexDirection: 'column' },
      overlayBar: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08))', flexShrink: 0 },
      // Prominent fullscreen exit — the reliable way out even when the
      // sandboxed iframe owns keyboard focus (ESC can't reach us then).
      exitButton: { background: 'var(--dsw-alias-state-error-primary, #ff6b6b)', color: '#fff', border: '1px solid transparent', borderRadius: '7px', padding: '6px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' },
      overlayBody: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '10px 14px 14px' },
    }

    /* ------------------------------------------------------------------ *
     * Captured from apply(ctx) — slot components never see `ctx`. The
     * client runtime DOES expose the `remote` service on ctx (same service
     * dsh-api-session-controller's CommandUiRuntime calls ctx.remote.session
     * .prompt on), but we still keep the ctx.get('remote') lookup and a
     * clipboard fallback below as defensive depth.
     * ------------------------------------------------------------------ */
    const remoteRef = { current: null }
    const ctxGetRef = { current: null }
    const layoutRef = { current: null }

    /* ------------------------------------------------------------------ *
     * JSON helpers. Every route follows the host contract: success is
     * `{ok:true, ...}`, failure is `{ok:false, error}` (404 for missing
     * apps). We surface 404 as `{deleted:true}` so cards can render the
     * "app has been deleted" placeholder instead of a generic error.
     * ------------------------------------------------------------------ */
    function requestJson(url, options) {
      return fetch(url, options).then(async (response) => {
        if (response.status === 404) return { deleted: true }
        const body = await response.json().catch(() => null)
        if (!response.ok || !body || body.ok !== true) {
          throw new Error(body && body.error ? String(body.error) : `HTTP ${response.status}`)
        }
        return body
      })
    }

    function getJson(url) {
      return requestJson(url, { headers: { accept: 'application/json' } })
    }

    function postJson(url, payload) {
      return requestJson(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload ?? {}),
      })
    }

    function errorMessage(error) {
      return error instanceof Error ? error.message : String(error)
    }

    /* ------------------------------------------------------------------ *
     * Fullscreen store — module-level, hand-rolled (10 lines). The card
     * writes {open, app, load, sessionId, gate}; the shell.overlay entry
     * subscribes. The gate callback is ref-backed in the card, so handing
     * it to the overlay keeps dedup live even though the overlay instance
     * has no useChat of its own.
     * ------------------------------------------------------------------ */
    const fsStore = {
      state: { open: false, phase: 'idle', app: null, load: null, sessionId: null, gate: null },
      listeners: new Set(),
      set(patch) { this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener()) },
      subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) },
      getSnapshot() { return this.state },
    }
    function closeFullscreen() {
      fsStore.set({ open: false, phase: 'idle', app: null, load: null, gate: null })
    }

    /* ------------------------------------------------------------------ *
     * Shared fullscreen opener — extracted from WebappCard so teaser cards
     * reuse the exact same ticket-minting flow. Resolves {ok:true} |
     * {ok:false, deleted:true} | {ok:false, error}. The overlay is closed
     * again on any failure, mirroring the card's original behavior.
     * ------------------------------------------------------------------ */
    async function openFullscreenShared(app, sessionId, gate) {
      fsStore.set({ open: true, phase: 'loading', app, load: null, sessionId, gate })
      try {
        const body = await postJson(LOAD_URL, { name: app.name })
        if (body.deleted === true) { closeFullscreen(); return { ok: false, deleted: true } }
        fsStore.set({ phase: 'ready', load: body.load })
        return { ok: true }
      } catch (fetchError) {
        closeFullscreen()
        return { ok: false, error: errorMessage(fetchError) }
      }
    }

    /* ------------------------------------------------------------------ *
     * autoStore — "apps deployed/updated during turn N" announcements,
     * written by DeployWatcher (list diff) and read by TurnTailCards.
     * Hand-rolled like fsStore. Keys are `${sessionId}|${turn}` — turn
     * numbers restart per session, so the session prefix keeps parallel
     * sessions from colliding; DeployWatcher clears the store when the
     * session changes.
     * ------------------------------------------------------------------ */
    const autoStore = {
      state: { byTurn: new Map() },
      listeners: new Set(),
      addForTurn(key, entries) {
        const byName = new Map((this.state.byTurn.get(key) ?? []).map((entry) => [entry.name, entry]))
        for (const entry of entries) byName.set(entry.name, entry)
        const byTurn = new Map(this.state.byTurn)
        byTurn.set(key, Array.from(byName.values()))
        this.state = { byTurn }
        this.listeners.forEach((listener) => listener())
      },
      clear() {
        if (this.state.byTurn.size === 0) return
        this.state = { byTurn: new Map() }
        this.listeners.forEach((listener) => listener())
      },
      subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) },
      getSnapshot() { return this.state.byTurn },
    }

    /* ------------------------------------------------------------------ *
     * showStore — the show tool's immediate surface. dsh-web-app-show's
     * toolview sits inside the turn-process fold (foldCompletedTurns), so
     * an in-flow card is visually hidden until the user unfolds the group.
     * To make the delivery visible AT CALL TIME, ShowToolview pushes here;
     * the input.dock seat renders the entry as a slim spotlight row above
     * the composer (one click → fullscreen). On turn end the entry is
     * dismissed — the turn-tail card (fed from the same push via
     * autoStore) takes over as the persistent surface.
     * ------------------------------------------------------------------ */
    const showStore = {
      state: null, // { sessionId, dedupKey, name, expand } | null
      listeners: new Set(),
      push(entry) { this.state = entry; this.listeners.forEach((listener) => listener()) },
      dismiss() {
        if (this.state === null) return
        this.state = null
        this.listeners.forEach((listener) => listener())
      },
      subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) },
      getSnapshot() { return this.state },
    }
    // Show pushes dedup by callId — chat rebuilds can remount the toolview.
    const pushedShowCallIds = new Set()
    function markShowPushed(key) {
      if (pushedShowCallIds.has(key)) return false
      pushedShowCallIds.add(key)
      if (pushedShowCallIds.size > 200) {
        const oldest = pushedShowCallIds.values().next().value
        pushedShowCallIds.delete(oldest)
      }
      return true
    }

    /* Per-node memo for the turn-tail local re-scan (sdk-notes contract):
     * stringify each tool-call node at most once per node OBJECT — chat
     * updates replace node objects, so a WeakMap keyed by identity is
     * exactly the right granularity and re-scans cost Map lookups only. */
    const deployScanCache = new WeakMap()
    function scanNodeForDeploy(node) {
      let found = deployScanCache.get(node)
      if (found !== undefined) return found
      found = null
      const text = JSON.stringify(node.data ?? null)
      if (typeof text === 'string' && text.includes('dsh-web-app-deploy')) {
        const match = text.match(/"name"\s*:\s*"([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)"/)
        if (match) found = match[1]
      }
      deployScanCache.set(node, found)
      return found
    }

    /* ------------------------------------------------------------------ *
     * Template rendering (callback-contract §4). Rules — byte-identical
     * with the host half: global replace of every `{{__NAME__}}`,
     * `{{__VERSION__}}` and each declared `{{SLOT}}`; NO escaping; any
     * placeholder that is not declared is left verbatim in the output.
     * split/join (not regex) so slot names never need escaping.
     * ------------------------------------------------------------------ */
    function renderTemplate(template, app, values) {
      let out = String(template ?? '')
      const reserved = { __NAME__: app.name, __VERSION__: app.version }
      for (const key of Object.keys(reserved)) {
        out = out.split(`{{${key}}}`).join(String(reserved[key] ?? ''))
      }
      // Slot substitution iterates the VALUES object in insertion order —
      // byte-identical to the host half's renderTemplate (lib/validate.js),
      // which does `for (const [slot, value] of Object.entries(values))`.
      // (Key-set equality is enforced by validateValues before we get here.)
      for (const slot of Object.keys(values)) {
        out = out.split(`{{${slot}}}`).join(String(values[slot]))
      }
      return out
    }

    /* ------------------------------------------------------------------ *
     * Structural validation (callback-contract §5): the key set of `values`
     * must equal the declared variable set exactly, and each value must
     * match its declared base type. TEXT → string; NUMBER → number and
     * finite; BOOLEAN → boolean; JSON → STRING (the app ships a serialized
     * JSON document, the template embeds it as-is). Anything else drops.
     * ------------------------------------------------------------------ */
    function validateValues(app, values) {
      if (values === null || typeof values !== 'object' || Array.isArray(values)) return false
      const variables = app.variables ?? []
      const keys = Object.keys(values)
      if (keys.length !== variables.length) return false
      for (const variable of variables) {
        if (!Object.prototype.hasOwnProperty.call(values, variable.slot)) return false
        const value = values[variable.slot]
        const slot = variable.slot
        if (slot.startsWith('TEXT')) {
          if (typeof value !== 'string') return false
        } else if (slot.startsWith('NUMBER')) {
          if (typeof value !== 'number' || !Number.isFinite(value)) return false
        } else if (slot.startsWith('BOOLEAN')) {
          if (typeof value !== 'boolean') return false
        } else if (slot.startsWith('JSON')) {
          if (typeof value !== 'string') return false
        } else {
          return false // unknown slot prefix — refuse rather than guess
        }
      }
      return true
    }

    /* Stable hash of the submission for dedup: sorted-key JSON + template +
     * version, djb2. Hash collision risk is acceptable — this only gates a
     * same-turn duplicate hint, never security. */
    function stableHash(values, template, version) {
      const sorted = {}
      for (const key of Object.keys(values).sort()) sorted[key] = values[key]
      const text = `${JSON.stringify(sorted)}\n${template}\n${version}`
      let hash = 5381
      for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
      return String(hash)
    }

    /* ------------------------------------------------------------------ *
     * Small ghost button with a hover state (inline styles cannot express
     * :hover, hence the mouseenter/leave toggle).
     * ------------------------------------------------------------------ */
    function GhostButton({ label, onClick, disabled, danger }) {
      const [hover, setHover] = React.useState(false)
      const base = danger === true
        ? { ...styles.ghost, color: 'var(--dsw-alias-state-error-primary, #ff6b6b)' }
        : styles.ghost
      const style = hover && disabled !== true
        ? { ...base, background: 'var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.08))', color: 'var(--dsw-alias-label-primary, #e8e8e8)' }
        : base
      return h('button', {
        type: 'button', style, disabled: disabled === true,
        onClick: disabled === true ? undefined : onClick,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
      }, label)
    }

    /* ------------------------------------------------------------------ *
     * useDedupGate — the turn-aware duplicate-submission gate (contract §6),
     * extracted from WebappCard so EVERY component that hands a WebappFrame
     * to the user (command card, teaser cards) shares one implementation.
     * Selectors return PRIMITIVES only (sdk-notes §6 — a fresh object would
     * break the uSES reference compare); the live values sit in a ref so the
     * gate stays correct when handed to the fullscreen overlay, which has no
     * useChat of its own. The dummy hook (a future shell omitting useChat)
     * yields turn -1, which never repeats, so dedup simply never blocks.
     * ------------------------------------------------------------------ */
    function useDedupGate(t, useChatProp) {
      const useChatHook = useChatProp ?? ((selector) => selector({ order: [], nodes: new Map(), timeline: { turnOrder: [], turns: new Map() } }))
      // Encoded "turn|reasonKind" — a primitive so the uSES selector is
      // referentially stable (same encoding WebappCard used inline before).
      const turnInfo = useChatHook((snapshot) => {
        const last = snapshot.timeline.turnOrder.at(-1)
        if (last === undefined) return '|'
        const turn = snapshot.timeline.turns.get(last)
        return `${last}|${turn?.end?.data?.reason?.kind ?? ''}`
      })
      const compactedCount = useChatHook((snapshot) => snapshot.order.reduce((count, key) => {
        const kind = snapshot.nodes.get(key)?.kind
        return count + (kind === 'compaction' || kind === 'manual-compaction' ? 1 : 0)
      }, 0))

      const liveChatRef = React.useRef({ turnInfo: '|', compactedCount: 0 })
      liveChatRef.current = { turnInfo, compactedCount }
      const lastAcceptedRef = React.useRef(null)
      return React.useCallback((hash) => {
        const live = liveChatRef.current
        const sep = live.turnInfo.indexOf('|')
        const turn = sep <= 0 ? -1 : Number(live.turnInfo.slice(0, sep))
        const reasonKind = sep <= 0 ? '' : live.turnInfo.slice(sep + 1)
        const last = lastAcceptedRef.current
        if (last !== null
          && last.turn === turn
          && last.compactedCount === live.compactedCount
          && last.hash === hash
          && reasonKind !== 'aborted' && reasonKind !== 'interrupted' && reasonKind !== 'forked') {
          return t('dedupBlocked')
        }
        lastAcceptedRef.current = { turn, hash, compactedCount: live.compactedCount }
        return null
      }, [t])
    }

    /* ------------------------------------------------------------------ *
     * WebappFrame — the reusable iframe + callback bridge unit, shared by
     * the command card and the fullscreen overlay. Each instance is keyed
     * by its load ticket upstream, so a new ticket means a fresh iframe and
     * a fresh bridge. Sandbox is exactly "allow-scripts": no same-origin,
     * so the app runs isolated and carries no credentials (mvp-design §10).
     *
     * Bridge pipeline per message (order matters — contract §5):
     *   1. event.source must be THIS iframe's contentWindow (first gate
     *      against cross-instance chatter);
     *   2. data.source === 'dsh-web-app' && data.type === 'submit';
     *   3. ticket check: data.token === load.token (STAMPED FIRST);
     *   4. structural check of values against app.variables;
     *   5. render template → confirm modal (unless confirm === false, which
     *      skips straight to delivery and instead keeps a standing warning
     *      banner in the card header) → dedup gate → remote.session.prompt.
     * ------------------------------------------------------------------ */
    function WebappFrame({ app, load, sessionId, gate, t, fill }) {
      const iframeRef = React.useRef(null)
      const [frameReady, setFrameReady] = React.useState(false)
      const [frameFailed, setFrameFailed] = React.useState(false)
      const [pending, setPending] = React.useState(null) // { values, rendered }
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null) // { kind, text }

      // Refs so the single-mounted message listener always sees the latest
      // ticket / app / gate without re-subscribing.
      const liveRef = React.useRef({ app, load, sessionId, gate })
      liveRef.current = { app, load, sessionId, gate }

      const deliver = React.useCallback(async (rendered, values) => {
        const current = liveRef.current
        // Dedup FIRST, so a blocked duplicate is never recorded (contract §6:
        // same turn + not compacted/interrupted/forked + identical payload).
        if (typeof current.gate === 'function') {
          const blocked = current.gate(stableHash(values, current.app.template, current.app.version))
          if (blocked !== null && blocked !== undefined) {
            setPending(null)
            setNotice({ kind: 'error', text: blocked })
            return
          }
        }
        setBusy(true)
        setNotice({ kind: 'info', text: t('sending') })
        const remote = remoteRef.current ?? (typeof ctxGetRef.current === 'function' ? ctxGetRef.current('remote') : null)
        try {
          if (!remote || !remote.session || typeof remote.session.prompt !== 'function') {
            throw new Error('remote.session.prompt unavailable')
          }
          const result = await remote.session.prompt({
            requestId: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `webapp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            sessionId: current.sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: rendered }],
            clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          })
          if (result && result.ok === false) {
            setNotice({ kind: 'error', text: `${t('sendFailed')}: ${result.error ?? ''}` })
          } else {
            setNotice({ kind: 'ok', text: t('sent') })
          }
        } catch (error) {
          // Last-resort fallback: never lose the user's submission silently.
          try {
            await navigator.clipboard.writeText(rendered)
            setNotice({ kind: 'error', text: `${t('clipboardFallback')} (${errorMessage(error)})` })
          } catch (clipError) {
            setNotice({ kind: 'error', text: `${t('sendFailed')}: ${errorMessage(error)}` })
          }
        } finally {
          setBusy(false)
          setPending(null)
        }
      }, [t])

      const accept = React.useCallback((data) => {
        const current = liveRef.current
        // 3. ticket check comes BEFORE structure (a wrong ticket means the
        //    message is not even meant for this load instance).
        if (!current.load || data.token !== current.load.token) {
          setNotice({ kind: 'error', text: t('invalidToken') })
          return
        }
        // 4. structure
        if (!validateValues(current.app, data.values)) {
          setNotice({ kind: 'error', text: t('invalidValues') })
          return
        }
        const rendered = renderTemplate(current.app.template, current.app, data.values)
        if (current.app.confirm === false) {
          void deliver(rendered, data.values)
        } else {
          setPending({ values: data.values, rendered })
        }
      }, [t, deliver])

      const acceptRef = React.useRef(accept)
      acceptRef.current = accept

      React.useEffect(() => {
        const onMessage = (event) => {
          // 1. source gate: only this frame's contentWindow may talk to us.
          if (iframeRef.current === null || event.source !== iframeRef.current.contentWindow) return
          // 2. envelope gate
          const data = event.data
          if (!data || data.source !== 'dsh-web-app' || data.type !== 'submit') return
          acceptRef.current(data)
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [])

      // fill=true (fullscreen overlay): stretch to the flex parent instead of
      // the fixed card height.
      const wrapStyle = fill === true
        ? { ...styles.frameWrap, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }
        : { ...styles.frameWrap, height: FRAME_HEIGHT, display: 'flex', flexDirection: 'column' }
      return h('div', { style: wrapStyle },
        h('iframe', {
          ref: iframeRef,
          src: load.url,
          sandbox: 'allow-scripts',
          style: { ...styles.iframe, flex: 1, minHeight: 0 },
          onLoad: () => setFrameReady(true),
          onError: () => setFrameFailed(true),
          title: app.name,
        }),
        frameReady || frameFailed ? null : h('div', { style: styles.skeleton }, t('frameLoading')),
        frameFailed ? h('div', { style: { ...styles.skeleton, background: 'var(--dsw-alias-bg-base, #17181a)' } },
          h('span', { style: styles.error }, t('frameFailed'))) : null,
        notice === null ? null : h('div', { style: { padding: '6px 2px 0' } },
          h('span', { style: notice.kind === 'ok' ? styles.ok : notice.kind === 'error' ? styles.error : styles.muted }, notice.text)),
        pending === null ? null : h('div', { style: styles.modalBackdrop },
          h('div', { style: styles.modal },
            h('div', { style: styles.h2 }, t('confirmTitle')),
            h('pre', { style: styles.modalText }, pending.rendered),
            h('div', { style: styles.varTable },
              (app.variables ?? []).map((variable) => h('div', { key: variable.slot, style: styles.varRow },
                h('span', { style: styles.muted }, `${variable.label || variable.slot}（${variable.slot}）`),
                h('span', { style: styles.pre }, String(pending.values[variable.slot]))))),
            h('div', { style: { ...styles.row, justifyContent: 'flex-end' } },
              h('button', { type: 'button', style: styles.button, disabled: busy, onClick: () => setPending(null) }, t('cancel')),
              h('button', {
                type: 'button', style: styles.primary, disabled: busy,
                onClick: () => void deliver(pending.rendered, pending.values),
              }, busy ? t('sending') : t('confirmSend'))))))
    }

    /* ------------------------------------------------------------------ *
     * TeaserIcon — small "browser window" glyph for the collapsed teaser row.
     * ------------------------------------------------------------------ */
    function TeaserIcon() {
      return h('svg', {
        width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true',
        style: { flexShrink: 0, color: 'var(--dsw-alias-label-secondary, #9aa0a6)' },
      },
        h('rect', { x: 2, y: 3, width: 12, height: 10, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.3 }),
        h('path', { d: 'M2 5.5h12', stroke: 'currentColor', strokeWidth: 1.3 }),
        h('circle', { cx: 3.8, cy: 4.2, r: 0.6, fill: 'currentColor' }))
    }

    /* ------------------------------------------------------------------ *
     * WebappTeaser — the collapsible "try it now" experience card, reused
     * by TurnTailCards (auto announcements) and ShowToolview (the
     * dsh-web-app-show tool row). Collapsed (default): one compact row —
     * icon + name + version chip + one-line description + primary button.
     * Expanding mints a FRESH load ticket via the standard app+load flow
     * (so the bridge's event.source gate is unaffected) and renders the
     * full WebappFrame (bridge / confirm / dedup) at the card height of
     * 420px, with ghost 收起 / 全屏 header actions. initialExpand=true
     * skips the collapsed state (dsh-web-app-show expand:true). A 404 on
     * /api/app renders the "app has been deleted" placeholder in place.
     * ------------------------------------------------------------------ */
    function WebappTeaser({ name, description, version, sessionId, t, initialExpand, useChat }) {
      const gate = useDedupGate(t, useChat)
      const [expanded, setExpanded] = React.useState(initialExpand === true)
      const [phase, setPhase] = React.useState(initialExpand === true ? 'loading' : 'collapsed')
      const [app, setApp] = React.useState(null)
      const [load, setLoad] = React.useState(null)
      const [error, setError] = React.useState(null)
      const startedRef = React.useRef(false)

      const startLoad = React.useCallback(() => {
        if (startedRef.current) return
        startedRef.current = true
        setPhase('loading')
        ;(async () => {
          try {
            const appBody = await getJson(`${APP_URL}?name=${encodeURIComponent(name)}`)
            if (appBody.deleted === true) { setPhase('deleted'); return }
            setApp(appBody.app)
            const loadBody = await postJson(LOAD_URL, { name })
            if (loadBody.deleted === true) { setPhase('deleted'); return }
            setLoad(loadBody.load)
            setPhase('ready')
          } catch (fetchError) {
            setError(errorMessage(fetchError))
            setPhase('error')
          }
        })()
      }, [name])

      // initialExpand=true → load straight away (skip the collapsed state).
      React.useEffect(() => {
        if (initialExpand === true) startLoad()
        return undefined
      }, [initialExpand, startLoad])

      const tryNow = () => { setExpanded(true); startLoad() }
      const retry = () => { startedRef.current = false; setError(null); startLoad() }
      const openFs = async () => {
        if (!app) return
        const result = await openFullscreenShared(app, sessionId, gate)
        if (result.deleted === true) setPhase('deleted')
      }

      if (expanded !== true) {
        // Collapsed teaser — deliberately shorter than the WebappFrame card.
        return h('div', { style: { ...styles.card, padding: '8px 12px', gap: '8px' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 } },
            h(TeaserIcon, null),
            h('span', { style: { fontWeight: 600, flexShrink: 0 } }, name),
            version !== undefined && version !== null && version !== ''
              ? h('span', { style: styles.chip }, version)
              : null,
            typeof description === 'string' && description !== ''
              ? h('span', {
                style: {
                  ...styles.muted, flex: 1, minWidth: 0, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                },
              }, description)
              : h('span', { style: { flex: 1, minWidth: 0 } }),
            h('button', { type: 'button', style: styles.primary, onClick: tryNow }, t('tryNow'))))
      }

      return h('div', { style: styles.card },
        h('div', { style: styles.header },
          h('div', { style: styles.row },
            h('span', { style: { fontWeight: 600 } }, app?.name ?? name),
            app ? h('span', { style: styles.chip }, app.version ?? '') : null),
          h('div', { style: styles.row },
            h(GhostButton, { label: t('collapse'), onClick: () => {
              // 门票是一次性的：收起会把 iframe 卸载，再展开必须重新铸票，
              // 否则同一个 loadId 二次伺服时 token 盖成空串、回传全被桥拒掉。
              startedRef.current = false
              setExpanded(false)
            } }),
            h(GhostButton, { label: t('fullscreen'), disabled: phase !== 'ready', onClick: () => void openFs() }))),
        phase === 'loading' ? h('div', { style: styles.muted }, t('loading')) : null,
        phase === 'error'
          ? h('div', { style: styles.row },
            h('span', { style: styles.error }, `${t('loadFailed')}: ${error ?? ''}`),
            h('button', { type: 'button', style: styles.button, onClick: retry }, t('retry')))
          : null,
        phase === 'deleted'
          ? h('div', { style: styles.muted },
            h('div', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary, #e8e8e8)' } }, t('deleted')),
            h('div', null, t('deletedHint')))
          : null,
        phase === 'ready' && app && load
          // key by ticket: a new load means a brand-new iframe + bridge.
          ? h(WebappFrame, { key: load.loadId ?? load.token, app, load, sessionId, gate, t })
          : null)
    }

    /* ------------------------------------------------------------------ *
     * WebappCard — the `/webapp` command view (keyed, key='webapp').
     * node.args: raw command input (app name or null/empty → selector).
     * node.outcome: command result; error kind renders an error banner
     * (e.g. the host rejecting an undeployed app name).
     * ------------------------------------------------------------------ */
    function WebappCard(props) {
      const { node, sessionId, t } = props
      // Shared turn-aware dedup gate (see useDedupGate); the dummy inside it
      // keeps hook order stable even if a future shell variant omits useChat.
      const gate = useDedupGate(t, props.useChat)

      const initialName = typeof node?.args === 'string' ? node.args.trim() : ''
      const [name, setName] = React.useState(initialName || null)
      const [epoch, setEpoch] = React.useState(0) // refresh: re-run app+ticket load
      const [phase, setPhase] = React.useState(initialName ? 'loading' : 'selector')
      const [app, setApp] = React.useState(null)
      const [load, setLoad] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [deleted, setDeleted] = React.useState(false)
      const [list, setList] = React.useState({ status: 'loading', apps: [], error: null })

      // App metadata + fresh ticket. One effect drives both initial open and
      // the refresh button (epoch bump).
      React.useEffect(() => {
        if (!name) return undefined
        let live = true
        setPhase('loading')
        setError(null)
        setDeleted(false)
        ;(async () => {
          try {
            const appBody = await getJson(`${APP_URL}?name=${encodeURIComponent(name)}`)
            if (!live) return
            if (appBody.deleted === true) { setDeleted(true); setPhase('deleted'); return }
            setApp(appBody.app)
            const loadBody = await postJson(LOAD_URL, { name })
            if (!live) return
            if (loadBody.deleted === true) { setDeleted(true); setPhase('deleted'); return }
            setLoad(loadBody.load)
            setPhase('ready')
          } catch (fetchError) {
            if (live) { setError(errorMessage(fetchError)); setPhase('error') }
          }
        })()
        return () => { live = false }
      }, [name, epoch])

      // Selector list: fetched once on mount while no name is chosen.
      const loadList = React.useCallback((force) => {
        const url = force === true ? `${LIST_URL}?refresh=1` : LIST_URL
        return getJson(url)
          .then((body) => {
            if (body.deleted === true) return null
            setList({ status: 'ready', apps: body.apps ?? [], error: null })
            return body
          })
          .catch((fetchError) => {
            setList({ status: 'error', apps: [], error: errorMessage(fetchError) })
            return null
          })
      }, [])
      // Selector list: fetched whenever the card sits in selector mode.
      React.useEffect(() => {
        if (name) return undefined
        void loadList()
        return undefined
      }, [name, loadList])

      const openFullscreen = async () => {
        if (!app || !name) return
        const result = await openFullscreenShared(app, sessionId, gate)
        if (result.deleted === true) { setDeleted(true); setPhase('deleted') }
        else if (result.ok !== true) setError(result.error ?? '')
      }

      const openManage = () => {
        const layout = layoutRef.current ?? (typeof ctxGetRef.current === 'function' ? ctxGetRef.current('layout') : null)
        if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(PANEL_ID)
      }

      const outcome = node?.outcome
      const header = phase !== 'selector'
        ? h('div', { style: styles.header },
          h('div', { style: styles.row },
            h('span', { style: { fontWeight: 600 } }, app?.name ?? name),
            app ? h('span', { style: styles.chip }, app.version ?? '') : null,
            app?.confirm === false ? h('span', { style: { ...styles.warnBanner, padding: '1px 8px', border: 'none' } }, '!') : null),
          h('div', { style: styles.row },
            h(GhostButton, { label: t('refresh'), disabled: phase === 'loading', onClick: () => setEpoch((value) => value + 1) }),
            h(GhostButton, { label: t('fullscreen'), disabled: phase !== 'ready', onClick: () => void openFullscreen() }),
            h(GhostButton, { label: t('manage'), onClick: openManage }),
            h(GhostButton, { label: t('switchApp'), onClick: () => { setName(null); setApp(null); setLoad(null); setPhase('selector'); setList({ status: 'loading', apps: [], error: null }); void loadList(true) } })))
        : h('div', { style: styles.header },
          h('div', { style: styles.row },
            h('span', { style: { fontWeight: 600 } }, t('selectApp'))),
          h('div', { style: styles.row },
            h(GhostButton, { label: t('manage'), onClick: openManage })))

      return h('div', { style: styles.card },
        outcome && outcome.kind === 'error'
          ? h('div', { style: styles.errorBanner }, `${t('commandError')}: ${outcome.text ?? ''}`)
          : null,
        header,
        app?.confirm === false && phase === 'ready'
          ? h('div', { style: styles.warnBanner }, t('noConfirmWarn'))
          : null,
        phase === 'selector'
          ? h(SelectorBody, { list, t, onPick: setName, onRetry: () => loadList(true) })
          : null,
        phase === 'loading' ? h('div', { style: styles.muted }, t('loading')) : null,
        phase === 'error'
          ? h('div', { style: styles.row },
            h('span', { style: styles.error }, `${t('loadFailed')}: ${error ?? ''}`),
            h('button', { type: 'button', style: styles.button, onClick: () => setEpoch((value) => value + 1) }, t('retry')))
          : null,
        phase === 'deleted'
          ? h('div', { style: styles.muted },
            h('div', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary, #e8e8e8)' } }, t('deleted')),
            h('div', null, t('deletedHint')))
          : null,
        phase === 'ready' && app && load
          // key by ticket: a new load means a brand-new iframe + bridge.
          ? h(WebappFrame, { key: load.loadId ?? load.token, app, load, sessionId, gate, t })
          : null)
    }

    function SelectorBody({ list, t, onPick, onRetry }) {
      if (list.status === 'loading') return h('div', { style: styles.muted }, t('loading'))
      if (list.status === 'error') {
        return h('div', { style: styles.row },
          h('span', { style: styles.error }, `${t('loadFailed')}: ${list.error ?? ''}`),
          h('button', { type: 'button', style: styles.button, onClick: onRetry }, t('retry')))
      }
      if (list.apps.length === 0) return h('div', { style: styles.muted }, t('emptyList'))
      return h('div', { style: { display: 'grid', gap: '8px' } },
        list.apps.map((app) => h('div', {
          key: app.name,
          style: styles.appRow,
          onClick: () => onPick(app.name),
          onMouseEnter: (event) => { event.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.06))' },
          onMouseLeave: (event) => { event.currentTarget.style.background = 'transparent' },
        },
          h('div', null,
            h('div', { style: { fontWeight: 600 } }, app.name),
            h('div', { style: styles.muted }, app.description ?? '')),
          h('span', { style: styles.chip }, app.version ?? ''))))
    }

    /* ------------------------------------------------------------------ *
     * FullscreenOverlay — shell.overlay list entry (id 'dsh-web-app.fullscreen').
     * Own WebappFrame instance with its OWN ticket (minted by the card when
     * opening), so card and overlay never share a bridge or a token.
     * ------------------------------------------------------------------ */
    function FullscreenOverlay({ t }) {
      const fs = React.useSyncExternalStore(
        (notify) => fsStore.subscribe(notify),
        () => fsStore.getSnapshot(),
      )
      const open = fs.open && fs.app
      // ESC to exit. NOTE: while focus sits INSIDE the sandboxed iframe the
      // key events go to that document and never reach us — an opaque-origin
      // iframe cannot be hooked. ESC therefore works whenever the overlay
      // chrome (or anywhere outside the iframe) has focus; the big exit
      // button is the always-available path.
      React.useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            closeFullscreen()
          }
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
      }, [open])
      if (!open) return null
      return h('div', { style: styles.overlayRoot },
        h('div', { style: styles.overlayBar },
          h('span', { style: { fontWeight: 600 } }, fs.app.name),
          h('span', { style: styles.chip }, fs.app.version ?? ''),
          h('div', { style: { flex: 1 } }),
          h('span', { style: styles.muted }, t('escHint')),
          h('button', { type: 'button', style: styles.exitButton, onClick: closeFullscreen }, t('exitFullscreen'))),
        h('div', { style: styles.overlayBody },
          fs.phase !== 'ready' || !fs.load
            ? h('div', { style: styles.muted }, t('fullscreenLoading'))
            : h(WebappFrame, { key: fs.load.loadId ?? fs.load.token, app: fs.app, load: fs.load, sessionId: fs.sessionId, gate: fs.gate, t, fill: true })))
    }

    /* ------------------------------------------------------------------ *
     * PanelIcon — sidebar.panellist entry. Props: { size, active }.
     * A plain "browser window" glyph in currentColor.
     * ------------------------------------------------------------------ */
    function PanelIcon({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true',
      },
        h('rect', { x: 2, y: 3, width: 12, height: 10, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.3 }),
        h('path', { d: 'M2 5.5h12', stroke: 'currentColor', strokeWidth: 1.3 }),
        h('circle', { cx: 3.8, cy: 4.2, r: 0.6, fill: 'currentColor' }),
        h('path', { d: 'M4 8.2h5M4 10.4h8', stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round', opacity: 0.7 }))
    }

    /* ------------------------------------------------------------------ *
     * ManagePage — keyed 'main' panel. Polls the registry every 5s
     * (no push channel exists for third-party packages), renders the app
     * table, and handles delete with an inline second confirmation.
     * ------------------------------------------------------------------ */
    function ManagePage({ t }) {
      const [state, setState] = React.useState({ status: 'loading', apps: [], error: null })
      const [confirmName, setConfirmName] = React.useState(null)
      const [busyName, setBusyName] = React.useState(null)
      const [notice, setNotice] = React.useState(null)

      const load = React.useCallback((force) => {
        const url = force === true ? `${LIST_URL}?refresh=1` : LIST_URL
        return getJson(url)
          .then((body) => {
            if (body.deleted === true) return null
            setState({ status: 'ready', apps: body.apps ?? [], error: null })
            return body
          })
          .catch((fetchError) => {
            setState((current) => (current.status === 'ready'
              ? current
              : { status: 'error', apps: [], error: errorMessage(fetchError) }))
            return null
          })
      }, [])

      React.useEffect(() => {
        let live = true
        const safeLoad = (force) => { if (live) void load(force) }
        safeLoad(false)
        const timer = setInterval(() => safeLoad(false), POLL_MS)
        const onFocus = () => safeLoad(true)
        window.addEventListener('focus', onFocus)
        return () => { live = false; clearInterval(timer); window.removeEventListener('focus', onFocus) }
      }, [load])

      const remove = (appName) => {
        setBusyName(appName)
        setNotice(null)
        postJson(DELETE_URL, { name: appName })
          .then((body) => {
            if (body.deleted === true) throw new Error('404')
            setNotice({ kind: 'ok', text: `${appName} · ${t('deleteDone')}` })
            setConfirmName(null)
            return load(true)
          })
          .catch((fetchError) => setNotice({ kind: 'error', text: errorMessage(fetchError) }))
          .finally(() => setBusyName(null))
      }

      const backToSession = () => {
        const layout = layoutRef.current ?? (typeof ctxGetRef.current === 'function' ? ctxGetRef.current('layout') : null)
        if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(null)
      }

      return h('div', { style: styles.page },
        h('div', { style: styles.header },
          h('div', null,
            h('h1', { style: styles.h1 }, t('title')),
            h('div', { style: styles.muted }, t('subtitle'))),
          h('div', { style: styles.row },
            h('button', { type: 'button', style: styles.button, onClick: () => load(true) }, t('refresh')))),
        notice === null ? null : h('div', null,
          h('span', { style: notice.kind === 'ok' ? styles.ok : styles.error }, notice.text)),
        state.status === 'loading' ? h('div', { style: styles.muted }, t('loading')) : null,
        state.status === 'error'
          ? h('div', { style: styles.row },
            h('span', { style: styles.error }, `${t('loadFailed')}: ${state.error ?? ''}`),
            h('button', { type: 'button', style: styles.button, onClick: () => load(true) }, t('retry')))
          : null,
        state.status === 'ready' && state.apps.length === 0
          ? h('div', { style: styles.muted }, t('emptyList'))
          : null,
        state.status === 'ready' && state.apps.length > 0
          ? h('div', { style: styles.card },
            h('div', { style: styles.tableHead },
              h('span', null, t('name')),
              h('span', null, t('desc')),
              h('span', null, t('actions'))),
            h('div', { style: styles.table },
              state.apps.map((app) => h('div', { key: app.name, style: styles.tableRow },
                h('div', null,
                  h('div', { style: { fontWeight: 600 } }, app.name),
                  h('div', { style: styles.muted },
                    `${t('version')}: ${app.version ?? '—'} · ${t('repo')}: ${app.exists === false ? t('repoMissing') : app.dirty === true ? t('repoDirty') : t('repoOk')}`)),
                h('div', { style: styles.muted }, app.description ?? ''),
                h('div', { style: { ...styles.row, justifyContent: 'flex-end' } },
                  confirmName === app.name
                    ? h(React.Fragment, null,
                      h('span', { style: styles.error }, t('confirmDelete')),
                      h('button', {
                        type: 'button', style: styles.danger, disabled: busyName === app.name,
                        onClick: () => remove(app.name),
                      }, busyName === app.name ? t('deleting') : t('delete')),
                      h('button', { type: 'button', style: styles.button, onClick: () => setConfirmName(null) }, t('cancel')))
                    : h(React.Fragment, null,
                      h('button', { type: 'button', style: styles.button, onClick: backToSession, title: t('openHint') }, t('open')),
                      h('button', { type: 'button', style: styles.ghost, onClick: () => setConfirmName(app.name) }, t('delete'))))))))
          : null)
    }

    /* ------------------------------------------------------------------ *
     * DeployWatcher — conversation.input.dock occupant (watch + spotlight).
     * Watches the latest turn: snapshots GET /api/list when a turn opens
     * (baseline) and diffs a second list against it when the turn ends —
     * on ANY end reason, the turn-tail node publishes regardless — to
     * learn which apps were deployed or updated during that turn.
     *
     * All transitions run off ONE ref fed by a primitive selector (no
     * store writes during render, no effect loops). If the baseline fetch
     * loses the race against a fast turn, the diff is silently skipped —
     * TurnTailCards' local re-scan covers that gap. A sessionId change
     * resets the watcher and clears autoStore.
     *
     * The same seat also renders the show spotlight (showStore): the slim
     * "delivered a web app" row above the composer while the calling turn
     * is live.
     * ------------------------------------------------------------------ */
    function DeployWatcher({ sessionId, useChat, t }) {
      const gate = useDedupGate(t, useChat)
      const useChatHook = useChat ?? ((selector) => selector({ order: [], nodes: new Map(), locations: { getTurn: () => [] }, timeline: { turnOrder: [], turns: new Map() } }))
      // Primitive "turn|reasonKind" encoding (sdk-notes §6 stability rule).
      const encoded = useChatHook((snapshot) => {
        const last = snapshot.timeline.turnOrder.at(-1) ?? 0
        const turn = snapshot.timeline.turns.get(last)
        return `${last}|${turn?.end?.data?.reason?.kind ?? ''}`
      })

      const watchRef = React.useRef(null) // { sessionId, turn, baseline: Map|null }
      const seenSessionRef = React.useRef(sessionId)
      if (seenSessionRef.current !== sessionId) {
        seenSessionRef.current = sessionId
        watchRef.current = null
        autoStore.clear()
      }

      React.useEffect(() => {
        const sep = encoded.indexOf('|')
        const turn = sep <= 0 ? 0 : Number(encoded.slice(0, sep))
        const kind = sep <= 0 ? '' : encoded.slice(sep + 1)
        const watching = watchRef.current
        if (watching === null || watching.turn !== turn) {
          // First sight of a new turn: start watching it.
          const entry = { sessionId, turn, baseline: null }
          watchRef.current = entry
          if (kind !== '') return undefined // already closed → nothing to diff
          let live = true
          getJson(LIST_URL)
            .then((body) => {
              if (!live || watchRef.current !== entry) return
              const baseline = new Map()
              for (const app of body.apps ?? []) baseline.set(app.name, app.commit)
              entry.baseline = baseline
            })
            .catch(() => {})
          return () => { live = false }
        }
        if (kind !== '' && watching.baseline !== null) {
          // Turn just ended with a baseline in hand → diff exactly once.
          const baseline = watching.baseline
          watchRef.current = { sessionId, turn, baseline: null } // consume
          getJson(LIST_URL)
            .then((body) => {
              const changed = []
              for (const app of body.apps ?? []) {
                const before = baseline.get(app.name)
                if (before === undefined || before !== app.commit) {
                  changed.push({ name: app.name, description: app.description ?? '', version: app.version ?? '' })
                }
              }
              if (changed.length > 0) autoStore.addForTurn(`${sessionId}|${turn}`, changed)
            })
            .catch(() => {})
        }
        return undefined
      }, [encoded, sessionId])

      // Show spotlight: the latest dsh-web-app-show delivery for THIS
      // session, rendered above the composer while its turn is live. On
      // turn end (any reason) it hands over to the turn-tail teaser — the
      // same push already fed autoStore, so the card appears there.
      const spotlight = React.useSyncExternalStore(
        (notify) => showStore.subscribe(notify),
        () => showStore.getSnapshot(),
      )
      React.useEffect(() => {
        const sep = encoded.indexOf('|')
        const kind = sep <= 0 ? '' : encoded.slice(sep + 1)
        if (kind !== '' && showStore.getSnapshot()?.sessionId === sessionId) showStore.dismiss()
      }, [encoded, sessionId])
      if (spotlight === null || spotlight.sessionId !== sessionId) return null

      const openSpotlight = async () => {
        try {
          const body = await getJson(`${APP_URL}?name=${encodeURIComponent(spotlight.name)}`)
          if (body.deleted === true || !body.app) { showStore.dismiss(); return }
          await openFullscreenShared(body.app, sessionId, gate)
        } catch { showStore.dismiss() }
      }
      return h('div', { style: { ...styles.card, padding: '8px 12px', margin: '0 0 8px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 } },
          h(TeaserIcon, null),
          h('span', { style: { fontWeight: 600, flexShrink: 0 } }, spotlight.name),
          h('span', {
            style: {
              ...styles.muted, flex: 1, minWidth: 0, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            },
          }, t('spotlightHint')),
          h('button', { type: 'button', style: styles.primary, onClick: () => void openSpotlight() }, t('tryNow')),
          h(GhostButton, { label: '✕', onClick: () => showStore.dismiss() })))
    }

    /* ------------------------------------------------------------------ *
     * TurnTailCards — occupant of conversation.chat.turnTail (list, id
     * 'dsh-web-app', order 30). Renders one collapsed WebappTeaser per app
     * deployed/updated during THIS turn: the union of the DeployWatcher
     * diff (autoStore) and a local re-scan of the turn's tool-call nodes
     * (stringified node.data scanned for 'dsh-web-app-deploy', name picked
     * out by regex — this covers the baseline-fetch race). Scan-only names
     * fetch description/version via /api/app on sight. Renders null when
     * nothing was deployed — zero-cost placeholder. Never auto-expands and
     * never sends anything (Q3 discipline: the model sees no open action).
     * ------------------------------------------------------------------ */
    const EMPTY_ENTRIES = []

    function TurnTailCards({ turn, sessionId, useChat, t }) {
      // turn is the owner's TurnLocation OBJECT ({ turn: number, status, …
      // }) per the Slots contract (TurnTailOwnerProps) — the numeric id the
      // watcher keys by lives on `.turn`. (v0.1.0 bug: using the object
      // verbatim broke both lookups below.)
      const turnId = typeof turn === 'object' && turn !== null ? turn.turn : turn
      const byTurn = React.useSyncExternalStore(
        (notify) => autoStore.subscribe(notify),
        () => autoStore.getSnapshot(),
      )
      const useChatHook = useChat ?? ((selector) => selector({ order: [], nodes: new Map(), locations: { getTurn: () => [] }, timeline: { turnOrder: [], turns: new Map() } }))
      // Primitive scan result: comma-joined app names found in this turn's
      // tool-call nodes (WeakMap-memoized per node object, so re-running the
      // selector on every chat snapshot costs Map lookups, not stringifies).
      const scannedSig = useChatHook((snapshot) => {
        const names = []
        for (const key of snapshot.locations.getTurn(turnId) ?? []) {
          const node = snapshot.nodes.get(key)
          if (!node || node.kind !== 'tool-call') continue
          const found = scanNodeForDeploy(node)
          if (found !== null) names.push(found)
        }
        return names.join(',')
      })
      const [scanMeta, setScanMeta] = React.useState({})
      const pendingMetaRef = React.useRef(new Set())

      // Fetch metadata for scan-only names (autoStore entries carry their
      // own). scanMeta is omitted from deps on purpose: functional updates
      // plus the pending set prevent duplicate fetches; a failed fetch just
      // leaves the teaser meta-less.
      React.useEffect(() => {
        if (scannedSig === '') return undefined
        let live = true
        for (const name of Array.from(new Set(scannedSig.split(',')))) {
          if (name === '' || scanMeta[name] !== undefined || pendingMetaRef.current.has(name)) continue
          pendingMetaRef.current.add(name)
          getJson(`${APP_URL}?name=${encodeURIComponent(name)}`)
            .then((body) => {
              if (!live) return
              if (body.deleted === true) {
                setScanMeta((current) => ({ ...current, [name]: null }))
                return
              }
              setScanMeta((current) => ({ ...current, [name]: { description: body.app?.description ?? '', version: body.app?.version ?? '' } }))
            })
            .catch(() => {})
            .finally(() => { pendingMetaRef.current.delete(name) })
        }
        return () => { live = false }
      }, [scannedSig])

      const autoEntries = byTurn.get(`${sessionId}|${turnId}`) ?? EMPTY_ENTRIES
      const scannedNames = scannedSig === '' ? EMPTY_ENTRIES : Array.from(new Set(scannedSig.split(',')))
      const entries = []
      const seen = new Set()
      for (const entry of autoEntries) {
        if (seen.has(entry.name)) continue
        seen.add(entry.name)
        entries.push(entry)
      }
      for (const name of scannedNames) {
        if (seen.has(name)) continue
        seen.add(name)
        entries.push({ name, description: scanMeta[name]?.description, version: scanMeta[name]?.version })
      }
      if (entries.length === 0) return null
      return h('div', { style: { display: 'grid', gap: '8px', margin: '4px 0 2px' } },
        h('div', { style: { ...styles.muted, fontSize: '11px' } }, t('autoShowNote')),
        entries.map((entry) => h(WebappTeaser, {
          key: entry.name,
          name: entry.name,
          description: entry.description,
          version: entry.version,
          sessionId,
          t,
          useChat: useChatHook,
          initialExpand: false,
        })))
    }

    /* ------------------------------------------------------------------ *
     * ShowToolview — keyed occupant of tool.call.toolview for the host
     * tool `dsh-web-app-show` ({ name, expand? }); a keyed hit REPLACES
     * the generic tool row. args arrive as a JSON string on the block
     * (in flight: block.argsRaw; finished: block.call.argsRaw). A valid
     * name renders a WebappTeaser (initialExpand=expand); anything else
     * renders a one-line error. The teaser re-validates against /api/app
     * itself, so a deleted app degrades to the deleted placeholder.
     * ------------------------------------------------------------------ */
    function ShowToolview(props) {
      const { block, sessionId, useChat, t } = props
      let parsed = null
      try {
        parsed = JSON.parse(block?.call?.argsRaw ?? block?.argsRaw ?? '{}')
      } catch {
        parsed = null
      }
      const name = parsed !== null && typeof parsed === 'object' && typeof parsed.name === 'string'
        ? parsed.name.trim()
        : ''
      // The toolview lives inside the turn-process fold, so the in-flow card
      // is hidden until the user unfolds the group. Surface the delivery
      // immediately instead: push a spotlight row (input.dock, above the
      // composer) + an autoStore entry so the turn tail shows the teaser
      // after the turn ends. Dedup by callId — chat rebuilds remount us.
      const useChatHook = useChat ?? ((selector) => selector({ order: [], nodes: new Map(), locations: { getTurn: () => [] }, timeline: { turnOrder: [], turns: new Map() } }))
      const currentTurn = useChatHook((snapshot) => snapshot.timeline.turnOrder.at(-1) ?? 0)
      React.useEffect(() => {
        if (name === '' || currentTurn <= 0) return undefined
        const dedupKey = `${sessionId}|${props.callId ?? name}`
        if (!markShowPushed(dedupKey)) return undefined
        showStore.push({ sessionId, dedupKey, name, expand: parsed?.expand === true })
        autoStore.addForTurn(`${sessionId}|${currentTurn}`, [{ name }])
        return undefined
      }, [name, sessionId, currentTurn])
      if (name === '') {
        return h('div', { style: { ...styles.muted, padding: '4px 2px' } }, t('showInvalid'))
      }
      return h(WebappTeaser, {
        name,
        sessionId,
        t,
        useChat,
        initialExpand: parsed.expand === true,
      })
    }

    /* ------------------------------------------------------------------ *
     * apply — register dictionaries, capture services, mount the slots.
     * inject = ['slots','locale','remote','remote.session'] (classic-script
     * client: no other runtime deps).
     * ------------------------------------------------------------------ */
    // 'remote' + 'remote.session' are HARD injects: cordis exposes nested
    // service namespaces only when the dotted path is declared — without it,
    // `ctx.remote.session` throws "cannot get property without inject"
    // (evidence: first-party clients all declare `inject = ["remote",
    // "remote.<ns>"]`, e.g. dsh-client-file-upload / dsh-api-remotes).
    const inject = ['slots', 'locale', 'remote', 'remote.session']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-web-app: dictionaries')
      const t = ctx.locale.bind(NS)
      void t

      // 'remote' is injected (see `inject` below), so the namespace access is
      // legal here; ctx.get remains the fallback just in case the runner
      // hands us a partially-wired ctx.
      const lookup = (service) => {
        try { return typeof ctx.get === 'function' ? (ctx.get(service) ?? null) : null } catch { return null }
      }
      try { remoteRef.current = ctx.remote ?? lookup('remote') } catch { remoteRef.current = lookup('remote') }
      ctxGetRef.current = (name) => lookup(name)
      layoutRef.current = lookup('layout')

      // ① /webapp command card — keyed by command name.
      ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
        name: 'conversation.chat.commandview',
        key: 'webapp',
        locale: NS,
        inject: (sessionId) => ({ sessionId }),
      }, WebappCard))

      // ⑤ DeployWatcher — occupant above the composer; diffs the registry
      // across each turn to learn what got deployed/updated, and renders
      // the show spotlight row (locale needed for its labels).
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'dsh-web-app-watch',
        order: 100,
        locale: NS,
      }, DeployWatcher))

      // ⑥ turn-tail announcement cards — one teaser per app deployed or
      // updated during that turn (published whatever the turn's end reason).
      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
        name: 'conversation.chat.turnTail',
        id: 'dsh-web-app',
        order: 30,
        locale: NS,
      }, TurnTailCards))

      // ⑦ dsh-web-app-show tool row — keyed toolview, replaces the generic
      // tool card when the host tool fires.
      ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
        name: 'tool.call.toolview',
        key: 'dsh-web-app-show',
        locale: NS,
      }, ShowToolview))

      // ④ fullscreen overlay — list entry, self-managed pointer events.
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'dsh-web-app.fullscreen',
        order: 100,
        locale: NS,
      }, FullscreenOverlay))

      // ② sidebar icon — id must equal the keyed main registration below.
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 30,
        locale: NS,
        label: () => t('panel'),
      }, PanelIcon))

      // ③ management page — keyed main panel.
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
      }, ManagePage))
    }

    return { apply, inject }
  },
})
