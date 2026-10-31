/**
 * Supabase (PostgREST) access for the server: bookings, enquiries, CRM events, TBO logs.
 * Uses the secret key (SUPABASE_SERVICE_KEY), which must never reach the browser; RLS has no
 * public policies, so this is the only way in. Every call has a short timeout, and the recording
 * helpers swallow errors: record-keeping must never break a booking.
 */
export class DbError extends Error {
  constructor(message, status = 500) {
    super(message)
    this.status = status
  }
}

const base = () => process.env.SUPABASE_URL
const key = () => process.env.SUPABASE_SERVICE_KEY
export const dbConfigured = () => Boolean(base() && key())

/** One PostgREST call. `path` is e.g. 'flight_bookings?status=eq.ticketed&limit=10'. */
export async function db(path, { method = 'GET', body, prefer } = {}) {
  if (!dbConfigured()) throw new DbError('The database is not connected (SUPABASE_URL / SUPABASE_SERVICE_KEY).', 503)
  let res
  try {
    res = await fetch(`${base()}/rest/v1/${path}`, {
      method,
      headers: { apikey: key(), 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(9000),
    })
  } catch (e) {
    throw new DbError(e.name === 'TimeoutError' ? 'The database took too long to answer.' : 'Could not reach the database.', 504)
  }
  const text = await res.text()
  let rows = null
  try { rows = text ? JSON.parse(text) : null } catch { /* not JSON */ }
  if (!res.ok) throw new DbError(rows?.message || `Database error (${res.status})`, res.status >= 500 ? 502 : res.status)
  const range = res.headers.get('content-range') // "0-24/137" when Prefer: count=exact
  const count = range && range.includes('/') ? Number(range.split('/')[1]) : null
  return { rows, count }
}

/** PostgREST filter values must not carry its own syntax characters. */
export const clean = (s, max = 80) => String(s ?? '').replace(/[^\p{L}\p{N}@+._\- ]/gu, '').trim().slice(0, max)

export async function addEvent(entity, entityId, kind, actor, data = {}) {
  try { await db('crm_events', { method: 'POST', body: { entity, entity_id: entityId, kind, actor, data }, prefer: 'return=minimal' }) } catch { /* timeline only */ }
}
