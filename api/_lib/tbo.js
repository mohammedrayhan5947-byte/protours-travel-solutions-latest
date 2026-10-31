import crypto from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import fs from 'node:fs'
import path from 'node:path'

/**
 * TBO (Tek Travels) Air API client — server only.
 *
 * Rules from TBO's integration guide that shape this file:
 *  - Authenticate with ClientId "ApiIntegrationNew"; the same TokenId must be
 *    used for every call of one booking (certification checks this).
 *  - The TraceId from Search is valid for 15 minutes and must be reused for
 *    FareRule → FareQuote → SSR → Book → Ticket of that booking.
 *  - Requests ask for gzip; non-gzip responses must not be decompressed
 *    (fetch handles both transparently).
 *  - Request/response logs are kept as JSON, because TBO wants them as
 *    attachments for sample verification and certification.
 */

const ENV = (process.env.TBO_ENV || 'staging').toLowerCase()
export const IS_LIVE = ENV === 'live'

// Static-IP relay. TBO only accepts live calls from a whitelisted IP and Vercel's IPs change,
// so when TBO_RELAY_URL is set (e.g. https://api.protoursandtravelsolutions.com/tbo) every
// TBO call goes through the gateway on the static IP. The gateway decides staging vs live
// (its TBO_*_UPSTREAM settings); TBO_ENV here still drives the site's own live/staging rules.
const RELAY = (process.env.TBO_RELAY_URL || '').replace(/\/+$/, '')
const RELAY_TOKEN = process.env.TBO_RELAY_TOKEN || ''
if (RELAY && !RELAY_TOKEN) console.error('[tbo] TBO_RELAY_URL is set but TBO_RELAY_TOKEN is not: the gateway will refuse every call')

// TBO's docs publish staging hosts only; live hosts arrive with the live
// credentials after certification, so they must come from env (TBO_LIVE_*).
const URLS = RELAY
  ? { auth: `${RELAY}/shared`, air: `${RELAY}/air`, booking: `${RELAY}/airbook` }
  : IS_LIVE
    ? {
        auth: process.env.TBO_LIVE_AUTH_URL,
        air: process.env.TBO_LIVE_AIR_URL,
        booking: process.env.TBO_LIVE_BOOK_URL || process.env.TBO_LIVE_AIR_URL,
      }
    : {
        auth: 'https://Sharedapi.tektravels.com/SharedData.svc/rest',
        air: 'https://api.tektravels.com/BookingEngineService_Air/AirService.svc/rest',
        booking: process.env.TBO_STAGING_BOOK_URL || 'https://api.tektravels.com/BookingEngineService_Air/AirService.svc/rest',
      }
if (IS_LIVE && !RELAY && (!URLS.auth || !URLS.air)) console.error('[tbo] TBO_ENV=live but TBO_LIVE_AUTH_URL / TBO_LIVE_AIR_URL are not set')

// Booking-side methods go to the booking host on live; search-side to the air host.
const BOOKING_METHODS = new Set(['Book', 'Ticket', 'GetBookingDetails', 'SendChangeRequest', 'GetChangeRequestStatus', 'GetCancellationCharges', 'ReleasePNRRequest'])

export const END_USER_IP = process.env.TBO_END_USER_IP || '192.168.10.10'

const LOG_MODE = process.env.TBO_LOG_SEARCH || 'summary' // full | summary
const LOG_DIR = process.env.VERCEL ? null : path.resolve(process.cwd(), '.data', 'tbo-logs')

/* The customer's IP, for the gateway's call log only. api/flights.js wraps each request in withEndUserIp();
   post() then adds an X-End-User-IP header, but only on calls that go through the relay (TBO itself never gets it). */
const callerCtx = new AsyncLocalStorage()
export const withEndUserIp = (ip, fn) => callerCtx.run({ ip: String(ip || '').slice(0, 64) }, fn)

export class TboError extends Error {
  constructor(message, { code, method, status } = {}) {
    super(message)
    this.code = code
    this.method = method
    this.status = status
  }
}

/* ---------- logging ---------- */

let seq = 0
/** Copies every request/response to Supabase (tbo_logs) when SUPABASE_URL + SUPABASE_SERVICE_KEY are set. */
function toSupabase(method, traceId, kind, body) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return
  fetch(`${url}/rest/v1/tbo_logs`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ env: ENV, trace_id: traceId || null, method, kind, body }),
  }).catch(() => {})
}

function log(method, traceId, kind, body) {
  const safe = redact(body)
  toSupabase(method, traceId, kind, safe)
  if (!LOG_DIR) {
    // Vercel: keep logs short — full payloads only for booking-side calls.
    if (kind === 'response' && method !== 'Search') console.log(`[tbo] ${method} ${traceId || ''} ${JSON.stringify(safe).slice(0, 2000)}`)
    return
  }
  try {
    const dir = path.join(LOG_DIR, traceId || 'no-trace')
    fs.mkdirSync(dir, { recursive: true })
    const big = method === 'Search' && kind === 'response' && LOG_MODE !== 'full'
    const data = big ? { note: 'Search response trimmed; set TBO_LOG_SEARCH=full for the whole payload', ResponseStatus: body?.Response?.ResponseStatus, TraceId: body?.Response?.TraceId, Error: body?.Response?.Error, resultCount: (body?.Response?.Results || []).map((r) => r.length) } : safe
    const n = String(++seq).padStart(3, '0')
    fs.writeFileSync(path.join(dir, `${Date.now()}-${n}-${method}-${kind}.json`), JSON.stringify(data, null, 2))
  } catch {
    /* logging must never break a booking */
  }
}

