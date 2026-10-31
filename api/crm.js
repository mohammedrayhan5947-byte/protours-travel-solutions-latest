import { db, rpc, dbConfigured, DbError, clean } from './_lib/db.js'
import { requireStaff, signIn, refresh, AuthError } from './_lib/auth.js'

/**
 * Back office (CRM) API: flight bookings, website enquiries, the TBO call logs and the TBO wallet.
 * One endpoint: GET /api/crm?action=...  or  POST /api/crm {action, ...}.
 *
 * Access: staff sign in with their Supabase account (action=login). Every other action needs that
 * token AND the e-mail must be on CRM_ALLOWED_EMAILS (see api/_lib/auth.js).
 *
 * Cost on the free tiers: each action is ONE database round trip (single queries or the functions in
 * supabase/schema.sql), responses carry only what the screen shows, and the TBO client is loaded
 * only for the two actions that talk to TBO, so ordinary calls start fast.
 */
const BOOKING_STATUS = ['payment_pending', 'paid', 'ticketed', 'needs_attention', 'failed', 'cancelled', 'refunded']
const ENQUIRY_STATUS = ['new', 'contacted', 'quoted', 'won', 'lost']
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TRACE = /^[A-Za-z0-9-]{1,64}$/
const istDay = (t) => new Date(new Date(t).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10)
const bad = (m, s = 400) => Object.assign(new Error(m), { status: s })
const isLive = () => String(process.env.TBO_ENV).toLowerCase() === 'live'
const tbo = () => import('./_lib/tbo.js')

const BOOKING_LIST = 'id,created_at,updated_at,order_ref,env,status,amount_inr,customer_name,contact_phone,contact_email,route,journey,travel_date,return_date,pax_count,pnr,booking_ids,assigned_to'

/** One JSON line per sensitive action in the Vercel logs: who did what (never passwords or tokens). */
const audit = (who, action, extra = {}) => console.log(JSON.stringify({ audit: action, by: who, ...extra }))

/* ---------------- login (public) ---------------- */

// In-memory, per server instance: a speed bump, not the only defence (Supabase Auth rate-limits sign-ins too).
const fails = new Map()
async function login(_q, body, req) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown'
  const email = String(body.email || '').trim().toLowerCase().slice(0, 120)
  const keys = [`ip:${ip}`, `em:${email}`]
  const recent = (k) => (fails.get(k) || []).filter((t) => Date.now() - t < 10 * 60_000)
  if (keys.some((k) => recent(k).length >= 8)) throw new AuthError('Too many attempts. Please wait ten minutes.', 429)
  try {
    const out = await signIn(email, String(body.password || ''))
    audit(out.email, 'login')
    return out
  } catch (e) {
    for (const k of keys) fails.set(k, [...recent(k), Date.now()])
    if (fails.size > 2000) fails.clear()
    audit(email || '?', 'login_failed', { ip })
    await new Promise((r) => setTimeout(r, 700)) // slows password guessing
    throw e
  }
}

/* ---------------- filters ---------------- */

function filters(q, kind) {
  const f = []
  const statuses = kind === 'booking' ? BOOKING_STATUS : ENQUIRY_STATUS
  if (q.status && statuses.includes(q.status)) f.push(`status=eq.${q.status}`)
  const s = clean(q.q)
  if (s) {
    const cols = kind === 'booking' ? ['order_ref', 'pnr', 'booking_ids', 'contact_phone', 'contact_email', 'customer_name', 'route'] : ['name', 'phone', 'email', 'message', 'topic']
    f.push(`or=(${cols.map((c) => `${c}.ilike.*${encodeURIComponent(s)}*`).join(',')})`)
  }
  if (DATE.test(q.from || '')) f.push(`created_at=gte.${q.from}T00:00:00%2B05:30`)
  if (DATE.test(q.to || '')) f.push(`created_at=lte.${q.to}T23:59:59%2B05:30`)
  return f
}

