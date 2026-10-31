import { rpc, dbConfigured } from './db.js'
import { IS_LIVE } from './tbo.js'

/**
 * Booking records for the CRM (Supabase table flight_bookings + a timeline in crm_events).
 * A row is created when payment starts, so abandoned and failed attempts are visible too, and it is
 * updated as the payment clears and the ticket is issued. Each step is ONE database round trip
 * (a function in supabase/schema.sql), because they run on the customer's booking path and Vercel
 * to Supabase crosses a region. Everything is awaited (a serverless function may be frozen the moment
 * it replies) and nothing here ever throws: a booking must not fail because record-keeping did.
 */
const TYPE = { 1: 'Adult', 2: 'Child', 3: 'Infant' }
const day = (iso) => (iso ? String(iso).slice(0, 10) : null)

async function safe(fn) {
  if (!dbConfigured()) return null
  try { return await fn() } catch (e) { console.error('[crm] could not record:', e.message); return null }
}

/** Payment is about to start: create (or refresh) the booking row. */
export const recordCheckout = (b) => safe(() => {
  const lead = b.pax?.[0]
  return rpc('crm_record_checkout', {
    p: {
      order_ref: b.orderRef,
      user_id: b.userId || null,
      checkout_token: b.checkoutToken || null,
      env: IS_LIVE ? 'live' : 'staging',
      trace_id: b.traceId || null,
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
})

/** The payment was confirmed; ticketing is about to start. */
export const recordPaid = (orderRef, paymentId) => safe(() => rpc('crm_record_paid', { p_ref: orderRef, p_payment: paymentId || null }))

/** The payment could not be confirmed (bad signature, cancelled...). The row stays "payment_pending". */
export const recordPaymentFailed = (orderRef, message) => safe(() => rpc('crm_record_payment_failed', { p_ref: orderRef, p_message: String(message || '') }))

/** Ticketing finished (or half-finished): final status, PNRs, ticket numbers. */
export const recordOutcome = (b) => safe(async () => {
  const ok = b.results.every((r) => r.bookingId && !r.error)
  const status = ok ? 'ticketed' : b.results.some((r) => r.pnr) ? 'needs_attention' : 'failed'
  // ticket numbers by passenger name; the database merges them into the names the customer entered
  const tickets = Object.fromEntries(b.results.flatMap((r) => (r.details?.passengers || []).map((p) => [String(p.name).toUpperCase(), p.ticket || ''])))
  return rpc('crm_record_outcome', {
    p: {
      order_ref: b.orderRef,
      status,
      payment_id: b.paymentId || null,
      legs: b.results,
      pnr: b.results.map((r) => r.pnr).filter(Boolean).join(', '),
      booking_ids: b.results.map((r) => r.bookingId).filter(Boolean).join(', '),
      tickets,
      errors: b.results.map((r) => r.error).filter(Boolean),
    },
  })
})

/* ---------------- payments: who may issue the ticket, webhook records, refunds ---------------- */

/**
 * Exactly one caller (the customer's browser or the Razorpay webhook) gets { claimed: true } for a paid booking.
 * If the database cannot be reached the booking is NOT blocked (the customer has already paid): it proceeds unguarded,
 * and the failure is logged loudly.
 */
export async function claimTicketing(orderRef, paymentId, amount) {
  if (!dbConfigured()) return { claimed: true, unguarded: true }
  try {
    return await rpc('crm_claim_ticketing', { p_ref: orderRef, p_payment: paymentId, p_paid: amount })
  } catch (e) {
    if (/duplicate key|unique/i.test(e.message)) return { claimed: false, status: 'payment_used' } // this payment already paid for another booking
    console.error('[payments] could not claim ticketing, proceeding unguarded:', orderRef, e.message)
    return { claimed: true, unguarded: true }
  }
}

export const bookingForOrder = (orderId) => safe(() => rpc('crm_for_order', { p_order: orderId }))
export const bookingOutcome = (orderRef) => safe(() => rpc('crm_outcome', { p_ref: orderRef }))
export const webhookSeen = async (eventId, event, paymentId, orderId) => {
  try { return await rpc('crm_webhook_seen', { p_event_id: eventId, p_event: event, p_payment: paymentId || null, p_order: orderId || null }) } catch (e) { console.error('[payments] webhook dedupe failed:', e.message); return true }
}
export const webhookDone = (eventId, outcome) => safe(() => rpc('crm_webhook_done', { p_event_id: eventId, p_outcome: String(outcome || '') }))
export const paymentNote = (orderId, kind, data) => safe(() => rpc('crm_payment_note', { p_order: orderId, p_kind: kind, p_data: data || {} }))
export const markUnfulfilled = (orderId, paymentId, paid, reason) => safe(() => rpc('crm_mark_unfulfilled', { p_order: orderId, p_payment: paymentId, p_paid: paid, p_reason: reason }))
export const bookingForRefund = (id) => rpc('crm_booking_for_refund', { p_id: id })
export const recordRefund = (p) => rpc('crm_record_refund', { p })
