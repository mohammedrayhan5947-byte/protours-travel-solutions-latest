import crypto from 'node:crypto'
import { waitUntil } from '@vercel/functions'
import { fulfilPaidOrder } from './_lib/flights.js'
import { webhookSignatureOk } from './_lib/pay.js'
import { paymentRecord } from './_lib/pay.js'
import { paymentNote, recordPayment, recordRefund, webhookDone, webhookSeen } from './_lib/store.js'
import { flushLogs } from './_lib/tbo.js'

/**
 * Razorpay webhook: the safety net for "the customer paid, then closed the browser / lost signal".
 *
 *  - The request is only believed if its X-Razorpay-Signature matches an HMAC of the EXACT raw body made with
 *    RAZORPAY_WEBHOOK_SECRET (so the body is read raw, not parsed first).
 *  - Each delivery (X-Razorpay-Event-Id) is processed once; Razorpay's retries and anyone's replays are acknowledged and ignored.
 *  - We answer 200 straight away (Razorpay gives up on slow endpoints) and do the work afterwards.
 *  - Ticketing for a paid order goes through the same one-ticket-per-payment claim as the customer's own request,
 *    so a webhook and a browser can never both issue a ticket.
 *
 * In the Razorpay dashboard (Settings, Webhooks): URL https://www.protoursandtravelsolutions.com/api/razorpay-webhook,
 * the same secret as RAZORPAY_WEBHOOK_SECRET, events: payment.authorized, payment.captured, payment.failed, order.paid,
 * refund.processed, refund.failed.
 */
export const config = { maxDuration: 300, api: { bodyParser: false } }

const MAX_BODY = 512 * 1024

async function readRaw(req) {
  if (typeof req.body === 'string') return req.body
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8')
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 })
    chunks.push(c)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function handle(event, body) {
  const pay = body.payload?.payment?.entity
  // every payment event goes into the ledger first (method, UPI id, status, times), whatever else happens
  if (pay?.id && event.startsWith('payment.')) await recordPayment(paymentRecord(pay, 'webhook', body.created_at))
  const ord = body.payload?.order?.entity
  const rf = body.payload?.refund?.entity
  switch (event) {
    case 'payment.authorized':
    case 'payment.captured':
    case 'order.paid': {
      const orderId = pay?.order_id || ord?.id
      if (!pay?.id || !orderId) return 'no payment in event'
      const note = await fulfilPaidOrder({ orderId, paymentId: pay.id })
      await flushLogs()
      return note
    }
    case 'payment.failed': {
      if (!pay?.order_id) return 'no order'
      await paymentNote(pay.order_id, 'payment_failed', { message: String(pay.error_description || pay.error_reason || 'Payment failed').slice(0, 200), paymentId: pay.id })
      return 'failure noted'
    }
    case 'refund.processed': {
      if (!rf?.id || !rf.payment_id) return 'no refund'
      const out = await recordRefund({ payment_id: rf.payment_id, refund_id: rf.id, amount_inr: Number(rf.amount) / 100, actor: 'razorpay', status: rf.status, reason: rf.notes?.reason || null })
      return out?.duplicate ? 'refund already recorded' : out?.found === false ? 'refund for an unknown payment' : 'refund recorded'
    }
    case 'refund.failed': {
      if (!rf?.payment_id) return 'no refund'
      await paymentNote(pay?.order_id || rf.notes?.order_id || '', 'payment_failed', { message: 'A refund failed at the bank. Check Razorpay.', refundId: rf.id })
      return 'refund failure noted'
    }
    default:
      return 'ignored'
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    console.error('[webhook] RAZORPAY_WEBHOOK_SECRET is not set: refusing every delivery')
    return res.status(503).json({ error: 'Webhook not configured.' })
  }
  let raw
  try { raw = await readRaw(req) } catch (e) { return res.status(e.status || 400).json({ error: 'Bad request.' }) }
  if (!webhookSignatureOk(raw, String(req.headers['x-razorpay-signature'] || ''))) {
    console.warn('[webhook] bad signature from', String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown')
    return res.status(400).json({ error: 'Invalid signature.' })
  }
  let body
  try { body = JSON.parse(raw) } catch { return res.status(400).json({ error: 'Invalid JSON.' }) }

  const event = String(body.event || '')
  const eventId = String(req.headers['x-razorpay-event-id'] || '') || `body:${crypto.createHash('sha256').update(raw).digest('hex')}`
  const pay = body.payload?.payment?.entity
  const fresh = await webhookSeen(eventId, event, pay?.id || body.payload?.refund?.entity?.payment_id, pay?.order_id || body.payload?.order?.entity?.id)
  if (!fresh) return res.status(200).json({ ok: true, duplicate: true })

  const work = handle(event, body)
    .then((note) => { console.log(JSON.stringify({ webhook: event, eventId, note })); return webhookDone(eventId, note) })
    .catch((e) => { console.error('[webhook] failed:', event, eventId, e.message); return webhookDone(eventId, `error: ${e.message}`) })
  try { waitUntil(work) } catch { /* no waitUntil outside Vercel (tests, local): the work still runs */ }
  res.status(200).json({ ok: true })
  if (process.env.WEBHOOK_INLINE === '1') await work // tests only: wait for the work so results can be checked
}
