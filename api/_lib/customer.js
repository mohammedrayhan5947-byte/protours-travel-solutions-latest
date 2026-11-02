import { AuthError, emailConfirmed, verifyToken } from './auth.js'

/**
 * Customer accounts = Supabase Auth, the same login system the CRM uses, called from the server so the
 * keys never reach the browser. A customer account has NO power in the CRM: staff access needs the
 * e-mail to be on CRM_ALLOWED_EMAILS as well (api/_lib/auth.js).
 */
const base = () => `${process.env.SUPABASE_URL}/auth/v1`

async function sb(path, { method = 'POST', body, token } = {}) {
  const r = await fetch(`${base()}${path}`, {
    method,
    headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  })
  const data = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data }
}

const session = (d) => ({ accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: d.expires_in, profile: profileOf(d.user) })
export const profileOf = (u) => ({ email: u?.email || '', name: u?.user_metadata?.name || '', phone: u?.user_metadata?.phone || '' })

export const EMAIL = /^[A-Za-z0-9._+-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/

export function checkPassword(pw, email) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Use at least 8 characters for your password.'
  if (pw.length > 72) return 'That password is too long (72 characters at most).'
  if (/^\d+$/.test(pw)) return 'Add some letters to your password, numbers alone are easy to guess.'
  if (email && pw.toLowerCase() === String(email).toLowerCase()) return 'Your password cannot be your e-mail.'
  return ''
}

export async function signUp({ email, password, name, phone, redirect }) {
  const q = redirect ? `?redirect_to=${encodeURIComponent(redirect)}` : ''
  const r = await sb(`/signup${q}`, { body: { email, password, data: { name, phone } } })
  if (!r.ok) {
    const code = r.data.error_code || r.data.code
    if (code === 'weak_password') throw new AuthError('That password is too easy to guess. Try a longer one with letters and numbers.', 422)
    if (r.status === 429 || code === 'over_email_send_rate_limit') throw new AuthError('Too many sign-ups right now. Please try again in a little while.', 429)
    throw new AuthError('We could not create the account. Please check the details and try again.', 400)
  }
  // With e-mail confirmation on (it must be) there is no session: the customer has to click the link we e-mail.
  return r.data.access_token ? session(r.data) : { confirmationSent: true }
}

export async function passwordLogin(email, password) {
  const r = await sb('/token?grant_type=password', { body: { email, password } })
  if (!r.ok) {
    const code = r.data.error_code || ''
    if (code === 'email_not_confirmed') throw new AuthError('Please confirm your e-mail first. We sent you a link when you signed up.', 403)
    if (r.status === 429) throw new AuthError('Too many attempts. Please wait a few minutes.', 429)
    throw new AuthError('Wrong e-mail or password.', 401)
  }
  return session(r.data)
}

export async function refreshSession(refreshToken) {
  const r = await sb('/token?grant_type=refresh_token', { body: { refresh_token: String(refreshToken || '') } })
  if (!r.ok) throw new AuthError('Please sign in again.')
  return session(r.data)
}

/** Always "succeeds" to the caller, so the form cannot be used to find out who has an account. */
export async function sendReset(email, redirect) {
  const q = redirect ? `?redirect_to=${encodeURIComponent(redirect)}` : ''
  await sb(`/recover${q}`, { body: { email } }).catch(() => null)
}

/** Set a new password using the recovery (or current) access token. */
export async function setPassword(token, password) {
  const r = await sb('/user', { method: 'PUT', token, body: { password } })
  if (!r.ok) {
    if ((r.data.error_code || r.data.code) === 'same_password') throw new AuthError('Choose a password you have not used before.', 422)
    if (r.status === 401 || r.status === 403) throw new AuthError('This link has expired. Please ask for a new one.', 401)
    throw new AuthError('We could not change the password. Please try again.', 400)
  }
}

export async function saveProfile(token, { name, phone }) {
  const r = await sb('/user', { method: 'PUT', token, body: { data: { name, phone } } })
  if (!r.ok) throw new AuthError('We could not save your details. Please try again.', 400)
  return profileOf(r.data)
}

/** Signed-in customer from the Bearer token: { sub, email, name, phone }. Throws AuthError when not signed in. */
export async function requireUser(req) {
  const c = await verifyToken(req)
  return { sub: c.sub, email: String(c.email || '').toLowerCase(), name: c.user_metadata?.name || '', phone: c.user_metadata?.phone || '' }
}

/** Same, for routes where signing in is optional (checkout): returns null for a guest or a bad token. */
export async function optionalUser(req) {
  if (!req.headers?.authorization) return null
  try { return await requireUser(req) } catch { return null }
}

/** The customer's e-mail, but only when Supabase says it is confirmed: that is what lets us match older guest bookings. */
export async function verifiedEmail(user) {
  try { return (await emailConfirmed(user.sub)) ? user.email : null } catch { return null }
}
