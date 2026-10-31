import crypto from 'node:crypto'
import { rpc, dbConfigured } from './_lib/db.js'
import { razorpayConfigured, rzp } from './_lib/pay.js'
import { markUnfulfilled } from './_lib/store.js'

/**
 * Daily housekeeping, run by Vercel Cron (see vercel.json; the free plan allows one run per day).
 * 1. Keeps the free Supabase project awake (free projects are paused after a week with no activity,
 *    which would take bookings recording and the CRM offline).
 * 2. Deletes TBO API logs older than TBO_LOG_RETENTION_DAYS (default 60), so the free 500 MB database
 *    never fills, and personal data in logs is not kept longer than needed.
 * 3. Deletes enquiries older than 12 months that did not become a booking (the Privacy Policy promises it).
 * 4. Payment reconciliation: any booking still "awaiting payment" after 20 minutes is checked against Razorpay. If money
 *    was actually taken (and neither the customer's browser nor the webhook completed it), it is flagged "needs attention"
 *    on the dashboard so someone refunds or completes it. This is the last net under the webhook.
 *
 * Vercel calls this with "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set in the project's
 * environment variables. Without that secret the endpoint refuses everything.
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const secret = process.env.CRON_SECRET
  const given = Buffer.from(String(req.headers.authorization || ''))
  const want = Buffer.from(`Bearer ${secret || ''}`)
  if (!secret || given.length !== want.length || !crypto.timingSafeEqual(given, want)) return res.status(401).json({ error: 'Unauthorized' })
  if (!dbConfigured()) return res.status(200).json({ ok: true, skipped: 'database not connected' })
  try {
    const days = Math.min(365, Math.max(7, Number(process.env.TBO_LOG_RETENTION_DAYS) || 60))
    const out = await rpc('crm_cleanup', { p_log_days: days, p_enq_months: 12 })
    console.log(JSON.stringify({ cron: 'cleanup', logRetentionDays: days, ...out }))
    const reconciled = await reconcile().catch((e) => { console.error('[cron] reconcile failed:', e.message); return { error: true } })
    return res.status(200).json({ ok: true, ...out, reconciled })
  } catch (e) {
    console.error('[cron]', e.message)
    return res.status(502).json({ error: 'Cleanup failed' })
  }
}

/** Ask Razorpay about each stale "awaiting payment" booking; flag the ones that were in fact paid. */
async function reconcile() {
  if (!razorpayConfigured()) return { checked: 0, skipped: 'card payments not connected' }
  const list = await rpc('crm_stale_pending', { p_limit: 25 })
  let flagged = 0
  for (const b of list || []) {
    try {
      const o = await rzp(`orders/${encodeURIComponent(b.razorpay_order_id)}/payments`)
      const paid = (o.items || []).find((p) => ['captured', 'authorized'].includes(p.status) && p.amount === Math.round(Number(b.amount_inr) * 100))
      if (paid) {
        await markUnfulfilled(b.razorpay_order_id, paid.id, b.amount_inr, 'paid, but the booking was never completed (found by the daily payment check)')
        console.log(JSON.stringify({ cron: 'reconcile', flagged: b.order_ref, paymentId: paid.id }))
        flagged++
      }
    } catch (e) { console.error('[cron] reconcile', b.order_ref, e.message) }
  }
  return { checked: (list || []).length, flagged }
}