/** One query for a page of rows plus the total (Prefer: count=exact rides along in the same call). */
async function page(table, select, q, kind) {
  const size = Math.min(100, Math.max(1, Number(q.size) || 25))
  const pg = Math.max(1, Number(q.page) || 1)
  const { rows, count } = await db(`${table}?select=${select}&${filters(q, kind).join('&')}&order=created_at.desc&limit=${size}&offset=${(pg - 1) * size}`, { prefer: 'count=exact' })
  return { rows: rows || [], total: count ?? (rows || []).length, page: pg, size }
}

/* ---------------- dashboard, bookings, enquiries ---------------- */

async function overview() {
  const o = await rpc('crm_overview') // every number aggregated inside the database: 1 trip, a few KB back
  return {
    env: isLive() ? 'live' : 'staging',
    payments: process.env.RAZORPAY_KEY_ID ? 'razorpay' : !isLive() && String(process.env.ALLOW_FAKE_PAYMENTS).toLowerCase() === 'true' ? 'test mode (no real payment)' : 'off',
    markupPercent: Math.max(0, Number(process.env.FLIGHT_MARKUP_PERCENT) || 0),
    ...o,
  }
}

const bookings = (q) => page('flight_bookings', BOOKING_LIST, q, 'booking')
const enquiries = (q) => page('enquiries', '*', q, 'enquiry')

async function booking(q) {
  const id = Number(q.id)
  if (!Number.isInteger(id) || id <= 0) throw bad('Bad booking id')
  const r = await rpc('crm_booking_detail', { p_id: id }) // row + timeline + TBO call list in one trip
  if (!r) throw bad('Booking not found', 404)
  return r
}

async function enquiry(q) {
  const id = Number(q.id)
  if (!Number.isInteger(id) || id <= 0) throw bad('Bad enquiry id')
  const [row, ev] = await Promise.all([db(`enquiries?id=eq.${id}&select=*`), db(`crm_events?entity=eq.enquiry&entity_id=eq.${id}&order=created_at.asc&limit=200`)])
  if (!row.rows?.[0]) throw bad('Enquiry not found', 404)
  return { enquiry: row.rows[0], events: ev.rows || [] }
}

/** Status / assignee / note for a booking or an enquiry: the change and its timeline entries in one transaction. */
async function update(entity, statuses, body, staff) {
  const id = Number(body.id)
  if (!Number.isInteger(id) || id <= 0) throw bad('Bad id')
  let status = null
  if (body.status !== undefined && body.status !== null) {
    if (!statuses.includes(body.status)) throw bad('Unknown status')
    status = body.status
  }
  const setAssigned = body.assigned_to !== undefined
  const note = String(body.note || '').trim().slice(0, 2000)
  const out = await rpc('crm_apply_update', {
    p_entity: entity, p_id: id, p_status: status,
    p_assigned: setAssigned ? clean(body.assigned_to, 60) || null : null, p_set_assigned: setAssigned,
    p_note: note || null, p_actor: staff.email,
  })
  if (!out?.found) throw bad('Not found', 404)
  audit(staff.email, `${entity}.update`, { id, status: status || undefined, note: Boolean(note) || undefined })
  return { ok: true }
}

/** The Privacy Policy promises enquiries that did not become a booking are deleted within 12 months. */
async function purge(_q, body, _req, staff) {
  if (body.confirm !== true) throw bad('Confirm the clean-up first.')
  const months = Math.min(60, Math.max(3, Number(body.months) || 12))
  const out = await rpc('crm_cleanup', { p_log_days: null, p_enq_months: months })
  audit(staff.email, 'purge_enquiries', { months, deleted: out.enquiriesDeleted })
  return { deleted: out.enquiriesDeleted, months }
}

/* ---------------- TBO logs + live lookups ---------------- */

const traces = () => rpc('crm_traces', { p_limit: 60, p_days: 60 }) // grouped in the database: 60 rows back, not 1,500

async function trace(q) {
  if (!TRACE.test(q.id || '')) throw bad('Bad trace id')
  return (await db(`tbo_logs?trace_id=eq.${q.id}&select=id,created_at,method,kind,body&order=created_at.asc&limit=300`)).rows || []
}

