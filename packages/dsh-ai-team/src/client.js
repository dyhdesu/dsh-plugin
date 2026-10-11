// dsh-ai-team client 半区:全局主面板「AI 团队」。
// 注册顺序:'main' keyed slot(声明存在、生态未实证)→ 失败降级 settings.section。
// 数据轮询 GET /api/ai-team/board;中断 POST /api/ai-team/interrupt。
// 样式 React 渲染注入,类名前缀 at-;只读看板,仅中断入口。

window.__ModuleLoader__.load({
  id: '@mzzsfy/dsh-ai-team',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    const API = '/api/ai-team/'
    const REFRESH_MS = 5 * 1000
    const ARMED_TIMEOUT_MS = 3 * 1000
    const PLUGIN_ID = '@mzzsfy/dsh-ai-team'
    const SLOT_ID = 'ai-team'

    const NAV_ICON = { 'AI 团队': 'team', 'dsh-ai-team': 'team' }
    if (window.__navicIcons !== undefined) window.__navicIcons.register(NAV_ICON)
    else if (Array.isArray(window.__navicIconQueue)) window.__navicIconQueue.push(NAV_ICON)
    else window.__navicIconQueue = [NAV_ICON]

    const COLUMNS = [
      { key: 'draft', label: '草案' },
      { key: 'ready', label: '就绪' },
      { key: 'implementing', label: '实施中' },
      { key: 'awaiting_acceptance', label: '待验收' },
      { key: 'blocked', label: '受阻' },
      { key: 'completed', label: '已完成' },
    ]

    const RUN_STATE_TONES = {
      running: 'business', prepared: 'mute', submitted: 'business',
      settled: 'success', interrupted: 'warn', rejected: 'error', unknown: 'mute',
    }
    const RUN_STATE_LABELS = {
      prepared: '准备', submitted: '已提交', running: '执行中',
      settled: '已落定', interrupted: '已中断', rejected: '被驳回', unknown: '未知',
    }

    const CSS = `
.at-root{max-width:960px;margin:0 auto;display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary,#0f1115);padding-top:10px}
.at-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.at-head__title{font:600 16px/24px var(--dsw-font-family,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif)}
.at-head__caption{font:400 var(--dsw-font-xs-13,13px/20px sans-serif);color:var(--dsw-alias-label-tertiary,#81858c);flex:1}
.at-btn{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,#61666b);font:500 var(--dsw-font-xs-13,13px/20px sans-serif);border-radius:8px;padding:5px 12px;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
.at-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));color:var(--dsw-alias-label-primary,#0f1115)}
.at-btn--danger{color:var(--dsw-alias-state-error-primary,#ec1313)}
.at-btn--danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(236,19,19,.06));border-color:var(--dsw-alias-state-error-primary,#ec1313)}
.at-btn:disabled{opacity:.45;cursor:default}
.at-error{font:400 var(--dsw-font-xs-13,13px/20px sans-serif);color:var(--dsw-alias-state-error-primary,#ec1313)}
.at-board{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.at-col{display:flex;flex-direction:column;gap:6px;min-width:0}
.at-col__head{display:flex;align-items:baseline;gap:6px;padding:2px}
.at-col__title{font:600 var(--dsw-font-xs-13,13px/20px sans-serif);color:var(--dsw-alias-label-secondary,#61666b)}
.at-col__count{font:400 var(--dsw-font-xxs-12,12px/18px sans-serif);color:var(--dsw-alias-label-caption,#adb2b8)}
.at-card{border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:10px;background:var(--dsw-alias-bg-base,#fff);padding:10px 12px;display:flex;flex-direction:column;gap:6px;min-width:0}
.at-card__goal{font:500 var(--dsw-font-xs-13,13px/20px sans-serif);line-height:1.5;word-break:break-word}
.at-note{font:400 var(--dsw-font-xxs-12,12px/18px sans-serif);color:var(--dsw-alias-label-caption,#adb2b8);word-break:break-all}
.at-badge{display:inline-flex;align-items:center;gap:4px;font:500 var(--dsw-font-xxs-12,12px/18px sans-serif);border-radius:999px;padding:2px 8px;white-space:nowrap;width:max-content}
.at-badge--business{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 12%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6)}
.at-badge--success{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 12%,transparent);color:var(--dsw-alias-state-success-primary,#16a34a)}
.at-badge--warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 14%,transparent);color:var(--dsw-alias-state-warn-primary,#b45309)}
.at-badge--error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ec1313) 10%,transparent);color:var(--dsw-alias-state-error-primary,#ec1313)}
.at-badge--mute{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));color:var(--dsw-alias-label-tertiary,#81858c)}
.at-section{display:flex;flex-direction:column;gap:8px}
.at-section__title{font:600 var(--dsw-font-xs-13,13px/20px sans-serif);color:var(--dsw-alias-label-secondary,#61666b)}
.at-timeline{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;max-height:360px;overflow:auto}
.at-timeline__row{display:flex;align-items:baseline;gap:8px;font:400 var(--dsw-font-xs-13,13px/20px sans-serif);line-height:1.55;padding:4px 6px;border-radius:6px;flex-wrap:wrap}
.at-timeline__row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
.at-timeline__when{font-family:ui-monospace,SFMono-Regular,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary,#81858c);flex:none}
.at-timeline__sum{word-break:break-word;flex:1;min-width:160px}
.at-timeline__row--live .at-timeline__sum{color:var(--dsw-alias-state-business-primary,#4176e6)}
.at-stopped{border:1px solid var(--dsw-alias-state-warn-primary,#f59e0b);border-radius:10px;padding:8px 12px;font:500 var(--dsw-font-xs-13,13px/20px sans-serif);color:var(--dsw-alias-state-warn-primary,#b45309);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 8%,transparent)}
.at-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:40px 0 36px;color:var(--dsw-alias-label-tertiary,#81858c);font:400 var(--dsw-font-xs-13,13px/20px sans-serif);text-align:center}
`

    async function request(path) {
      let res
      try { res = await fetch(API + path) } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
      let json = null
      try { json = await res.json() } catch { json = null }
      if (!res.ok) return { ok: false, error: json && json.error ? json.error : '请求失败(' + res.status + ')' }
      return { ok: true, data: json }
    }

    async function post(path, body) {
      let res
      try {
        res = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
      } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
      let json = null
      try { json = await res.json() } catch { json = null }
      if (!res.ok) return { ok: false, error: json && json.error ? json.error : '请求失败(' + res.status + ')', data: json }
      return { ok: true, data: json }
    }

    function fmtTime(ts) {
      if (typeof ts !== 'number' || !(ts > 0)) return '-'
      const d = new Date(ts)
      const p = (n) => String(n).padStart(2, '0')
      return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
    }

    function fmtDuration(ms) {
      if (!(ms > 0)) return '-'
      const SECOND = 1000
      const MINUTE = 60 * SECOND
      const HOUR = 60 * MINUTE
      if (ms < MINUTE) return Math.round(ms / SECOND) + 's'
      if (ms < HOUR) return Math.round(ms / MINUTE) + 'm'
      return (ms / HOUR).toFixed(1) + 'h'
    }

    function fmtTokens(n) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return '-'
      if (n < 1000 * 10) return String(n)
      return (n / 1000).toFixed(1) + 'k'
    }

    function Badge({ tone, children }) {
      return h('span', { className: 'at-badge at-badge--' + tone }, children)
    }

    function RunBadge({ state }) {
      return h(Badge, { tone: RUN_STATE_TONES[state] || 'mute' }, RUN_STATE_LABELS[state] || state || '-')
    }

    // 危险操作两段确认
    function ArmedButton({ label, confirmLabel, onConfirm, disabled }) {
      const [armed, setArmed] = useState(false)
      useEffect(() => {
        if (!armed) return undefined
        const t = setTimeout(() => setArmed(false), ARMED_TIMEOUT_MS)
        return () => clearTimeout(t)
      }, [armed])
      return h('button', { className: 'at-btn at-btn--danger', type: 'button', disabled: disabled || undefined,
        onClick: () => { if (armed) { setArmed(false); onConfirm() } else setArmed(true) } }, armed ? confirmLabel : label)
    }

    // 投影派生:列分桶 / 时间线 / 模型汇总(provider+model+taskId 去重)
    function deriveViews(tasks) {
      const byColumn = {}
      for (const c of COLUMNS) byColumn[c.key] = []
      const runs = []
      const modelMap = new Map()
      for (const t of tasks || []) {
        if (byColumn[t.businessState]) byColumn[t.businessState].push(t)
        for (const r of t.runs || []) {
          runs.push({ task: t, run: r, endAt: typeof r.endedAt === 'number' && r.endedAt > 0 ? r.endedAt : null })
          const key = (r.model || '-') + '|' + t.taskId
          if (!modelMap.has(key)) {
            modelMap.set(key, { model: r.model || '-', taskId: t.taskId, goal: t.goal, state: r.state })
          }
        }
      }
      runs.sort((a, b) => (a.run.startedAt || 0) - (b.run.startedAt || 0))
      return { byColumn, runs, models: [...modelMap.values()] }
    }

    function TaskCard({ task, onInterrupt, busy }) {
      const tokens = task.tokens || {}
      return h('div', { className: 'at-card' },
        h('span', { className: 'at-card__goal', title: task.goal }, task.goal || task.taskId),
        h('span', { className: 'at-note' }, (task.workspaceId || '-') + ' · ' + task.taskId),
        typeof tokens.total === 'number'
          ? h('span', { className: 'at-note' },
              '累计 token: ' + fmtTokens(tokens.total),
              tokens.complete === false ? '(不完整)' : '')
          : null,
        (task.runs || []).length
          ? h('span', { className: 'at-note' }, 'runs: ' + task.runs.length + ' · ' + ((task.models || []).join(', ') || '-'))
          : null,
        h('div', {},
          h('button', { className: 'at-btn at-btn--danger', type: 'button', disabled: busy || undefined,
            onClick: () => onInterrupt(task.taskId) }, '中断')))
    }

    function Board({ tasks, onInterrupt, busyId }) {
      const { byColumn } = deriveViews(tasks)
      return h('div', { className: 'at-board' },
        COLUMNS.map((c) => h('div', { className: 'at-col', key: c.key },
          h('div', { className: 'at-col__head' },
            h('span', { className: 'at-col__title' }, c.label),
            h('span', { className: 'at-col__count' }, String(byColumn[c.key].length))),
          byColumn[c.key].map((t) => h(TaskCard, { key: t.taskId, task: t, onInterrupt, busyId: busyId })))))
    }

    function Timeline({ tasks }) {
      const { runs } = deriveViews(tasks)
      if (runs.length === 0) return null
      return h('div', { className: 'at-section' },
        h('span', { className: 'at-section__title' }, '时间线'),
        h('ul', { className: 'at-timeline' },
          runs.map(({ task, run, endAt }, i) => {
            const live = endAt === null
            const span = (endAt || Date.now()) - (run.startedAt || 0)
            return h('li', { className: 'at-timeline__row' + (live ? ' at-timeline__row--live' : ''), key: i },
              h('span', { className: 'at-timeline__when' }, fmtTime(run.startedAt) + ' → ' + (live ? '进行中' : fmtTime(endAt))),
              h(RunBadge, { state: run.state }),
              h('span', { className: 'at-timeline__sum' }, (run.phase || '-') + ' · ' + (task.goal || task.taskId)),
              h('span', { className: 'at-timeline__when' }, fmtDuration(span) + (live ? '+' : '')))
          })))
    }

    function ModelSummary({ tasks }) {
      const { models } = deriveViews(tasks)
      if (models.length === 0) return null
      return h('div', { className: 'at-section' },
        h('span', { className: 'at-section__title' }, '模型任务'),
        models.map((m, i) => h('div', { className: 'at-timeline__row', key: i },
          h(Badge, { tone: 'business' }, m.model),
          h('span', { className: 'at-timeline__sum' }, m.goal || m.taskId),
          h(RunBadge, { state: m.state }))))
    }

    // 轮询:页面隐藏即停;仅受理最新一次请求的响应(请求序号防旧覆新)
    function useBoard() {
      const [board, setBoard] = useState(null)
      const [error, setError] = useState('')
      const seqRef = useRef(0)
      const reload = useCallback(async () => {
        const seq = ++seqRef.current
        const outcome = await request('board')
        if (seq !== seqRef.current) return
        if (outcome.ok) { setBoard(outcome.data); setError('') } else setError(outcome.error)
      }, [])
      useEffect(() => {
        reload()
        const timer = setInterval(() => {
          if (document.visibilityState === 'visible') reload()
        }, REFRESH_MS)
        const onVisible = () => { if (document.visibilityState === 'visible') reload() }
        document.addEventListener('visibilitychange', onVisible)
        return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
      }, [reload])
      return { board, error, reload }
    }

    function Panel() {
      const { board, error, reload } = useBoard()
      const [busyId, setBusyId] = useState('')
      const [actionError, setActionError] = useState('')
      const tasks = (board && Array.isArray(board.tasks)) ? board.tasks : null
      const globalStopped = !!(board && board.control && board.control.globalStopped)
      const interrupt = async (body) => {
        setActionError('')
        const outcome = await post('interrupt', body)
        if (!outcome.ok) { setActionError(outcome.error); return }
        if (outcome.data && outcome.data.accepted === false) { setActionError('未受理: ' + ((outcome.data.form && outcome.data.form.error) || '状态已变化')); return }
        reload()
      }
      const interruptTask = async (taskId) => {
        setBusyId(taskId)
        await interrupt({ taskId })
        setBusyId('')
      }
      const globalStop = () => interrupt({ global: true })
      return h('div', { className: 'at-root' },
        h('style', { 'data-plugin': PLUGIN_ID, dangerouslySetInnerHTML: { __html: CSS } }),
        h('div', { className: 'at-head' },
          h('span', { className: 'at-head__title' }, 'AI 团队'),
          h('span', { className: 'at-head__caption' }, '只读看板 · 中断入口')),
        globalStopped ? h('div', { className: 'at-stopped' }, '全局已停止:派发被拒绝,等待控制方解除') : null,
        error && !tasks ? h('span', { className: 'at-error' }, error) : null,
        actionError ? h('span', { className: 'at-error' }, actionError) : null,
        tasks
          ? h(React.Fragment, null,
              h('div', { className: 'at-head' },
                h(ArmedButton, { label: '全局紧急停止', confirmLabel: '确认停止全部', onConfirm: globalStop })),
              tasks.length === 0
                ? h('div', { className: 'at-empty' }, '暂无任务')
                : h(React.Fragment, null,
                    h(Board, { tasks, onInterrupt: interruptTask, busyId }),
                    h(Timeline, { tasks }),
                    h(ModelSummary, { tasks })))
          : null)
    }

    function apply(ctx) {
      // 'main' 主面板 + 侧栏图标位(cron-board/tunnel 同构)
      ctx.slots.inject('main', () => ctx.slots.register(
        { name: 'main', id: SLOT_ID, key: SLOT_ID, label: 'AI 团队' }, Panel))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
        { name: 'sidebar.panellist', id: SLOT_ID, label: 'AI 团队' }, SidebarIcon))
    }

    function SidebarIcon(props) {
      return h('span', { title: 'AI 团队' }, props?.label ?? '团队')
    }

    return { inject: ['slots'], apply }
  },
})
