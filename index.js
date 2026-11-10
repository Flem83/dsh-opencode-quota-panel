/**
 * OpenCode Go quota — Host half.
 *
 * Resolves the OpenCode Go API key through the DSH credential service (the same
 * `OPENCODE_GO_API_KEY` reference the `opencode-go` model provider uses), queries
 * the subscription usage endpoint, caches the answer briefly, derives a usage
 * forecast from the observed pace, and serves both to the Web UI on same-origin
 * read-only routes. The key never leaves this process and is never written to a
 * log or to a response body.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'
// The `/v2` segment replaced `/opencode-quota/usage` after an earlier release
// whose route could not be disposed (it registered outside `ctx.effect`).
const DEFAULT_ENDPOINT = '/opencode-quota/v2/usage'
const DEFAULT_PREFS_ENDPOINT = '/opencode-quota/v2/prefs'
const DEFAULT_CREDENTIAL_REF = 'OPENCODE_GO_API_KEY'
const DEFAULT_CACHE_TTL_MS = 60_000
const REQUEST_TIMEOUT_MS = 8_000
const MAX_BODY_BYTES = 4 * 1024
const WINDOW_IDS = ['rolling', 'weekly', 'monthly']

/** Window lengths used by the forecast. The monthly billing cycle is assumed. */
const WINDOW_SPANS = {
  rolling: 5 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
}
const WINDOW_SPAN_KNOWN = { rolling: true, weekly: true, monthly: false }

/** Hard dependency: without the Web carrier there is nothing to serve to the page. */
export const inject = ['webServer']

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

function clampPercent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(100, Math.max(0, value))
}

function normalizeWindow(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const percent = clampPercent(raw.percent)
  if (percent === null) return null
  return {
    percent,
    resetsAt: typeof raw.resetsAt === 'string' && raw.resetsAt.length > 0 ? raw.resetsAt : null,
    status: typeof raw.status === 'string' ? raw.status : null,
  }
}

// ---------------------------------------------------------------- settings
// A single owner for this plugin's own preferences; kept out of the profile
// patch so toggling the badge never rewrites the user's composition.
function settingsPath() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.length > 0
    ? process.env.DSH_HOME
    : path.join(os.homedir(), '.dsh')
  return path.join(home, 'opencode-quota', 'settings.json')
}

async function readPrefs() {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8')
    const parsed = JSON.parse(raw)
    return { badge: parsed?.badge !== false }
  } catch {
    return { badge: true }
  }
}