async function balance(_q, _b, _r, staff) {
  const { authenticate, shared, flushLogs, TboError } = await tbo()
  const a = await authenticate()
  const r = await shared('GetAgencyBalance', { ClientId: 'ApiIntegrationNew', TokenAgencyId: a.agencyId, TokenMemberId: a.memberId })
  await flushLogs()
  audit(staff.email, 'wallet_check')
  if (r.Status !== 1) throw new TboError(r.Error?.ErrorMessage || 'Balance not available', { status: 502 })
  return { cash: r.CashBalance, credit: r.CreditBalance, agencyType: r.AgencyType === 2 ? 'Credit' : 'Cash' }
}

/** What TBO itself says about a booking right now (ticket numbers, status). */
async function live(q, _b, _r, staff) {
  const bookingId = Number(q.id)
  if (!Number.isInteger(bookingId) || bookingId <= 0) throw bad('Bad booking id')
  const { authenticate, air, flushLogs } = await tbo()
  const a = await authenticate()
  const r = await air('GetBookingDetails', { tokenId: a.tokenId }, { BookingId: bookingId }, { allowError: true })
  await flushLogs()
  audit(staff.email, 'tbo_live_lookup', { bookingId })
  return r
}

/* ---------------- CSV export ---------------- */

// A cell that starts with = + - @ would run as a formula when the file is opened in Excel; enquiry text
// comes from the public, so neutralise it.
const cell = (v) => {
  let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function exportCsv(q, _b, _r, staff) {
  const kind = q.entity === 'enquiries' ? 'enquiry' : 'booking'
  const table = kind === 'enquiry' ? 'enquiries' : 'flight_bookings'
  const select = kind === 'enquiry' ? '*' : BOOKING_LIST
  const { rows } = await db(`${table}?select=${select}&${filters(q, kind).join('&')}&order=created_at.desc&limit=5000`)
  const list = rows || []
  const cols = list.length ? Object.keys(list[0]) : []
  const csv = [cols.join(','), ...list.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n')
  audit(staff.email, 'export', { table, rows: list.length })
  return { csv, filename: `${table}-${istDay(Date.now())}.csv` }
}

/* ---------------- routing ---------------- */

const PUBLIC = { login, refresh: (_q, body) => refresh(String(body.refreshToken || '')) }
const READ = {
  me: (_q, _b, _r, staff) => ({ email: staff.email, env: isLive() ? 'live' : 'staging' }),
  overview, bookings, booking, enquiries, enquiry, traces, trace, balance, live, export: exportCsv,
}
const WRITE = {
  bookingUpdate: (_q, b, _r, s) => update('booking', BOOKING_STATUS, b, s),
  enquiryUpdate: (_q, b, _r, s) => update('enquiry', ENQUIRY_STATUS, b, s),
  purge,
}

const SAFE_ERRORS = new Set(['DbError', 'AuthError', 'TboError'])

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams)
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const action = req.method === 'POST' ? body.action : q.action
  try {
    if (!dbConfigured() || !process.env.SUPABASE_PUBLISHABLE_KEY) throw new DbError('The CRM database is not connected yet.', 503)
    const open = req.method === 'POST' && PUBLIC[action]
    const fn = open || (req.method === 'POST' ? WRITE[action] : READ[action])
    if (!fn) return res.status(400).json({ error: 'Unknown action' })
    const staff = open ? null : await requireStaff(req)
    const out = await fn(q, body, req, staff)
    if (out && out.csv !== undefined) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`)
      return res.status(200).send('﻿' + out.csv)
    }
    return res.status(200).json(out)
  } catch (e) {
    const status = e.status || 500
    const known = SAFE_ERRORS.has(e?.constructor?.name) || (status < 500 && e.status)
    if (!known) console.error('[crm]', e)
    return res.status(status).json({ error: known ? e.message : 'CRM error' })
  }
}
