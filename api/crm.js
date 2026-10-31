import { authenticate, shared, air, IS_LIVE, markupPercent, fakePaymentsAllowed, TboError } from './_lib/tbo.js'
import { db, dbConfigured, DbError, clean, addEvent } from './_lib/db.js'
import { requireStaff, signIn, refresh, AuthError } from './_lib/auth.js'

/**
 * Back office (CRM) API: flight bookings, website enquiries, the TBO call logs and the TBO wallet.
 * One endpoint: GET /api/crm?action=...  or  POST /api/crm {action, ...}.
 *
 * Access: staff sign in with their Supabase account (action=login). Every other action needs that
 * token AND the e-mail must be on CRM_ALLOWED_EMAILS (see api/_lib/auth.js).
 */
const BOOKING_STATUS = ['payment_pending', 'paid', 'ticketed', 'needs_attention', 'failed', 'cancelled', 'refunded']
const ENQUIRY_STATUS = ['new', 'contacted', 'quoted', 'won', 'lost']
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TRACE = /^[A-Za-z0-9-]{1,64}$/
const IST = 5.5 * 3600_000
const istDay = (t) => new Date(new Date(t).getTime() + IST).toISOString().slice(0, 10)
const bad = (m, s = 400) => Object.assign(new Error(m), { status: s })

const BOOKING_LIST = 'id,created_at,updated_at,order_ref,env,status,amount_inr,customer_name,contact_phone,contact_email,route,journey,travel_date,return_date,pax_count,pnr,booking_ids,assigned_to'

/* ---------------- login (public) ---------------- */

const fails = new Map()
async function login(_q, body, req) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown'
  const recent = (fails.get(ip) || []).filter((t) => Date.now() - t < 10 * 60_000)
  if (recent.length >= 8) throw new AuthError('Too many attempts. Please wait ten minutes.', 429)
  try {
    return await signIn(String(body.email || '').trim(), String(body.password || ''))
  } catch (e) {
    recent.push(Date.now()); fails.set(ip, recent)
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
  if (q.assigned && kind) f.push(`assigned_to=eq.${encodeURIComponent(clean(q.assigned, 60))}`)
  return f
}

async function page(table, select, q, kind) {
  const size = Math.min(100, Math.max(1, Number(q.size) || 25))
  const pg = Math.max(1, Number(q.page) || 1)
  const { rows, count } = await db(`${table}?select=${select}&${filters(q, kind).join('&')}&order=created_at.desc&limit=${size}&offset=${(pg - 1) * size}`, { prefer: 'count=exact' })
  return { rows: rows || [], total: count ?? (rows || []).length, page: pg, size }
}

/* ---------------- dashboard ---------------- */

async function overview() {
  const since = new Date(Date.now() - 120 * 864e5).toISOString()
  const [b, e, rb, re, att] = await Promise.all([
    db(`flight_bookings?created_at=gte.${since}&select=status,amount_inr,created_at&order=created_at.desc&limit=5000`),
    db(`enquiries?created_at=gte.${since}&select=status,created_at&order=created_at.desc&limit=5000`),
    db('flight_bookings?select=id,order_ref,status,amount_inr,customer_name,route,created_at&order=created_at.desc&limit=8'),
    db('enquiries?select=id,name,phone,topic,status,created_at&order=created_at.desc&limit=8'),
    db('flight_bookings?status=in.(needs_attention,failed)&select=id,order_ref,status,customer_name,route,contact_phone,created_at&order=created_at.desc&limit=10'),
  ])
  const bookings = b.rows || [], enquiries = e.rows || []
  const count = (rows, s) => rows.filter((r) => r.status === s).length
  const now = Date.now(), today = istDay(now)
  const rev = (days) => bookings.filter((r) => r.status === 'ticketed' && now - new Date(r.created_at) < days * 864e5).reduce((t, r) => t + Number(r.amount_inr || 0), 0)
  const daily = Array.from({ length: 14 }, (_, i) => istDay(now - (13 - i) * 864e5)).map((date) => ({
    date,
    bookings: bookings.filter((r) => r.status === 'ticketed' && istDay(r.created_at) === date).length,
    revenue: bookings.filter((r) => r.status === 'ticketed' && istDay(r.created_at) === date).reduce((t, r) => t + Number(r.amount_inr || 0), 0),
    enquiries: enquiries.filter((r) => istDay(r.created_at) === date).length,
  }))
  const abandoned = bookings.filter((r) => r.status === 'payment_pending' && now - new Date(r.created_at) > 30 * 60_000).length
  return {
    env: IS_LIVE ? 'live' : 'staging',
    payments: process.env.RAZORPAY_KEY_ID ? 'razorpay' : fakePaymentsAllowed() ? 'test mode (no real payment)' : 'off',
    markupPercent: markupPercent(),
    today,
    bookings: {
      ticketed: count(bookings, 'ticketed'), attention: count(bookings, 'needs_attention') + count(bookings, 'failed'),
      pending: count(bookings, 'payment_pending'), abandoned, total: bookings.length,
      revenueToday: bookings.filter((r) => r.status === 'ticketed' && istDay(r.created_at) === today).reduce((t, r) => t + Number(r.amount_inr || 0), 0),
      revenue7: rev(7), revenue30: rev(30),
    },
    enquiries: { new: count(enquiries, 'new'), contacted: count(enquiries, 'contacted'), quoted: count(enquiries, 'quoted'), won: count(enquiries, 'won'), lost: count(enquiries, 'lost'), total: enquiries.length },
    daily,
    recentBookings: rb.rows || [],
    recentEnquiries: re.rows || [],
    needsAttention: att.rows || [],
  }
}