async function writePrefs(next) {
  const file = settingsPath()
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify({ ...next }, null, 2)}\n`, 'utf8')
}

// --------------------------------------------------------------- upstream
/**
 * Resolve the API key at each operation, never from a cached copy: the credential
 * service resolves per call so a rotated key reaches the next request.
 */
async function resolveCredential(ctx, ref) {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined && typeof credentials.resolve === 'function') {
    try {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined && hit !== null && typeof hit.value === 'string' && hit.value.length > 0) {
        return { value: hit.value, source: typeof hit.source === 'string' ? hit.source : 'credentials' }
      }
    } catch {
      // Fall through to the ambient environment below.
    }
  }
  const ambient = typeof process === 'undefined' ? undefined : process.env?.[ref]
  if (typeof ambient === 'string' && ambient.length > 0) return { value: ambient, source: 'env' }
  return null
}

async function requestUsage(key) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(USAGE_URL, {
      method: 'GET',
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) {
      const unauthorized = response.status === 401 || response.status === 403
      return { ok: false, code: unauthorized ? 'unauthorized' : 'http-error', status: response.status }
    }
    let payload
    try {
      payload = await response.json()
    } catch {
      return { ok: false, code: 'bad-response' }
    }
    const usage = payload?.usage
    if (usage === null || typeof usage !== 'object') return { ok: false, code: 'bad-response' }
    const windows = {}
    let recognized = 0
    for (const id of WINDOW_IDS) {
      const window = normalizeWindow(usage[id])
      windows[id] = window
      if (window !== null) recognized += 1
    }
    if (recognized === 0) return { ok: false, code: 'bad-response' }
    return { ok: true, windows }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return { ok: false, code: 'timeout' }
    return { ok: false, code: 'network' }
  } finally {
    clearTimeout(timer)
  }
}

// --------------------------------------------------------------- forecast
/**
 * Forecast from the whole-window average, deliberately NOT from a short-term
 * rate. Agent usage arrives in bursts: a heavy hour says nothing about the rest
 * of a multi-day window, and extrapolating it produced absurd "exhausted in one
 * day" claims. Percent used over time elapsed since the window opened is the
 * stable quantity, so the projection is `used + averagePace * timeLeft`.
 *
 * A window that just opened has almost no elapsed time, which makes any average
 * meaningless, so the forecast stays unavailable until the window has run for
 * both an absolute and a relative minimum.
 */
const MIN_ELAPSED_MS = 60_000
const MIN_ELAPSED_FRACTION = 0.02

function forecastWindow(id, window, now) {
  if (window === null) return null
  const resetsAtMs = window.resetsAt === null ? null : Date.parse(window.resetsAt)
  const assumedSpan = WINDOW_SPAN_KNOWN[id] !== true
  const span = WINDOW_SPANS[id]
  // The true remaining time, deliberately NOT clamped to the assumed span: a
  // cycle that is longer than the assumption must be reported as unknown
  // rather than as a cycle that has not started.
  const remainingMs =
    resetsAtMs === null || !Number.isFinite(resetsAtMs) ? null : Math.max(0, resetsAtMs - now)

  const unavailable = (reason) => ({
    ratePerHour: null,
    ratePerDay: null,
    projectedPercent: null,
    willExceed: false,
    elapsedMs: null,
    remainingMs,
    assumedSpan,
    reliable: false,
    reason,
  })

  if (remainingMs === null) return unavailable('no-reset')
  const elapsedMs = span - remainingMs
  if (elapsedMs <= 0) return unavailable('unknown-span')
  if (elapsedMs < Math.max(MIN_ELAPSED_MS, span * MIN_ELAPSED_FRACTION)) return unavailable('just-started')

  const ratePerHour = window.percent / (elapsedMs / 3_600_000)
  const projectedPercent = window.percent + ratePerHour * (remainingMs / 3_600_000)
  return {
    ratePerHour,
    ratePerDay: ratePerHour * 24,
    projectedPercent,
    willExceed: projectedPercent > 100,
    elapsedMs,
    remainingMs,
    assumedSpan,
    reliable: true,
    reason: null,
  }
}

// ------------------------------------------------------------------ routes
function readJsonBody(request) {
  return new Promise((resolve) => {
    const chunks = []
    let bytes = 0
    request.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buffer.length
      if (bytes > MAX_BODY_BYTES) {
        chunks.length = 0
        return
      }
      chunks.push(buffer)
    })
    request.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null)
      } catch {
        resolve(null)
      }
    })
    request.on('error', () => resolve(null))
  })
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ credentialRef?: string, endpoint?: string, prefsEndpoint?: string, cacheTtlMs?: number } | undefined} config
 */
export function apply(ctx, config) {
  const credentialRef =
    typeof config?.credentialRef === 'string' && config.credentialRef.length > 0
      ? config.credentialRef
      : DEFAULT_CREDENTIAL_REF
  const endpoint =
    typeof config?.endpoint === 'string' && config.endpoint.startsWith('/')
      ? config.endpoint
      : DEFAULT_ENDPOINT
  const prefsEndpoint =
    typeof config?.prefsEndpoint === 'string' && config.prefsEndpoint.startsWith('/')
      ? config.prefsEndpoint
      : DEFAULT_PREFS_ENDPOINT
  const cacheTtlMs =
    typeof config?.cacheTtlMs === 'number' && Number.isFinite(config.cacheTtlMs) && config.cacheTtlMs >= 0
      ? config.cacheTtlMs
      : DEFAULT_CACHE_TTL_MS

  let cache = null
  let inflight = null

  async function load(force) {
    if (!force && cache !== null && Date.now() - cache.at < cacheTtlMs) return cache.body
    if (inflight !== null) return inflight
    inflight = (async () => {
      const credential = await resolveCredential(ctx, credentialRef)
      if (credential === null) {
        return { ok: false, code: 'no-credential', credentialRef, fetchedAt: new Date().toISOString() }
      }
      const result = await requestUsage(credential.value)
      const now = Date.now()
      const fetchedAt = new Date(now).toISOString()
      if (!result.ok) {
        return { ok: false, code: result.code, status: result.status ?? null, fetchedAt }
      }
      const windows = {}
      for (const id of WINDOW_IDS) {
        const window = result.windows[id]
        windows[id] = window === null ? null : { ...window, forecast: forecastWindow(id, window, now) }
      }
      const body = { ok: true, fetchedAt, source: credential.source, windows }
      cache = { at: now, body }
      return body
    })().finally(() => {
      inflight = null
    })
    return inflight
  }

  // Routes are registered through `ctx.effect`, not through `apply`'s return
  // value: the Loader does not collect a returned disposer, so only an effect
  // guarantees the route is removed when this plugin is reloaded or unloaded.
  ctx.effect(
    () => {
      const dispose = ctx.webServer.register({
        kind: 'exact',
        path: endpoint,
        handler: async (request, response) => {
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.writeHead(405, { allow: 'GET, HEAD' })
            response.end()
            return
          }
          const url = new URL(request.url ?? endpoint, 'http://localhost')
          const force = url.searchParams.get('refresh') === '1'
          try {
            sendJson(response, 200, await load(force))
          } catch {
            sendJson(response, 500, { ok: false, code: 'internal', fetchedAt: new Date().toISOString() })
          }
        },
      })
      return () => {
        try {
          dispose()
        } catch {
          // The carrier may already be gone during shutdown.
        }
      }
    },
    'opencode-quota: usage route',
  )

  ctx.effect(
    () => {
      const dispose = ctx.webServer.register({
        kind: 'exact',
        path: prefsEndpoint,
        handler: async (request, response) => {
          if (request.method === 'GET' || request.method === 'HEAD') {
            sendJson(response, 200, { ok: true, prefs: await readPrefs() })
            return
          }
          if (request.method === 'POST') {
            const body = await readJsonBody(request)
            if (body === null || typeof body.badge !== 'boolean') {
              sendJson(response, 400, { ok: false, code: 'bad-request' })
              return
            }
            const prefs = { badge: body.badge }
            try {
              await writePrefs(prefs)
              sendJson(response, 200, { ok: true, prefs })
            } catch {
              sendJson(response, 500, { ok: false, code: 'write-failed' })
            }
            return
          }
          response.writeHead(405, { allow: 'GET, HEAD, POST' })
          response.end()
        },
      })
      return () => {
        try {
          dispose()
        } catch {
          // The carrier may already be gone during shutdown.
        }
      }
    },
    'opencode-quota: prefs route',
  )
}