function redact(body) {
  if (!body || typeof body !== 'object') return body
  if (!('Password' in body)) return body
  return { ...body, Password: '***' }
}

/* ---------- transport ---------- */

async function post(url, method, body, traceId, timeoutMs = 60000) {
  if (!url) throw new TboError('Flight booking is not configured for this environment.', { method, status: 503 })
  // Search / GetCalendarFare get their TraceId only in the response: log the request after.
  const late = !traceId && method !== 'Authenticate'
  if (!late) log(method, traceId, 'request', body)
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  let res, text
  try {
    res = await fetch(`${url}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        // the gateway's own token (TBO ignores it). The gateway answers its own errors as plain text,
        // which fails JSON.parse below, so a relay problem can never look like a TBO success.
        ...(RELAY && RELAY_TOKEN && url.startsWith(RELAY) ? { Authorization: `Bearer ${RELAY_TOKEN}` } : {}),
        ...(RELAY && url.startsWith(RELAY) && callerCtx.getStore()?.ip ? { 'X-End-User-IP': callerCtx.getStore().ip } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    text = await res.text()
  } catch (e) {
    throw new TboError(e.name === 'AbortError' ? `${method} timed out` : `${method} could not reach TBO`, { method, status: 504 })
  } finally {
    clearTimeout(t)
  }
  let json
  try {
    json = JSON.parse(text)
  } catch {
    log(method, traceId, 'response', { raw: text.slice(0, 4000) })
    throw new TboError(`${method}: unexpected reply from TBO (${res.status})`, { method, status: 502 })
  }
  const tid = traceId || json?.Response?.TraceId
  if (late) log(method, tid, 'request', body)
  log(method, tid, 'response', json)
  return json
}

/* ---------- authentication ---------- */

let cached = null // { tokenId, agencyId, day }

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

export async function authenticate({ force = false } = {}) {
  if (!force && cached && cached.day === today()) return cached
  const { TBO_USERNAME, TBO_PASSWORD } = process.env
  if (!TBO_USERNAME || !TBO_PASSWORD) throw new TboError('Flight booking is not configured (TBO login missing).', { status: 503 })
  const json = await post(URLS.auth, 'Authenticate', {
    ClientId: 'ApiIntegrationNew',
    UserName: TBO_USERNAME,
    Password: TBO_PASSWORD,
    EndUserIp: END_USER_IP,
  })
  if (json.Status !== 1 || !json.TokenId) {
    throw new TboError(json?.Error?.ErrorMessage || 'TBO login failed', { method: 'Authenticate', code: json?.Error?.ErrorCode, status: 502 })
  }
  cached = { tokenId: json.TokenId, agencyId: json.Member?.AgencyId, memberId: json.Member?.MemberId, day: today() }
  return cached
}

/**
 * Calls an Air method and unwraps `Response`, throwing on TBO errors.
 * `session` carries the TokenId (+ TraceId) for the whole booking.
 */
export async function air(method, session, body = {}, { allowError = false } = {}) {
  const url = BOOKING_METHODS.has(method) ? URLS.booking : URLS.air
  const req = { EndUserIp: END_USER_IP, TokenId: session.tokenId, ...(session.traceId ? { TraceId: session.traceId } : {}), ...body }
  // TBO guide: 300 s for Book/Ticket, 60 s for everything else.
  const timeout = method === 'Book' || method === 'Ticket' ? 300000 : method === 'Search' || method === 'PriceRBD' || method === 'GetCalendarFare' ? 120000 : 60000
  const json = await post(url, method, req, session.traceId || body.TraceId, timeout)
  const r = json.Response ?? json
  const err = r?.Error
  if (!allowError && err && err.ErrorCode && err.ErrorCode !== 0) {
    throw new TboError(err.ErrorMessage || `${method} failed`, { method, code: err.ErrorCode, status: 422 })
  }
  return r
}

export async function shared(method, body) {
  const s = await authenticate()
  return post(URLS.auth, method, { EndUserIp: END_USER_IP, TokenId: s.tokenId, ...body })
}

/* ---------- sealed session (TokenId never reaches the browser in clear) ---------- */

function key() {
  const secret = process.env.SIGNING_SECRET || process.env.CRON_SECRET || process.env.TBO_PASSWORD || ''
  if (!secret) throw new TboError('Signing secret missing', { status: 503 })
  return crypto.createHash('sha256').update('protours-tbo:' + secret).digest()
}

export function seal(obj, ttlMs = 15 * 60 * 1000) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([c.update(JSON.stringify({ ...obj, exp: Date.now() + ttlMs }), 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64url')
}

export function unseal(token, what = 'session') {
  try {
    const buf = Buffer.from(String(token), 'base64url')
    const d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12))
    d.setAuthTag(buf.subarray(12, 28))
    const obj = JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'))
    if (obj.exp < Date.now()) throw new Error('expired')
    return obj
  } catch (e) {
    throw new TboError(
      e.message === 'expired' ? `Your ${what} expired (TBO allows 15 minutes). Please search again.` : `Invalid ${what}. Please search again.`,
      { status: 410 },
    )
  }
}

export const markupPercent = () => Math.max(0, Number(process.env.FLIGHT_MARKUP_PERCENT) || 0)

/** What the customer pays for a fare: TBO PublishedFare + our markup, rounded up to the rupee. */
export const customerPrice = (published) => Math.ceil(Number(published) * (1 + markupPercent() / 100))

export const fakePaymentsAllowed = () => !IS_LIVE && String(process.env.ALLOW_FAKE_PAYMENTS).toLowerCase() === 'true'