/* ---------------- bookings ---------------- */

const bookings = (q) => page('flight_bookings', BOOKING_LIST, q, 'booking')

async function booking(q) {
  const id = Number(q.id)
  if (!Number.isInteger(id) || id <= 0) throw bad('Bad booking id')
  const [row, ev] = await Promise.all([db(`flight_bookings?id=eq.${id}&select=*`), db(`crm_events?entity=eq.booking&entity_id=eq.${id}&order=created_at.asc&limit=200`)])
  const b = row.rows?.[0]
  if (!b) throw bad('Booking not found', 404)
  let calls = []
  if (b.trace_id && TRACE.test(b.trace_id)) {
    calls = (await db(`tbo_logs?trace_id=eq.${b.trace_id}&select=id,created_at,method,kind&order=created_at.asc&limit=300`)).rows || []
  }
  return { booking: b, events: ev.rows || [], calls }
}

async function update(table, kind, statuses, body, staff) {
  const id = Number(body.id)
  if (!Number.isInteger(id) || id <= 0) throw bad('Bad id')
  const cur = (await db(`${table}?id=eq.${id}&select=status,assigned_to`)).rows?.[0]
  if (!cur) throw bad('Not found', 404)
  const patch = {}, events = []
  if (body.status !== undefined && body.status !== cur.status) {
    if (!statuses.includes(body.status)) throw bad('Unknown status')
    patch.status = body.status
    events.push(['status', { from: cur.status, to: body.status }])
  }
  if (body.assigned_to !== undefined) {
    const a = clean(body.assigned_to, 60) || null
    if (a !== (cur.assigned_to || null)) { patch.assigned_to = a; events.push(['assigned', { from: cur.assigned_to || null, to: a }]) }
  }
  const note = String(body.note || '').trim().slice(0, 2000)
  if (note) events.push(['note', { text: note }])
  if (Object.keys(patch).length) await db(`${table}?id=eq.${id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' })
  for (const [k, data] of events) await addEvent(kind, id, k, staff.email, data)
  return { ok: true }
}

/* ---------------- enquiries ---------------- */

const enquiries = (q) => page('enquiries', '*', q, 'enquiry')

async function enquiry(q) {
  const id = Number(q.id)
  if (!Number.isInteger(id) || id <= 0) throw bad('Bad enquiry id')
  const [row, ev] = await Promise.all([db(`enquiries?id=eq.${id}&select=*`), db(`crm_events?entity=eq.enquiry&entity_id=eq.${id}&order=created_at.asc&limit=200`)])
  if (!row.rows?.[0]) throw bad('Enquiry not found', 404)
  return { enquiry: row.rows[0], events: ev.rows || [] }
}

/** The Privacy Policy promises enquiries that did not become a booking are deleted within 12 months. */
async function purge(_q, body, _req, staff) {
  if (body.confirm !== true) throw bad('Confirm the clean-up first.')
  const months = Math.min(60, Math.max(3, Number(body.months) || 12))
  const cutoff = new Date(Date.now() - months * 30.4 * 864e5).toISOString()
  const old = (await db(`enquiries?created_at=lt.${cutoff}&status=neq.won&select=id&limit=2000`)).rows || []
  if (old.length) {
    const ids = old.map((r) => r.id).join(',')
    await db(`crm_events?entity=eq.enquiry&entity_id=in.(${ids})`, { method: 'DELETE', prefer: 'return=minimal' })
    await db(`enquiries?id=in.(${ids})`, { method: 'DELETE', prefer: 'return=minimal' })
  }
  console.log(`[crm] ${staff.email} deleted ${old.length} enquiries older than ${months} months`)
  return { deleted: old.length, months }
}

/* ---------------- TBO logs + live lookups ---------------- */

async function traces() {
  const { rows } = await db('tbo_logs?trace_id=not.is.null&select=trace_id,method,kind,created_at&order=created_at.desc&limit=1500')
  const map = new Map()
  for (const r of rows || []) {
    const t = map.get(r.trace_id) || { traceId: r.trace_id, calls: 0, methods: new Set(), at: r.created_at, last: r.created_at }
    if (r.kind === 'request') t.calls++
    t.methods.add(r.method)
    if (r.created_at < t.at) t.at = r.created_at
    if (r.created_at > t.last) t.last = r.created_at
    map.set(r.trace_id, t)
  }
  const list = [...map.values()].slice(0, 60).map((t) => ({ ...t, methods: [...t.methods] }))
  const ids = list.map((t) => t.traceId).filter((t) => TRACE.test(t))
  let links = []
  if (ids.length) links = (await db(`flight_bookings?trace_id=in.(${ids.join(',')})&select=id,trace_id,order_ref,status&limit=200`)).rows || []
  return list.map((t) => ({ ...t, booking: links.find((l) => l.trace_id === t.traceId) || null }))
}

async function trace(q) {
  if (!TRACE.test(q.id || '')) throw bad('Bad trace id')
  return (await db(`tbo_logs?trace_id=eq.${q.id}&select=id,created_at,method,kind,body&order=created_at.asc&limit=300`)).rows || []
}

async function balance() {
  const a = await authenticate()
  const r = await shared('GetAgencyBalance', { ClientId: 'ApiIntegrationNew', TokenAgencyId: a.agencyId, TokenMemberId: a.memberId })
  if (r.Status !== 1) throw new TboError(r.Error?.ErrorMessage || 'Balance not available', { status: 502 })
  return { cash: r.CashBalance, credit: r.CreditBalance, agencyType: r.AgencyType === 2 ? 'Credit' : 'Cash' }
}

/** What TBO itself says about a booking right now (ticket numbers, status). */
async function live(q) {
  const bookingId = Number(q.id)
  if (!Number.isInteger(bookingId) || bookingId <= 0) throw bad('Bad booking id')
  const a = await authenticate()
  const r = await air('GetBookingDetails', { tokenId: a.tokenId }, { BookingId: bookingId }, { allowError: true })
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

async function exportCsv(q) {
  const kind = q.entity === 'enquiries' ? 'enquiry' : 'booking'
  const table = kind === 'enquiry' ? 'enquiries' : 'flight_bookings'
  const select = kind === 'enquiry' ? '*' : BOOKING_LIST
  const { rows } = await db(`${table}?select=${select}&${filters(q, kind).join('&')}&order=created_at.desc&limit=5000`)
  const list = rows || []
  const cols = list.length ? Object.keys(list[0]) : []
  const csv = [cols.join(','), ...list.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n')
  return { csv, filename: `${table}-${istDay(Date.now())}.csv` }
}

/* ---------------- routing ---------------- */

const PUBLIC = { login, refresh: (_q, body) => refresh(String(body.refreshToken || '')) }
const READ = {
  me: (_q, _b, _r, staff) => ({ email: staff.email, env: IS_LIVE ? 'live' : 'staging' }),
  overview, bookings, booking, enquiries, enquiry, traces, trace, balance, live, export: exportCsv,
}
const WRITE = {
  bookingUpdate: (_q, b, _r, s) => update('flight_bookings', 'booking', BOOKING_STATUS, b, s),
  enquiryUpdate: (_q, b, _r, s) => update('enquiries', 'enquiry', ENQUIRY_STATUS, b, s),
  purge,
}

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
      return res.status(200).send('ï»¿' + out.csv)
    }
    return res.status(200).json(out)
  } catch (e) {
    const status = e instanceof AuthError || e instanceof DbError || e instanceof TboError || e.status ? e.status || 500 : 500
    if (status >= 500 && !(e instanceof DbError || e instanceof TboError)) console.error('[crm]', e)
    return res.status(status).json({ error: status >= 500 && !(e instanceof DbError || e instanceof TboError) ? 'CRM error' : e.message })
  }
}
