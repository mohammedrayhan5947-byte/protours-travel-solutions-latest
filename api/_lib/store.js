import { db, dbConfigured, addEvent } from './db.js'
import { IS_LIVE } from './tbo.js'

/**
 * Booking records for the CRM (Supabase table flight_bookings + a timeline in crm_events).
 * A row is created when payment starts, so abandoned and failed attempts are visible too, and it is
 * updated as the payment clears and the ticket is issued. Everything is awaited (a serverless function
 * may be frozen the moment it replies) and nothing here ever throws: a booking must not fail
 * because record-keeping did.
 */
const TYPE = { 1: 'Adult', 2: 'Child', 3: 'Infant' }
const day = (iso) => (iso ? String(iso).slice(0, 10) : null)

async function safe(fn) {
  if (!dbConfigured()) return null
  try { return await fn() } catch (e) { console.error('[crm] could not record:', e.message); return null }
}

async function patchByRef(orderRef, patch) {
  const { rows } = await db(`flight_bookings?order_ref=eq.${encodeURIComponent(orderRef)}`, { method: 'PATCH', body: patch, prefer: 'return=representation' })
  return rows?.[0] || null
}

/** Payment is about to start: create (or refresh) the booking row. */
export const recordCheckout = (b) => safe(async () => {
  const lead = b.pax?.[0]
  const { rows } = await db('flight_bookings?on_conflict=order_ref', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: {
      order_ref: b.orderRef,
      env: IS_LIVE ? 'live' : 'staging',
      trace_id: b.traceId || null,
      status: 'payment_pending',
      amount_inr: b.amount,
      razorpay_order_id: b.orderId || null,
      customer_name: lead ? `${lead.title} ${lead.first} ${lead.last}`.trim() : null,
      contact_phone: b.contact?.phone || null,
      contact_email: b.contact?.email || null,
      journey: b.journey || null,
      route: b.route || null,
      travel_date: day(b.travelDate),
      return_date: day(b.returnDate),
      pax_count: b.pax?.length || null,
      pax: (b.pax || []).map((p) => ({ type: TYPE[p.paxType] || 'Adult', name: `${p.title} ${p.first} ${p.last}`.trim() })),
    },
  })
  if (rows?.[0]?.id) await addEvent('booking', rows[0].id, 'created', 'customer', { amount: b.amount, route: b.route })
  return rows?.[0]?.id || null
})

/** The payment was confirmed; ticketing is about to start. */
export const recordPaid = (orderRef, paymentId) => safe(async () => {
  const row = await patchByRef(orderRef, { status: 'paid', payment_id: paymentId || null })
  if (row) await addEvent('booking', row.id, 'paid', 'system', { paymentId })
})

/** The payment could not be confirmed (bad signature, cancelled...). The row stays "payment_pending". */
export const recordPaymentFailed = (orderRef, message) => safe(async () => {
  const { rows } = await db(`flight_bookings?order_ref=eq.${encodeURIComponent(orderRef)}&select=id`)
  if (rows?.[0]) await addEvent('booking', rows[0].id, 'payment_failed', 'system', { message: String(message).slice(0, 300) })
})

/** Ticketing finished (or half-finished): final status, PNRs, tickets. */
export const recordOutcome = (b) => safe(async () => {
  const ok = b.results.every((r) => r.bookingId && !r.error)
  const status = ok ? 'ticketed' : b.results.some((r) => r.pnr) ? 'needs_attention' : 'failed'
  // keep the customer-entered names, add ticket numbers from the airline's record
  const tickets = new Map(b.results.flatMap((r) => (r.details?.passengers || []).map((p) => [String(p.name).toUpperCase(), p.ticket])))
  const cur = await db(`flight_bookings?order_ref=eq.${encodeURIComponent(b.orderRef)}&select=pax`)
  const pax = (cur.rows?.[0]?.pax || []).map((p) => ({ ...p, ticket: tickets.get(String(p.name).toUpperCase()) || p.ticket || '' }))
  const row = await patchByRef(b.orderRef, {
    status,
    payment_id: b.paymentId || null,
    legs: b.results,
    pnr: b.results.map((r) => r.pnr).filter(Boolean).join(', ') || null,
    booking_ids: b.results.map((r) => r.bookingId).filter(Boolean).join(', ') || null,
    ...(pax.length ? { pax } : {}),
  })
  if (row) {
    await addEvent('booking', row.id, status === 'ticketed' ? 'ticketed' : 'failed', 'system', {
      status,
      pnr: row.pnr,
      errors: b.results.map((r) => r.error).filter(Boolean),
    })
  }
  return status
})
