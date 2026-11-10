/**
 * OpenCode Go quota — Client half.
 *
 * Registers three surfaces on top of one shared store:
 *   1. a sidebar panel entry (`sidebar.panellist` + the matching `main` panel),
 *   2. the quota page itself: three ring gauges, a detail table under them,
 *      and a one-line badge switch,
 *   3. a compact badge in the composer toolbar, immediately before the model
 *      selector (`conversation.input.right`), shown only while the session's
 *      selected model belongs to the OpenCode Go provider.
 *
 * The store polls the Host routes every five minutes and is shared by every
 * surface, so opening the page never starts a second request cycle.
 */
window.__ModuleLoader__.load({
  id: 'dsh-opencode-quota-panel',
  factory(require) {
    const React = require('react')
    // The hover card portals to the page body because the docked composer
    // clips fixed overlays. Resolving react-dom defensively keeps a missing
    // module from taking the whole client half (sidebar entry included) down:
    // without it the badge simply has no hover card.
    let ReactDOM = null
    try {
      ReactDOM = require('react-dom')
    } catch {
      ReactDOM = null
    }
    const h = React.createElement

    const NS = 'opencode-quota'
    const PANEL_ID = 'opencode-quota'
    const ENDPOINT = '/opencode-quota/v2/usage'
    const PREFS_ENDPOINT = '/opencode-quota/v2/prefs'
    const REFRESH_INTERVAL_MS = 5 * 60 * 1000
    // Provider id the quota belongs to (the same route the Host reads the
    // OPENCODE_GO_API_KEY for); the toolbar badge is hidden for other models.
    const OPENCODE_PROVIDER = 'opencode-go'
    const WINDOWS = [
      { id: 'rolling', labelKey: 'window.rolling', shortKey: 'short.rolling' },
      { id: 'weekly', labelKey: 'window.weekly', shortKey: 'short.weekly' },
      { id: 'monthly', labelKey: 'window.monthly', shortKey: 'short.monthly' },
    ]
    // Ring geometry: one viewBox unit == one CSS pixel, so the arc length is
    // exact and the ring scales with `width`/`height` alone.
    const RING_SIZE = 152
    const RING_STROKE = 8
    // The badge popover reuses the same ring drawing at a third of the size.
    // Padding scales with the diameter so the inner opening stays readable.
    const MINI_RING_SIZE = 54
    const MINI_RING_STROKE = 4.5

    const zh = {
      'entry.label': 'OpenCode 额度',
      'panel.title': 'OpenCode 额度',
      'panel.refresh': '刷新',
      'panel.refreshing': '刷新中…',
      'panel.updated': '更新于',
      'panel.source': '数据来自 opencode.ai',
      'panel.autoRefresh': '每 5 分钟自动刷新',
      'window.rolling': '5 小时',
      'window.weekly': '本周',
      'window.monthly': '本月',
      'short.rolling': '5h',
      'short.weekly': '周',
      'short.monthly': '月',
      used: '已用',
      remaining: '剩余',
      reset: '重置',
      'countdown.suffix': '后重置',      'forecast.endsAt': '预计用到',
      'forecast.over': '会超额',
      'forecast.avg': '平均',
      'forecast.perHour': '%/小时',
      'forecast.perDay': '%/天',
      'forecast.assumed': '本月按 30 天估算',
      'forecast.insufficient': '数据不足',
      'forecast.insufficientNote': '窗口刚开始，稍后再看',
      'forecast.unknownSpan': '周期长度未确认，暂不估算',
      'detail.window': '窗口',
      'detail.rate': '平均速率',
      'detail.resetsAt': '重置时间',
      'detail.note.rate': '平均速率 = 已用量 ÷ 本周期已过时间',
      'detail.note.scope': '窗口刚开始时不估算',
      'settings.badge.label': '输入框徽章',
      'settings.badge.desc': '在输入框上方显示额度徽章；关闭后只保留侧边栏入口。',
      'popover.hint': '点击徽章查看额度明细',
      'popover.forecast': '预计',
      'state.loading': '正在获取额度…',
      'state.unavailable': '额度不可用',
      'state.noCredential': '未找到 OPENCODE_GO_API_KEY 凭证，请先在「设置 → 模型」中配置 OpenCode Go。',
      'state.unauthorized': '凭证被拒绝（HTTP 401/403），请检查 OpenCode Go 的 API Key。',
      'state.timeout': '请求超时，请稍后重试。',
      'state.network': '无法连接 opencode.ai，请检查网络。',
      'state.http': 'opencode.ai 返回了异常状态。',
      'state.badResponse': '接口返回了无法识别的数据。',
      'state.internal': '额度插件内部错误。',
      'state.failed': '额度获取失败。',
      'unit.day': '天',
      'unit.hour': '小时',
      'unit.minute': '分钟',
      'countdown.soon': '即将重置',
      'countdown.now': '已到重置时间',
      'time.justNow': '刚刚',
    }

    const en = {
      'entry.label': 'OpenCode quota',
      'panel.title': 'OpenCode quota',
      'panel.refresh': 'Refresh',
      'panel.refreshing': 'Refreshing…',
      'panel.updated': 'Updated',
      'panel.source': 'Source: opencode.ai',
      'panel.autoRefresh': 'Refreshes every 5 minutes',
      'window.rolling': '5 hours',
      'window.weekly': 'This week',
      'window.monthly': 'This month',
      'short.rolling': '5h',
      'short.weekly': 'wk',
      'short.monthly': 'mo',
      used: 'used',
      remaining: 'left',
      reset: 'reset',
      'countdown.suffix': ' to reset',
      'forecast.endsAt': 'projected',
      'forecast.over': 'over quota',
      'forecast.avg': 'avg',
      'forecast.perHour': '%/h',
      'forecast.perDay': '%/day',
      'forecast.assumed': 'monthly cycle assumed to be 30 days',
      'forecast.insufficient': 'not enough data',
      'forecast.insufficientNote': 'The window just started; check again later',
      'forecast.unknownSpan': 'The cycle length is unconfirmed',
      'detail.window': 'Window',
      'detail.rate': 'Average',
      'detail.resetsAt': 'Resets at',
      'detail.note.rate': 'Average = used ÷ elapsed in this cycle',
      'detail.note.scope': 'No projection until the window has run a while',
      'settings.badge.label': 'Composer badge',
      'settings.badge.desc': 'Shows the quota badge above the composer. Turning it off keeps the sidebar entry.',
      'popover.hint': 'Click the badge for details',
      'popover.forecast': 'projected',
      'state.loading': 'Fetching quota…',
      'state.unavailable': 'Quota unavailable',
      'state.noCredential': 'No OPENCODE_GO_API_KEY credential. Configure OpenCode Go under Settings → Models first.',
      'state.unauthorized': 'The credential was rejected (HTTP 401/403). Check the OpenCode Go API key.',
      'state.timeout': 'The request timed out. Try again shortly.',
      'state.network': 'Could not reach opencode.ai. Check the network connection.',
      'state.http': 'opencode.ai answered with an error status.',
      'state.badResponse': 'The endpoint returned an unrecognized payload.',
      'state.internal': 'Internal quota plugin error.',
      'state.failed': 'Could not read the quota.',
      'unit.day': 'd',
      'unit.hour': 'h',
      'unit.minute': 'm',
      'countdown.soon': 'any minute',
      'countdown.now': 'due',
      'time.justNow': 'just now',
    }

    // Everything is expressed with alias tokens, so light and dark themes come
    // for free. The only mixed colours are alpha tracks, which need a colour
    // that exists in both themes.
    const CSS = `
.ocq-page{box-sizing:border-box;height:100%;min-height:0;overflow-y:auto;display:flex;flex-direction:column;align-items:center;gap:16px;padding:22px clamp(20px,3vw,40px) 24px;background:var(--dsw-alias-bg-base);font-family:inherit}
.ocq-head,.ocq-panel,.ocq-detail,.ocq-setting,.ocq-foot,.ocq-error,.ocq-empty{width:100%;max-width:760px}
.ocq-head{display:flex;align-items:center;gap:12px}
.ocq-title{font-size:15px;line-height:22px;font-weight:600;letter-spacing:.2px;color:var(--dsw-alias-label-primary)}
.ocq-updated{margin-left:auto;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.ocq-iconbtn{flex:none;width:26px;height:26px;padding:0;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;justify-content:center;cursor:pointer}
.ocq-iconbtn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.ocq-iconbtn:disabled{opacity:.5;cursor:default}
.ocq-iconbtn svg{width:15px;height:15px}
.ocq-spin{animation:ocq-spin 1s linear infinite}
@keyframes ocq-spin{to{transform:rotate(360deg)}}
.ocq-panel{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:16px;padding:26px 6px 22px}
.ocq-cell{display:flex;flex-direction:column;align-items:center;gap:8px;min-width:0;padding:0 8px;position:relative}
.ocq-cell+.ocq-cell{border-left:.5px solid var(--dsw-alias-border-l1)}
.ocq-name{font-size:12.5px;line-height:18px;font-weight:500;letter-spacing:.3px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.ocq-ringwrap{position:relative;width:${RING_SIZE}px;height:${RING_SIZE}px;flex:none}
.ocq-ring{display:block}
.ocq-ring-track{fill:none;stroke:color-mix(in srgb,var(--dsw-alias-label-secondary) 24%,transparent);stroke-width:${RING_STROKE}}
.ocq-ring-arc{fill:none;stroke:var(--ocq-tone,var(--dsw-alias-state-idle-primary));stroke-width:${RING_STROKE};stroke-linecap:round;transition:stroke-dasharray .35s ease}
.ocq-ring-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ocq-ring-line{display:flex;align-items:baseline}
.ocq-ring-num{font-size:31px;line-height:33px;font-weight:600;letter-spacing:-1px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.ocq-ring-pct{font-size:12.5px;line-height:16px;margin-left:1px;color:var(--dsw-alias-label-secondary)}
.ocq-ring-cap{margin-top:1px;font-size:10px;line-height:14px;letter-spacing:1.2px;color:var(--dsw-alias-label-secondary)}
.ocq-reset{font-size:11.5px;line-height:16px;text-align:center;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.ocq-reset b{font-weight:500;color:var(--dsw-alias-label-primary)}
.ocq-forecast{display:inline-flex;align-items:baseline;gap:5px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.ocq-forecast b{font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-primary)}
.ocq-forecast.is-danger b{color:var(--dsw-alias-state-error-primary)}
.ocq-detail{background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;padding:2px 16px 9px}
.ocq-detail-head,.ocq-detail-row{display:grid;grid-template-columns:minmax(72px,1fr) 72px 104px 150px;align-items:center;gap:12px}
.ocq-detail-head{padding:9px 0 7px;font-size:10.5px;line-height:14px;letter-spacing:.4px;color:var(--dsw-alias-label-secondary)}
.ocq-detail-row{padding:9px 0;border-top:.5px solid var(--dsw-alias-border-l1);font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.ocq-detail-name{color:var(--dsw-alias-label-secondary)}
.ocq-detail-num{text-align:right}
.ocq-detail-note{padding:9px 0 0;border-top:.5px solid var(--dsw-alias-border-l1);font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;gap:1px}
.ocq-setting{display:flex;align-items:center;gap:14px;padding:11px 18px;border:.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.ocq-setting-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary)}
.ocq-grow{flex:1;min-width:0}
.ocq-switch{position:relative;flex:none;width:36px;height:20px;padding:0;border:none;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 38%,transparent);box-shadow:inset 0 0 0 .5px color-mix(in srgb,var(--dsw-alias-label-secondary) 22%,transparent);cursor:pointer;transition:background .15s ease}
.ocq-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary);box-shadow:none}
.ocq-switch:disabled{opacity:.6;cursor:default}
.ocq-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base);box-shadow:0 1px 2px #00000033;transition:transform .15s ease}
.ocq-switch[aria-checked="true"]::after{transform:translateX(16px)}
.ocq-foot{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:0 2px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.ocq-error{display:flex;align-items:center;gap:10px;padding:10px 14px;border:.5px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 6%,var(--dsw-alias-bg-layer-1));font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary)}
.ocq-error svg{flex:none;width:15px;height:15px;color:var(--dsw-alias-state-error-primary)}
.ocq-retry{flex:none;padding:3px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-primary);font-size:11px;line-height:16px;font-family:inherit;cursor:pointer}
.ocq-retry:hover:not(:disabled){border-color:var(--dsw-alias-label-secondary)}
.ocq-empty{display:flex;align-items:center;justify-content:center;min-height:200px;border:.5px dashed var(--dsw-alias-border-l2);border-radius:14px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.ocq-dock{display:flex;align-items:center;gap:4px;font-family:inherit}
.ocq-dockbtn{display:inline-flex;align-items:center;padding:3px 6px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;cursor:pointer}
.ocq-dockbtn:hover{background:var(--dsw-alias-bg-layer-2)}
.ocq-seg{display:inline-flex;align-items:center;gap:4px;padding:0 6px;white-space:nowrap}
.ocq-seg+.ocq-seg{box-shadow:-.5px 0 0 var(--dsw-alias-border-l2)}
.ocq-seg i{width:4.5px;height:4.5px;border-radius:50%;flex:none;background:var(--ocq-tone,var(--dsw-alias-state-idle-primary))}
.ocq-seg b{font-weight:500;color:var(--dsw-alias-label-primary)}
.ocq-miniwrap{position:relative;flex:none}
.ocq-mini-num{font-size:13.5px;line-height:16px;font-weight:600;letter-spacing:-.4px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.ocq-mini-pct{font-size:8.5px;line-height:10px;margin-left:.5px;color:var(--dsw-alias-label-secondary)}
.ocq-pop{position:fixed;z-index:1100;box-sizing:border-box;width:252px;padding:12px 10px 9px;border-radius:12px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l1);box-shadow:0 10px 30px #00000026,0 2px 8px #00000012;font-family:inherit;color:var(--dsw-alias-label-primary)}
.ocq-pop-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:2px}
.ocq-pop-cell{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:0}
.ocq-pop-name{font-size:11px;line-height:14px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.ocq-pop-reset{font-size:10.5px;line-height:14px;color:var(--dsw-alias-label-secondary);white-space:nowrap;font-variant-numeric:tabular-nums}
.ocq-pop-proj{font-size:10.5px;line-height:14px;color:var(--dsw-alias-label-secondary);white-space:nowrap;font-variant-numeric:tabular-nums}
.ocq-pop-proj.is-danger{color:var(--dsw-alias-state-error-primary)}
.ocq-pop-foot{margin-top:9px;padding-top:7px;border-top:.5px solid var(--dsw-alias-border-l1);font-size:10.5px;line-height:14px;text-align:center;color:var(--dsw-alias-label-secondary)}
.ocq-pop-error{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-primary);padding:2px 2px 4px}
@media (prefers-reduced-motion:reduce){.ocq-ring-arc,.ocq-switch,.ocq-switch::after{transition:none}.ocq-spin{animation:none}}
@media (max-width:640px){
.ocq-panel{grid-template-columns:1fr;padding:22px 6px}
.ocq-cell+.ocq-cell{border-left:none;border-top:.5px solid var(--dsw-alias-border-l1);padding-top:16px}
.ocq-detail-head,.ocq-detail-row{grid-template-columns:minmax(60px,1fr) 64px 92px}
.ocq-detail-resets{display:none}
.ocq-seg{padding:0 4px}
}
`

    // ---------------------------------------------------------------- store
    // One snapshot for every surface; `publish` replaces the object so the
    // identity check in useSyncExternalStore sees a change.
    let snapshot = {
      phase: 'idle',
      data: null,
      error: null,
      updatedAt: 0,
      prefs: { badge: true, loaded: false, saving: false },
    }
    const listeners = new Set()

    function publish(next) {
      snapshot = next
      for (const listener of [...listeners]) {
        try {
          listener()
        } catch {
          // A broken subscriber must not stop the others.
        }
      }
    }

    function subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }

    function getSnapshot() {
      return snapshot
    }

    function useQuota() {
      return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    }

    // ------------------------------------------------------- host default model
    // The composer's model seat shows a Session's recorded selection, and for
    // a blank Session (the start page) it falls back to the Host catalog
    // default. The badge must make the same decision, or it hides exactly on
    // the page where no other model has been chosen yet. One read per Host
    // generation is enough — the default only changes through settings.
    let hostDefault = null
    const hostDefaultListeners = new Set()

    function sameSelection(left, right) {
      if (left === right) return true
      if (left === null || right === null || left === undefined || right === undefined) return false
      return left.provider === right.provider && left.model === right.model
    }

    function publishHostDefault(next) {
      if (sameSelection(hostDefault, next)) return
      hostDefault = next
      for (const listener of [...hostDefaultListeners]) {
        try {
          listener()
        } catch {
          // A broken subscriber must not stop the others.
        }
      }
    }

    function subscribeHostDefault(listener) {
      hostDefaultListeners.add(listener)
      return () => {
        hostDefaultListeners.delete(listener)
      }
    }

    function getHostDefault() {
      return hostDefault
    }

    function useHostDefault() {
      return React.useSyncExternalStore(subscribeHostDefault, getHostDefault, getHostDefault)
    }

    let inflight = null

    function refresh(force) {
      if (inflight !== null) return inflight
      publish({ ...snapshot, phase: snapshot.data === null ? 'loading' : 'refreshing' })
      inflight = (async () => {
        try {
          const response = await fetch(apiUrl(ENDPOINT) + (force === true ? '?refresh=1' : ''), {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          })
          const body = await response.json().catch(() => null)
          if (body === null || typeof body !== 'object') {
            publish({ ...snapshot, phase: 'error', error: { code: 'badResponse' } })
            return
          }
          if (body.ok === true) {
            publish({ ...snapshot, phase: 'ready', data: body, error: null, updatedAt: Date.now() })
            return
          }
          publish({ ...snapshot, phase: 'error', error: body })
        } catch {
          publish({ ...snapshot, phase: 'error', error: { code: 'network' } })
        }
      })().finally(() => {
        inflight = null
      })
      return inflight
    }

    async function refreshPrefs() {
      try {
        const response = await fetch(apiUrl(PREFS_ENDPOINT), {
          headers: { accept: 'application/json' },
          cache: 'no-store',
        })
        const body = await response.json().catch(() => null)
        if (body !== null && body.ok === true && typeof body.prefs?.badge === 'boolean') {
          publish({ ...snapshot, prefs: { ...snapshot.prefs, badge: body.prefs.badge, loaded: true } })
        } else {
          publish({ ...snapshot, prefs: { ...snapshot.prefs, loaded: true } })
        }
      } catch {
        publish({ ...snapshot, prefs: { ...snapshot.prefs, loaded: true } })
      }
    }

    async function setBadge(enabled) {
      const previous = snapshot.prefs
      publish({ ...snapshot, prefs: { ...previous, badge: enabled, saving: true } })
      try {
        const response = await fetch(apiUrl(PREFS_ENDPOINT), {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ badge: enabled }),
        })
        const body = await response.json().catch(() => null)
        if (body === null || body.ok !== true) throw new Error('rejected')
        publish({ ...snapshot, prefs: { badge: body.prefs.badge === true, loaded: true, saving: false } })
      } catch {
        publish({ ...snapshot, prefs: { ...previous, saving: false } })
      }
    }

    // ------------------------------------------------------------- helpers
    function apiUrl(path) {
      try {
        const base = new URL(globalThis.document.baseURI)
        return new URL(path.replace(/^\//, ''), base).href
      } catch {
        return path
      }
    }

    /** Remaining quota decides both the ring colour and its fill length. */
    function toneFor(remaining) {
      if (typeof remaining !== 'number' || !Number.isFinite(remaining)) return null
      if (remaining < 20) return 'var(--dsw-alias-state-error-primary)'
      if (remaining < 50) return 'var(--dsw-alias-state-warn-primary)'
      return 'var(--dsw-alias-state-success-primary)'
    }

    function percentUsed(entry) {
      return entry === null || typeof entry?.percent !== 'number' ? null : Math.round(entry.percent)
    }

    function percentLeft(used) {
      return used === null ? null : Math.max(0, 100 - used)
    }

    function describeCountdown(atIso, t, now) {
      if (typeof atIso !== 'string' || atIso.length === 0) return null
      const target = Date.parse(atIso)
      if (!Number.isFinite(target)) return null
      const delta = target - now
      if (delta <= 0) return t('countdown.now')
      const totalSeconds = Math.floor(delta / 1000)
      const days = Math.floor(totalSeconds / 86400)
      const hours = Math.floor((totalSeconds % 86400) / 3600)
      const minutes = Math.floor((totalSeconds % 3600) / 60)
      if (days > 0) return `${days}${t('unit.day')}${hours > 0 ? `${hours}${t('unit.hour')}` : ''}`
      if (hours > 0) return `${hours}${t('unit.hour')}${minutes > 0 ? `${minutes}${t('unit.minute')}` : ''}`
      if (minutes > 0) return `${minutes}${t('unit.minute')}`
      return t('countdown.soon')
    }

    function formatClock(iso) {
      if (typeof iso !== 'string' || iso.length === 0) return null
      const value = Date.parse(iso)
      if (!Number.isFinite(value)) return null
      try {
        return new Date(value).toLocaleString()
      } catch {
        return null
      }
    }

    /** Same instant without seconds: the detail table has no room for them. */
    function formatClockShort(iso) {
      if (typeof iso !== 'string' || iso.length === 0) return null
      const value = Date.parse(iso)
      if (!Number.isFinite(value)) return null
      try {
        return new Date(value).toLocaleString(undefined, {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      } catch {
        return null
      }
    }

    function formatRate(rate, unitKey, t) {
      if (typeof rate !== 'number' || !Number.isFinite(rate)) return null
      return `${rate.toFixed(1)}${t(unitKey)}`
    }

    function forecastOf(entry) {
      const forecast = entry?.forecast ?? null
      // An older Host response may omit `reliable`; only an explicit false
      // means "not computable", so a half-reloaded page still shows numbers.
      const usable =
        forecast !== null &&
        typeof forecast.projectedPercent === 'number' &&
        forecast.reliable !== false
      return { forecast, usable }
    }

    function errorText(error, t) {
      if (error === null || error === undefined || typeof error !== 'object') return t('state.failed')
      switch (error.code) {
        case 'no-credential':
          return t('state.noCredential')
        case 'unauthorized':
          return t('state.unauthorized')
        case 'timeout':
          return t('state.timeout')
        case 'network':
          return t('state.network')
        case 'http-error':
          return typeof error.status === 'number' ? `${t('state.http')} (HTTP ${error.status})` : t('state.http')
        case 'bad-response':
          return t('state.badResponse')
        case 'internal':
          return t('state.internal')
        default:
          return t('state.failed')
      }
    }

    function useNow(intervalMs) {
      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), intervalMs)
        return () => clearInterval(timer)
      }, [intervalMs])
      return now
    }

    // --------------------------------------------------------------- icons
    function StyleTag() {
      return h('style', { 'data-ocq': 'true' }, CSS)
    }

    function RefreshIcon(props) {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          'aria-hidden': true,
          className: props?.spinning === true ? 'ocq-spin' : undefined,
        },
        h('path', { d: 'M20 12a8 8 0 1 1-2.34-5.66' }),
        h('path', { d: 'M20 4v4h-4' }),
      )
    }

    function AlertIcon() {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M12 4.5 20.5 19.5H3.5z' }),
        h('path', { d: 'M12 10v3.6' }),
        h('circle', { cx: 12, cy: 16.6, r: 0.9, fill: 'currentColor', stroke: 'none' }),
      )
    }

    /** Sidebar entry: the gauge plus a status dot carrying the tightest window. */
    function SidebarIcon(props) {
      const size =
        props !== null && typeof props === 'object' && typeof props.size === 'number' ? props.size : 16
      const state = useQuota()
      let dot = null
      const data = state.data
      if (data !== null) {
        const remaining = WINDOWS.map((window) => percentLeft(percentUsed(data.windows?.[window.id] ?? null)))
          .filter((value) => typeof value === 'number')
        if (remaining.length > 0) dot = toneFor(Math.min(...remaining))
      }
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('path', { d: 'M3.8 17.2a8.4 8.4 0 1 1 16.4 0' }),
        h('path', { d: 'M12 17.2l4.3-4.8' }),
        h('circle', { cx: 12, cy: 17.2, r: 1.35, fill: 'currentColor', stroke: 'none' }),
        dot === null ? null : h('circle', { cx: 20.2, cy: 4.6, r: 2.4, fill: dot, stroke: 'none' }),
      )
    }

    // --------------------------------------------------------------- views
    /**
     * One ring gauge. The arc length is the remaining share of the window.
     *
     * `compact` draws the same gauge at popover size: smaller stroke, no
     * caption, and smaller type in the hole. Both variants take the tone from
     * the surrounding `--ocq-tone`, so they always agree.
     */
    function QuotaRing(props) {
      const compact = props.compact === true
      const size = compact ? MINI_RING_SIZE : RING_SIZE
      const stroke = compact ? MINI_RING_STROKE : RING_STROKE
      const radius = size / 2 - stroke / 2 - (compact ? size * 0.08 : 12)
      const circumference = 2 * Math.PI * radius
      const remaining = props.remaining
      const ratio = typeof remaining === 'number' ? Math.min(100, Math.max(0, remaining)) / 100 : 0
      const dash = circumference * ratio
      return h(
        'div',
        {
          className: compact ? 'ocq-miniwrap' : 'ocq-ringwrap',
          style: compact ? { width: `${size}px`, height: `${size}px` } : undefined,
        },
        h(
          'svg',
          {
            className: 'ocq-ring',
            width: size,
            height: size,
            viewBox: `0 0 ${size} ${size}`,
            'aria-hidden': true,
          },
          h('circle', {
            className: 'ocq-ring-track',
            style: { strokeWidth: stroke },
            cx: size / 2,
            cy: size / 2,
            r: radius,
          }),
          h('circle', {
            className: 'ocq-ring-arc',
            style: { strokeWidth: stroke },
            cx: size / 2,
            cy: size / 2,
            r: radius,
            transform: `rotate(-90 ${size / 2} ${size / 2})`,
            strokeDasharray: `${dash.toFixed(2)} ${circumference.toFixed(2)}`,
          }),
        ),
        h(
          'div',
          { className: 'ocq-ring-center' },
          h(
            'div',
            { className: 'ocq-ring-line' },
            h(
              'span',
              { className: compact ? 'ocq-mini-num' : 'ocq-ring-num' },
              remaining === null ? '—' : remaining,
            ),
            remaining === null ? null : h('span', { className: compact ? 'ocq-mini-pct' : 'ocq-ring-pct' }, '%'),
          ),
          compact ? null : h('span', { className: 'ocq-ring-cap' }, props.caption),
        ),
      )
    }

    /**
     * One window: name, ring, countdown, and the projection line.
     *
     * The projection is shown for every window when the Host could compute it —
     * it is the one number that answers "will I run out before reset". All the
     * explanatory copy (used %, exact reset time, average pace, assumptions)
     * lives in the cell's `title` instead of on the page.
     */
    function WindowCell(props) {
      const t = props.t
      const window = props.window
      const entry = props.entry
      const now = props.now
      const used = percentUsed(entry)
      const remaining = percentLeft(used)
      const tone = toneFor(remaining)
      const countdown = describeCountdown(entry?.resetsAt, t, now)
      const resetAt = formatClock(entry?.resetsAt)
      const { forecast, usable } = forecastOf(entry)
      const projected = usable ? Math.round(forecast.projectedPercent) : null
      const danger = usable && forecast.willExceed === true
      const rate = usable
        ? window.id === 'rolling'
          ? formatRate(forecast.ratePerHour, 'forecast.perHour', t)
          : formatRate(forecast.ratePerDay, 'forecast.perDay', t)
        : null

      const titleParts = [`${t(window.labelKey)}: ${t('remaining')} ${remaining === null ? '—' : `${remaining}%`}`]
      if (used !== null) titleParts.push(`${t('used')} ${used}%`)
      if (countdown !== null) titleParts.push(`${t('reset')} ${countdown}`)
      if (resetAt !== null) titleParts.push(resetAt)
      if (usable) {
        titleParts.push(`${t('forecast.endsAt')} ${projected}%${danger ? ` · ${t('forecast.over')}` : ''}`)
        if (rate !== null) titleParts.push(`${t('forecast.avg')} ${rate}`)
        if (forecast.assumedSpan === true) titleParts.push(t('forecast.assumed'))
      } else if (forecast !== null) {
        titleParts.push(forecast.reason === 'unknown-span' ? t('forecast.unknownSpan') : t('forecast.insufficient'))
      }

      return h(
        'div',
        {
          className: 'ocq-cell',
          style: tone === null ? undefined : { '--ocq-tone': tone },
          title: titleParts.join(' · '),
        },
        h('span', { className: 'ocq-name' }, t(window.labelKey)),
        h(QuotaRing, { remaining, caption: t('remaining') }),
        countdown === null
          ? null
          : h('span', { className: 'ocq-reset' }, h('b', null, countdown), `${t('countdown.suffix')}`),
        projected === null
          ? null
          : h(
              'span',
              { className: danger ? 'ocq-forecast is-danger' : 'ocq-forecast' },
              t('forecast.endsAt'),
              ' ',
              h('b', null, `${projected}%`),
            ),
      )
    }

    /**
     * Detail rows under the gauges: everything the rings cannot carry is stated
     * here instead of hidden behind hover — used share, average pace, exact
     * reset time, plus the projection assumptions.
     */
    function DetailsTable(props) {
      const t = props.t
      const data = props.data
      if (data === null) return null
      const monthly = data.windows?.monthly ?? null
      const monthlyForecast = forecastOf(monthly).forecast
      const assumed = monthlyForecast !== null && monthlyForecast.assumedSpan === true

      const rows = WINDOWS.map((window) => {
        const entry = data.windows?.[window.id] ?? null
        const used = percentUsed(entry)
        const { forecast, usable } = forecastOf(entry)
        const rate = usable
          ? window.id === 'rolling'
            ? formatRate(forecast.ratePerHour, 'forecast.perHour', t)
            : formatRate(forecast.ratePerDay, 'forecast.perDay', t)
          : null
        const resetAt = formatClockShort(entry?.resetsAt)
        return h(
          'div',
          { key: window.id, className: 'ocq-detail-row' },
          h('span', { className: 'ocq-detail-name' }, t(window.labelKey)),
          h('span', { className: 'ocq-detail-num' }, used === null ? '—' : `${used}%`),
          h('span', { className: 'ocq-detail-num' }, rate === null ? '—' : rate),
          h('span', { className: 'ocq-detail-num ocq-detail-resets' }, resetAt === null ? '—' : resetAt),
        )
      })

      return h(
        'div',
        { className: 'ocq-detail' },
        h(
          'div',
          { className: 'ocq-detail-head' },
          h('span', null, t('detail.window')),
          h('span', { className: 'ocq-detail-num' }, t('used')),
          h('span', { className: 'ocq-detail-num' }, t('detail.rate')),
          h('span', { className: 'ocq-detail-num ocq-detail-resets' }, t('detail.resetsAt')),
        ),
        rows,
        h(
          'div',
          { className: 'ocq-detail-note' },
          h('div', null, t('detail.note.rate')),
          h('div', null, `${t('detail.note.scope')}${assumed ? ` · ${t('forecast.assumed')}` : ''}`),
        ),
      )
    }

    function ErrorCard(props) {
      const t = props.t
      const busy = props.busy
      return h(
        'div',
        { className: 'ocq-error', role: 'alert' },
        h(AlertIcon),
        h('span', { className: 'ocq-grow' }, props.message),
        h(
          'button',
          {
            type: 'button',
            className: 'ocq-retry',
            disabled: busy,
            onClick: () => {
              void refresh(true)
            },
          },
          t('panel.refresh'),
        ),
      )
    }

    function BadgeSwitch(props) {
      const t = props.t
      const state = useQuota()
      const enabled = state.prefs.badge === true
      return h(
        'div',
        { className: 'ocq-setting' },
        h('span', { className: 'ocq-setting-label', title: t('settings.badge.desc') }, t('settings.badge.label')),
        h('span', { className: 'ocq-grow' }),
        h('button', {
          type: 'button',
          className: 'ocq-switch',
          role: 'switch',
          'aria-checked': enabled ? 'true' : 'false',
          'aria-label': t('settings.badge.label'),
          disabled: state.prefs.saving,
          onClick: () => {
            void setBadge(!enabled)
          },
        }),
      )
    }

    /** Full quota page in the main panel. */
    function QuotaPanel(props) {
      const t = props.t
      const state = useQuota()
      const now = useNow(30_000)
      const data = state.data
      const busy = state.phase === 'loading' || state.phase === 'refreshing'
      const updated = state.updatedAt > 0 ? new Date(state.updatedAt).toLocaleTimeString() : null
      const failed = state.phase === 'error'

      const cells =
        data === null
          ? null
          : WINDOWS.map((window) =>
              h(WindowCell, {
                key: window.id,
                t,
                window,
                entry: data.windows?.[window.id] ?? null,
                now,
              }),
            )

      return h(
        'div',
        { className: 'ocq-page' },
        h(StyleTag),
        h(
          'div',
          { className: 'ocq-head' },
          h('span', { className: 'ocq-title' }, t('panel.title')),
          h('span', { className: 'ocq-updated' }, updated === null ? '' : `${t('panel.updated')} ${updated}`),
          h(
            'button',
            {
              type: 'button',
              className: 'ocq-iconbtn',
              onClick: () => {
                void refresh(true)
              },
              disabled: busy,
              title: busy ? t('panel.refreshing') : t('panel.refresh'),
              'aria-label': busy ? t('panel.refreshing') : t('panel.refresh'),
            },
            h(RefreshIcon, { spinning: busy }),
          ),
        ),
        failed && data !== null
          ? h(ErrorCard, { t, busy, message: errorText(state.error, t) })
          : null,
        data === null
          ? failed
            ? h(ErrorCard, { t, busy, message: errorText(state.error, t) })
            : h(
                'div',
                { className: 'ocq-empty' },
                state.phase === 'loading' ? t('state.loading') : t('state.unavailable'),
              )
          : h('div', { className: 'ocq-panel' }, cells),
        h(DetailsTable, { t, data }),
        h(BadgeSwitch, { t }),
        h(
          'div',
          { className: 'ocq-foot' },
          h('span', null, t('panel.source')),
          h('span', null, t('panel.autoRefresh')),
        ),
      )
    }

    /**
     * Compact badge in the composer toolbar, immediately before the model seat.
     *
     * `conversation.input.right` is the list slot rendered directly left of the
     * model selector, so the quota reads as part of "what am I sending with".
     *
     * The provider gate mirrors the composer's own model decision: the Session
     * projection (`next`, then `lastUsed`) and, for a blank Session such as the
     * start page, the Host catalog default. Reusing that fallback is what makes
     * the badge appear on the homepage as well as in a conversation.
     *
     * Hovering or focusing the badge opens a small portal card with the three
     * remaining-share rings, reset countdowns and projections; the native
     * `title` string it replaces was a single hard-to-read line. Clicking still
     * opens the quota page.
     */
    function QuotaBadge(props) {
      const t = props.t
      const openPanel = props.openPanel
      // Standard slot props: the live model selection of this session. The
      // prop is always supplied by the composer slot owner; the guard keeps the
      // component harmless if it is ever mounted outside that seat.
      const useProjection = props.useProjection
      const selection =
        typeof useProjection === 'function' ? useProjection('modelSelection') : undefined
      const hostDefault = useHostDefault()
      const current = selection?.next ?? selection?.lastUsed ?? hostDefault
      const state = useQuota()
      const now = useNow(60_000)

      const [peek, setPeek] = React.useState(false)
      const [anchor, setAnchor] = React.useState(null)
      const triggerRef = React.useRef(null)
      const cardRef = React.useRef(null)
      const openTimer = React.useRef(null)

      const cancelOpenTimer = () => {
        if (openTimer.current !== null) {
          clearTimeout(openTimer.current)
          openTimer.current = null
        }
      }
      // Hover intent: opening on the first mouseover flickers whenever the
      // pointer merely crosses the toolbar on its way to the model seat.
      const scheduleOpen = () => {
        cancelOpenTimer()
        openTimer.current = setTimeout(() => {
          openTimer.current = null
          setPeek(true)
        }, 260)
      }
      const closePeek = () => {
        cancelOpenTimer()
        setPeek(false)
        setAnchor(null)
      }

      React.useEffect(
        () => () => {
          cancelOpenTimer()
        },
        [],
      )

      React.useEffect(() => {
        if (!peek) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') closePeek()
        }
        // The card is fixed to the viewport, so any scroll or resize would
        // leave it pointing at empty space; closing is the honest response.
        const onViewportChange = () => closePeek()
        window.addEventListener('keydown', onKey)
        window.addEventListener('scroll', onViewportChange, true)
        window.addEventListener('resize', onViewportChange)
        return () => {
          window.removeEventListener('keydown', onKey)
          window.removeEventListener('scroll', onViewportChange, true)
          window.removeEventListener('resize', onViewportChange)
        }
      }, [peek])

      // Two-phase placement: the card renders hidden, measures itself, then
      // sits above the badge with right edges aligned (composer is at the
      // bottom), flipping below only when the viewport has no room above.
      React.useLayoutEffect(() => {
        if (!peek) return
        const trigger = triggerRef.current
        const card = cardRef.current
        if (trigger === null || card === null) return
        const rect = trigger.getBoundingClientRect()
        const width = card.offsetWidth
        const height = card.offsetHeight
        const margin = 8
        const gap = 8
        let top = rect.top - height - gap
        if (top < margin) top = Math.min(window.innerHeight - height - margin, rect.bottom + gap)
        let left = rect.right - width
        left = Math.max(margin, Math.min(left, window.innerWidth - width - margin))
        const next = { top: Math.round(top), left: Math.round(left) }
        setAnchor((previous) =>
          previous !== null && previous.top === next.top && previous.left === next.left ? previous : next,
        )
      }, [peek, state.data, now])

      if (current?.provider !== OPENCODE_PROVIDER) return null
      if (state.prefs.badge !== true) return null
      const data = state.data

      const renderPeek = (content) => {
        if (!peek || ReactDOM === null || typeof document === 'undefined') return null
        return ReactDOM.createPortal(
          h(
            'div',
            {
              ref: cardRef,
              className: 'ocq-pop',
              role: 'tooltip',
              style:
                anchor === null
                  ? { visibility: 'hidden', top: 0, left: 0 }
                  : { top: anchor.top, left: anchor.left },
            },
            content,
          ),
          document.body,
        )
      }

      const triggerProps = {
        ref: triggerRef,
        type: 'button',
        className: 'ocq-dockbtn',
        onClick: () => {
          // Navigation wins over the peek: leaving it open over the page view
          // would point at a control the user has already acted on.
          closePeek()
          if (typeof openPanel === 'function') openPanel()
        },
        onMouseEnter: scheduleOpen,
        onMouseLeave: closePeek,
        onFocus: () => setPeek(true),
        onBlur: closePeek,
      }

      if (data === null) {
        if (state.phase !== 'error') return null
        const message = errorText(state.error, t)
        return h(
          'div',
          { className: 'ocq-dock' },
          h(StyleTag),
          h(
            'button',
            { ...triggerProps, 'aria-label': message },
            h('span', { className: 'ocq-seg' }, h('i'), t('state.unavailable')),
          ),
          renderPeek(
            h(
              'div',
              null,
              h('div', { className: 'ocq-pop-error' }, message),
              h('div', { className: 'ocq-pop-foot' }, t('popover.hint')),
            ),
          ),
        )
      }

      const summary = []
      const segments = WINDOWS.map((window) => {
        const entry = data.windows?.[window.id] ?? null
        const used = percentUsed(entry)
        const remaining = percentLeft(used)
        if (remaining !== null) summary.push(`${t(window.labelKey)} ${t('remaining')} ${remaining}%`)
        return h(
          'span',
          {
            key: window.id,
            className: 'ocq-seg',
            style: remaining === null ? undefined : { '--ocq-tone': toneFor(remaining) },
          },
          h('i'),
          `${t(window.shortKey)} `,
          h('b', null, remaining === null ? '—' : `${remaining}%`),
        )
      })

      // The peek card answers "how much is left where" without duplicating the
      // page's detail table: three rings, a countdown, and the projection.
      const cells = WINDOWS.map((window) => {
        const entry = data.windows?.[window.id] ?? null
        const used = percentUsed(entry)
        const remaining = percentLeft(used)
        const countdown = describeCountdown(entry?.resetsAt, t, now)
        const { forecast, usable } = forecastOf(entry)
        const projected = usable ? Math.round(forecast.projectedPercent) : null
        const danger = usable && forecast.willExceed === true
        return h(
          'div',
          {
            key: window.id,
            className: 'ocq-pop-cell',
            style: remaining === null ? undefined : { '--ocq-tone': toneFor(remaining) },
          },
          h(QuotaRing, { remaining, compact: true }),
          h('span', { className: 'ocq-pop-name' }, t(window.shortKey)),
          h('span', { className: 'ocq-pop-reset' }, countdown === null ? '—' : countdown),
          projected === null
            ? null
            : h(
                'span',
                { className: danger ? 'ocq-pop-proj is-danger' : 'ocq-pop-proj' },
                `${t('popover.forecast')} ${projected}%`,
              ),
        )
      })

      const label = summary.length > 0 ? `${summary.join('，')}。${t('popover.hint')}` : t('panel.title')

      return h(
        'div',
        { className: 'ocq-dock' },
        h(StyleTag),
        h('button', { ...triggerProps, 'aria-label': label }, segments),
        renderPeek(
          h(
            'div',
            null,
            h('div', { className: 'ocq-pop-grid' }, cells),
            h('div', { className: 'ocq-pop-foot' }, t('popover.hint')),
          ),
        ),
      )
    }

    // --------------------------------------------------------------- apply
    function apply(ctx) {
      // `locale` is a declared dependency of this module (see the returned
      // `inject`), so the service is published and active before this body
      // runs. Never read it with `ctx.get('locale')`: that un-gated read races
      // the locale plugin's async native-bridge bootstrap and yields undefined.
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'opencode-quota: locale dictionaries')
      const t = ctx.locale.bind(NS)

      const openPanel = () => {
        const layout = ctx.get('layout')
        if (layout !== undefined && typeof layout.selectPanel === 'function') {
          try {
            layout.selectPanel(PANEL_ID)
          } catch {
            // Selecting a missing main entry throws; the sidebar entry still works.
          }
        }
      }

      ctx.effect(() => {
        void refresh(false)
        void refreshPrefs()
        const timer = setInterval(() => {
          void refresh(false)
        }, REFRESH_INTERVAL_MS)
        return () => clearInterval(timer)
      }, 'opencode-quota: poller')

      // The badge falls back to the deployment's default model on a blank
      // Session, exactly like the composer's model seat does. That value lives
      // in the Host catalog, so read it once per Host generation through the
      // `session.modelCatalog` Remote instead of guessing it here.
      ctx.effect(
        () => {
          // Older clients may not expose `inject`; the badge then keeps its
          // projection-only behaviour instead of failing the whole half.
          if (typeof ctx.inject !== 'function') return undefined
          return ctx.inject(['remote', 'remote.session'], (scope) => {
            let active = true
            const load = () => {
              let pending
              try {
                pending = scope.remote?.session?.modelCatalog?.()
              } catch {
                return
              }
              if (pending === undefined || typeof pending.then !== 'function') return
              pending
                .then((response) => {
                  if (!active) return
                  const selection = response?.ok === true ? response.value?.default : null
                  publishHostDefault(
                    selection !== null &&
                      typeof selection === 'object' &&
                      typeof selection.provider === 'string'
                      ? { provider: selection.provider, model: selection.model }
                      : null,
                  )
                })
                .catch(() => {
                  // An unavailable catalog leaves the badge's old behaviour.
                })
            }
            load()
            const offReset = typeof scope.on === 'function' ? scope.on('connection/reset', load) : undefined
            return () => {
              active = false
              if (typeof offReset === 'function') offReset()
            }
          })
        },
        'opencode-quota: host default model',
      )

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL_ID, order: 21, label: () => t('entry.label'), locale: NS },
          SidebarIcon,
        ),
      )

      // The `locale: NS` registration option is what feeds each component's
      // `t` prop through the framework's locale seat (re-rendered on locale
      // switches and late dictionary registration). Do not also inject `t`
      // here: the business share shadows the seat.
      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, QuotaPanel),
      )

      // `conversation.input.right` sits immediately before the model selector in
      // the composer toolbar; the badge is rendered there, not above the card.
      ctx.slots.inject('conversation.input.right', () =>
        ctx.slots.register(
          { name: 'conversation.input.right', id: PANEL_ID, order: 30, locale: NS, inject: () => ({ openPanel }) },
          QuotaBadge,
        ),
      )
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
