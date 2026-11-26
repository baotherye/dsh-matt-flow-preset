/**
 * Browser half of @baotherye/dsh-matt-flow-preset: the composer stage chip.
 *
 * Questions are not rendered here: the preset uses DSH's own
 * `ask_user_question` card (`@deepseek-ai/dsh-client-ui-user-questions`), so
 * this module only draws the per-feature stage ladder.
 *
 * No DSH package is imported: React comes from the browser module table.
 * Styling uses the host theme tokens (`--dsw-alias-*`) so the chip follows
 * light and dark themes.
 */
window.__ModuleLoader__.load({
  id: '@baotherye/dsh-matt-flow-preset',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const CSS = `
.mf-chip-wrap { position:relative; display:inline-flex; }
.mf-chip { display:inline-flex; align-items:center; gap:6px; height:26px; padding:0 9px; font:inherit;
  font-size:12px; color:var(--dsw-alias-label-primary); background:transparent; cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1); border-radius:999px;
  transition:border-color 120ms ease, background 120ms ease; }
.mf-chip:hover, .mf-chip[data-open='1'] { border-color:var(--dsw-alias-brand-primary);
  background:color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent); }
.mf-chip-dot { position:relative; width:22px; height:3px; border-radius:999px; overflow:hidden;
  background:var(--dsw-alias-border-l1); }
.mf-chip-dot > span { position:absolute; inset:0 auto 0 0; display:block;
  background:var(--dsw-alias-brand-primary); }
.mf-chip-label { white-space:nowrap; }
.mf-chip-count { color:var(--dsw-alias-label-secondary); font-variant-numeric:tabular-nums; }
.mf-chip-running { color:var(--dsw-alias-brand-primary); font-variant-numeric:tabular-nums; }
.mf-pop-repo { color:var(--dsw-alias-state-warn-primary); line-height:1.5; }
.mf-pop-running { display:flex; flex-direction:column; gap:3px; padding-top:2px;
  border-top:1px solid var(--dsw-alias-border-l1); }
.mf-pop-running-head { color:var(--dsw-alias-label-secondary); font-size:11px; }
.mf-pop-running-item { color:var(--dsw-alias-label-primary); }
.mf-pop-running-item::before { content:'⟳ '; color:var(--dsw-alias-brand-primary); }
.mf-pop { position:absolute; left:0; bottom:calc(100% + 8px); z-index:30; width:292px; box-sizing:border-box;
  display:flex; flex-direction:column; gap:8px; padding:12px 14px; font-size:12px;
  border:1px solid var(--dsw-alias-border-l1); border-radius:var(--dsw-radius-lg);
  background:var(--dsw-alias-bg-overlay); box-shadow:var(--dsw-elevation-panel); }
.mf-pop-head { display:flex; align-items:baseline; justify-content:space-between; gap:10px; }
.mf-pop-feature { color:var(--dsw-alias-label-primary); font-weight:600; }
.mf-pop-count { color:var(--dsw-alias-label-secondary); font-variant-numeric:tabular-nums; }
.mf-pop-track { height:3px; border-radius:999px; overflow:hidden; background:var(--dsw-alias-border-l1); }
.mf-pop-fill { display:block; height:100%; background:var(--dsw-alias-brand-primary); }
.mf-pop-steps { display:flex; flex-wrap:nowrap; gap:1px; }
.mf-pop-step { padding:2px 6px; font:inherit; font-size:12px; white-space:nowrap; background:transparent; border:1px solid transparent;
  border-radius:999px; color:var(--dsw-alias-label-secondary); white-space:nowrap; cursor:pointer;
  transition:background 120ms ease, border-color 120ms ease; }
.mf-pop-step:hover { border-color:var(--dsw-alias-border-l1); color:var(--dsw-alias-label-primary); }
.mf-pop-step[data-picked='1'] { border-color:var(--dsw-alias-border-l2); color:var(--dsw-alias-label-primary); }
.mf-pop-step[data-done='1'] { color:var(--dsw-alias-label-primary); }
.mf-pop-step[data-on='1'] { color:var(--dsw-alias-brand-primary); font-weight:600;
  background:color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent); }
.mf-pop-gate { color:var(--dsw-alias-label-secondary); line-height:1.5; }
.mf-pop-doc { color:var(--dsw-alias-label-primary); line-height:1.6; }
.mf-pop-gate[data-blocked='1'] { color:var(--dsw-alias-state-warn-primary); }
.mf-pop-next { display:flex; align-items:center; gap:8px; color:var(--dsw-alias-label-secondary); }
.mf-pop-cmd { font-family:var(--dsw-font-mono, ui-monospace, monospace); padding:1px 6px; border-radius:6px;
  border:1px solid var(--dsw-alias-border-l1); color:var(--dsw-alias-label-primary); }
.mf-action { display:inline-flex; align-items:center; gap:6px; padding:3px 10px; font:inherit; font-size:12px;
  border:1px solid var(--dsw-alias-border-l1); border-radius:8px; background:transparent;
  color:var(--dsw-alias-label-primary); cursor:pointer; transition:border-color 120ms ease, color 120ms ease; }
.mf-action:hover { border-color:var(--dsw-alias-brand-primary); color:var(--dsw-alias-brand-primary); }
`

    /**
     * The per-feature ladder. `setup` is deliberately absent: it runs once per
     * repository, not once per feature, so it would read as a step that never
     * advances again.
     */
    const STAGES = [
      { id: 'grill', label: '拷问' },
      { id: 'spec', label: '规范' },
      { id: 'tickets', label: '任务' },
      { id: 'implement', label: '实现' },
      { id: 'done', label: '收尾' },
    ]

    /** The user-side command that carries each stage forward. */
    /** The command that runs a given stage, keyed by the stage it produces. */
    const ENTER_COMMAND = {
      grill: '/grill-with-docs',
      spec: '/to-spec',
      tickets: '/to-tickets',
      implement: '/implement',
      done: null,
    }

    /**
     * What each stage is for. Written here rather than read from the log so the
     * popover never shows a stale sentence recorded by an older version.
     */
    const STAGE_DOC = {
      grill: '约定决策和术语',
      spec: '约定问题、方案、用户故事、决策、测试边界、范围',
      tickets: '约定粒度，拆成可独立验证的任务清单',
      implement: '使用 TDD 的方式实现，子任务完成时进行评审',
      done: '结束本轮变更：核验是否符合项目惯例和新增规范',
    }

    /** Read the projection without assuming hooks exist (older slots omit them). */
    /** Legacy logs recorded the retired pre-grill stages; fold them onto the first one. */
    const STAGE_ALIASES = { setup: 'grill', idea: 'grill', review: 'done' }

    /** Chinese label for a stage id, falling back to the id itself. */
    function stageLabel(id) {
      const found = STAGES.find((stage) => stage.id === id)
      return found ? found.label : id
    }

    function useFlow(useProjection) {
      if (typeof useProjection !== 'function') return null
      const value = useProjection('matt-flow')
      if (!value || typeof value !== 'object' || typeof value.stage !== 'string') return null
      return { ...value, stage: STAGE_ALIASES[value.stage] ?? value.stage }
    }

    /**
     * The preset this session runs. The client bundle is a top-level package, so
     * its slot entries exist in every session; this gate keeps the workflow UI
     * inside the preset that owns it.
     */
    function useSessionPreset(props) {
      const useSessions = props.useSessions
      if (typeof useSessions !== 'function' || typeof props.sessionId !== 'string') return undefined
      return useSessions((state) => state.byId[props.sessionId]?.projectionValues?.agentPreset)
    }

    /**
     * Names of the subagents currently running under this session. The subagent
     * UI reads the same `subagentCatalog` projection through `useSessions`, so
     * this shows exactly the children that surface in the header catalog.
     */
    /**
     * Names of the subagents currently running under this session.
     *
     * Mirrors how the subagent header derives its catalog: `subagentCatalog` is
     * an array on the session projection, and an entry is running when the
     * session-status store says so — the projection itself carries no activity.
     */
    function useSubagentState(props) {
      const useSessions = props.useSessions
      const useSessionStatus = props.useSessionStatus
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
      const hasHooks = typeof useSessions === 'function' && typeof useSessionStatus === 'function' && sessionId !== ''

      const catalog = hasHooks
        ? useSessions((state) => {
          const snapshot = state.projectionsBySession && state.projectionsBySession[sessionId]
          return snapshot ? snapshot.values && snapshot.values.subagentCatalog : undefined
        })
        : undefined
      const statuses = hasHooks ? useSessionStatus((value) => value) : undefined
      const summaries = hasHooks ? useSessions((state) => state.byId) : undefined

      const entries = Array.isArray(catalog) ? catalog : []
      const running = entries
        .filter((entry) => {
          if (!entry || !entry.id) return false
          if (entry.mode === 'external') return false
          // A child with no status record yet still reports `running` on its
          // session summary, so fall back to it the way the header catalog does.
          const status = statuses && typeof statuses.get === 'function' ? statuses.get(entry.id) : undefined
          const summary = summaries ? summaries[entry.id] : undefined
          return (status ? status.running : summary ? summary.running : undefined) === true
        })
        .map((entry) => (typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : entry.id))

      return running
    }

    function StageChip(props) {
      const preset = useSessionPreset(props)
      const flow = useFlow(props.useProjection)
      const running = useSubagentState(props)
      const [open, setOpen] = React.useState(false)
      const [picked, setPicked] = React.useState(null)
      const box = React.useRef(null)

      React.useEffect(() => {
        if (!open) return undefined
        const onDown = (event) => {
          if (box.current && !box.current.contains(event.target)) setOpen(false)
        }
        const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onDown)
          document.removeEventListener('keydown', onKey)
        }
      }, [open])

      if (preset !== undefined && preset !== 'matt-flow') return null
      if (!flow) return null
      const currentIndex = STAGES.findIndex((stage) => stage.id === flow.stage)
      if (currentIndex < 0) return null

      const stage = STAGES[currentIndex]
      // Open on the stage the feature is actually in; the pills let you look ahead.
      const pickedIndex = typeof picked === 'number' && picked >= 0 && picked < STAGES.length ? picked : currentIndex
      const pickedStage = STAGES[pickedIndex]
      const isCurrent = pickedIndex === currentIndex
      const isPast = pickedIndex < currentIndex
      const pickedCommand = ENTER_COMMAND[pickedStage?.id] ?? null
      const percent = Math.round((currentIndex / (STAGES.length - 1)) * 100)

      return h('span', { className: 'mf-chip-wrap', ref: box }, [
        h('style', { key: 'css' }, CSS),
        h('button', {
          key: 'chip',
          type: 'button',
          className: 'mf-chip',
          'data-open': open ? '1' : '0',
          'aria-expanded': open ? 'true' : 'false',
          title: `${flow.feature} · ${stage.label} ${currentIndex + 1}/${STAGES.length}`,
          onClick: () => {
            if (!open) setPicked(null)
            setOpen(!open)
          },
        }, [
          h('span', { key: 'dot', className: 'mf-chip-dot' },
            h('span', { key: 'fill', style: { width: `${percent}%` } })),
          h('span', { key: 'label', className: 'mf-chip-label' }, stage.label),
          h('span', { key: 'count', className: 'mf-chip-count' }, `${currentIndex + 1}/${STAGES.length}`),
          running.length > 0
            ? h('span', { key: 'running', className: 'mf-chip-running', title: running.join('、') },
              `${running.length} 个子代理`)
            : null,
        ]),
        open
          ? h('div', { key: 'pop', className: 'mf-pop', role: 'dialog' }, [
            h('div', { key: 'head', className: 'mf-pop-head' }, [
              h('span', { key: 'feature', className: 'mf-pop-feature' }, flow.feature),
              h('span', { key: 'count', className: 'mf-pop-count' }, `${currentIndex + 1}/${STAGES.length}`),
            ]),
            h('span', { key: 'track', className: 'mf-pop-track' },
              h('span', { key: 'fill', className: 'mf-pop-fill', style: { width: `${percent}%` } })),
            h('div', { key: 'steps', className: 'mf-pop-steps', role: 'tablist' },
              STAGES.map((item, index) => h('button', {
                key: item.id,
                type: 'button',
                role: 'tab',
                'aria-selected': index === pickedIndex ? 'true' : 'false',
                className: 'mf-pop-step',
                'data-on': index === currentIndex ? '1' : '0',
                'data-done': index < currentIndex ? '1' : '0',
                'data-picked': index === pickedIndex ? '1' : '0',
                onClick: () => setPicked(index),
              }, item.label))),
            h('div', {
              key: 'status',
              className: 'mf-pop-gate',
            }, isCurrent ? '当前阶段' : isPast ? '已通过' : '未开始'),
            h('div', { key: 'doc', className: 'mf-pop-doc' }, STAGE_DOC[pickedStage?.id] ?? ''),
            // A resumed record was derived from files, not walked through here;
            // say so once, on the stage it landed on.
            isCurrent && flow.resumed
              ? h('div', { key: 'resumed', className: 'mf-pop-repo' },
                flow.found && flow.found.length > 0
                  ? `从磁盘恢复：${flow.found.join('、')}`
                  : '从磁盘恢复：这个功能还没有留下任何文件')
              : null,
            flow.repoReady === false
              ? h('div', { key: 'repo', className: 'mf-pop-repo' },
                '仓库未初始化：issue 放在哪还没写进 docs/agents/issue-tracker.md')
              : null,
            running.length > 0
              ? h('div', { key: 'running', className: 'mf-pop-running' }, [
                h('span', { key: 'head', className: 'mf-pop-running-head' }, '子代理运行中'),
                ...running.map((name, index) => h('span', {
                  key: `sub-${index}`,
                  className: 'mf-pop-running-item',
                }, name)),
              ])
              : null,
            pickedCommand
              ? h('div', { key: 'next', className: 'mf-pop-next' }, [
                h('span', { key: 'text' }, '进入命令'),
                h('span', { key: 'cmd', className: 'mf-pop-cmd' }, pickedCommand),
              ])
              : null,
          ])
          : null,
      ])
    }


    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'matt-flow-stage',
          order: 50,
        }, StageChip))
      },
    }
  },
})
