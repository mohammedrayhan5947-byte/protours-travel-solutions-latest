import crypto from 'node:crypto'

/**
 * Everything that talks to Razorpay, in one place.
 *
 * What protects the money here:
 *  - The amount is decided on OUR server from the sealed fare quote, never taken from the browser.
 *  - Card details never reach us: Razorpay Checkout (their page) takes them, so we are outside card-data (PCI) scope.
 *  - The key SECRET and the webhook secret live only in server environment variables.
 *  - A payment only counts after we ask Razorpay's own API about it: right order, right amount, right currency,
 *    and captured. A payment that is only "authorized" is captured by us before any ticket is bought.
 *  - Signatures (checkout and webhook) are checked with a constant-time comparison.
 *  - Test and live must match (see paymentModeProblem).
 */

export const razorpayConfigured = () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)

/**
 * Real card money and real tickets must switch on together. Live Razorpay keys with TBO in test mode would charge
 * customers for tickets that do not exist; test Razorpay keys with TBO live would issue real tickets (and spend the
 * TBO wallet) for payments that are not real. Returns the problem as a sentence, or '' when the two agree.
 */
export function paymentModeProblem(keyId, isLive) {
  const live = /^rzp_live_/.test(String(keyId || '')), test = /^rzp_test_/.test(String(keyId || ''))
  if (live && !isLive) return 'Live card payments are on but flight booking is still in TBO test mode (TBO_ENV). Switch both to live together.'
  if (test && isLive) return 'TBO is live but the card payment keys are test keys, so real tickets would be issued without real payment. Use the live Razorpay keys.'
  return ''
}

export class PayError extends Error {
  constructor(message, status = 402, detail) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

/** One call to the Razorpay REST API. Never logs the key; errors carry Razorpay's description. */
export async function rzp(path, { method = 'GET', body, headers = {} } = {}) {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')
  let r
  try {
    r = await fetch(`https://api.razorpay.com/v1/${path}`, {
      method,
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    })
  } catch (e) {
    throw new PayError(e.name === 'TimeoutError' ? 'The payment provider took too long to answer.' : 'Could not reach the payment provider.', 504)
  }
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new PayError(data?.error?.description || `Payment provider error (${r.status}).`, r.status >= 500 ? 502 : r.status === 401 ? 503 : 400, data?.error)
  return data
}

/** A Razorpay order for exactly this amount; `receipt` is our order reference, so every payment can be traced back. */
export async function createOrder({ amountPaise, receipt, notes }) {
  if (!Number.isInteger(amountPaise) || amountPaise < 100) throw new PayError('Invalid payment amount.', 400)
  const o = await rzp('orders', { method: 'POST', body: { amount: amountPaise, currency: 'INR', receipt: String(receipt).slice(0, 40), notes: notes || {} } })
  return { orderId: o.id, amountPaise: o.amount }
}

const hmac = (secret, text) => crypto.createHmac('sha256', secret).update(text).digest('hex')
export function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''))
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y)
}

/** The signature Razorpay Checkout hands the browser: HMAC-SHA256 of "order_id|payment_id" with the key secret. */
export const checkoutSignatureOk = (orderId, paymentId, signature) => Boolean(process.env.RAZORPAY_KEY_SECRET) && safeEqual(hmac(process.env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`), signature)

/** The signature on a webhook: HMAC-SHA256 of the EXACT raw request body with the webhook secret. */
export const webhookSignatureOk = (rawBody, signature, secret = process.env.RAZORPAY_WEBHOOK_SECRET) => Boolean(secret) && safeEqual(hmac(secret, rawBody), signature)

/**
 * Asks Razorpay about a payment and insists it is a real, full, captured payment for THIS order.
 * Capturing is done here when the account is set to manual capture, so a ticket is never bought on money that is not ours yet.
 */
export async function confirmPayment({ orderId, paymentId, amountInr }) {
  const wantPaise = Math.round(Number(amountInr) * 100)
  if (!orderId || !paymentId || !/^pay_[A-Za-z0-9]+$/.test(String(paymentId)) || !Number.isInteger(wantPaise) || wantPaise < 100) throw new PayError('Payment could not be verified.', 402)
  let pay = await rzp(`payments/${encodeURIComponent(paymentId)}`)
  if (pay.order_id !== orderId) throw new PayError('This payment belongs to a different booking.', 402)
  if (pay.currency !== 'INR' || pay.amount !== wantPaise) throw new PayError('The payment amount does not match this booking.', 402)
  if (pay.status === 'authorized') {
    try {
      pay = await rzp(`payments/${encodeURIComponent(paymentId)}/capture`, { method: 'POST', body: { amount: wantPaise, currency: 'INR' } })
    } catch (e) {
      // the webhook and the customer's browser can both try to capture at the same moment; the loser just reads the result
      pay = await rzp(`payments/${encodeURIComponent(paymentId)}`).catch(() => { throw e })
    }
  }
  if (pay.status !== 'captured') throw new PayError('Payment is not complete for this booking.', 402)
  return { paymentId: pay.id, amountPaise: pay.amount, method: pay.method }
}

/**
 * Refund (full or partial) of a captured payment. `idempotencyKey` makes a double click or a retry harmless:
 * Razorpay returns the same refund instead of creating a second one.
 */
export async function refundPayment({ paymentId, amountPaise, receipt, notes, idempotencyKey }) {
  if (!/^pay_[A-Za-z0-9]+$/.test(String(paymentId || ''))) throw new PayError('This booking has no card payment to refund.', 400)
  if (!Number.isInteger(amountPaise) || amountPaise < 100) throw new PayError('Invalid refund amount.', 400)
  return rzp(`payments/${encodeURIComponent(paymentId)}/refund`, {
    method: 'POST',
    headers: idempotencyKey ? { 'X-Refund-Idempotency': String(idempotencyKey).slice(0, 80) } : {},
    body: { amount: amountPaise, speed: 'normal', receipt: String(receipt || '').slice(0, 40) || undefined, notes: notes || {} },
  })
}
