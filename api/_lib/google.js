import crypto from 'node:crypto'
import { AuthError } from './auth.js'
import { profileOf } from './customer.js'

/**
 * "Continue with Google" for customers.
 *
 * The browser signs in with Google through Firebase and sends us the Firebase ID token. We never trust the
 * browser's word for who the person is: the token is a signed JWT, and we check its signature against Google's
 * published certificates, its audience (our Firebase project), issuer, expiry, that the provider really is
 * Google, and that Google verified the e-mail. Then the same e-mail is turned into an ordinary Supabase session
 * (admin "magic link" + verify, no e-mail is sent), so My trips, bookings and every other rule stay exactly as
 * they are for password accounts.
 */
const PROJECT = () => process.env.FIREBASE_PROJECT_ID || 'sajjad-9c9d7'
const CERTS = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
const b64 = (s) => Buffer.from(s, 'base64url')

let certs = { at: 0, ttl: 0, map: {} }
async function certFor(kid) {
  if (!certs.map[kid] || Date.now() - certs.at > certs.ttl) {
    const r = await fetch(CERTS, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) throw new AuthError('Could not check your Google sign-in. Please try again.', 502)
    const maxAge = Number(/max-age=(\d+)/.exec(r.headers.get('cache-control') || '')?.[1]) || 3600
    certs = { at: Date.now(), ttl: Math.min(maxAge, 6 * 3600) * 1000, map: await r.json() }
  }
  const pem = certs.map[kid]
  return pem ? crypto.createPublicKey(pem) : null
}

/** Verifies a Firebase ID token for a Google sign-in. `keyFor(kid)` exists so tests can supply their own key. */
export async function verifyGoogleToken(idToken, keyFor = certFor) {
  const bad = (m = 'We could not verify your Google sign-in. Please try again.') => new AuthError(m, 401)
  const parts = String(idToken || '').split('.')
  if (parts.length !== 3 || idToken.length > 6000) throw bad()
  let head, c
  try { head = JSON.parse(b64(parts[0]).toString()); c = JSON.parse(b64(parts[1]).toString()) } catch { throw bad() }
  if (head.alg !== 'RS256' || typeof head.kid !== 'string') throw bad()
  const key = await keyFor(head.kid)
  if (!key) throw bad()
  if (!crypto.verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), key, b64(parts[2]))) throw bad()

  const now = Math.floor(Date.now() / 1000)
  const id = PROJECT()
  if (c.aud !== id || c.iss !== `https://securetoken.google.com/${id}`) throw bad()
  if (!(c.exp > now) || !(c.iat <= now + 60) || !(c.auth_time <= now + 60)) throw bad('Your Google sign-in expired. Please try again.')
  if (typeof c.sub !== 'string' || !c.sub || c.sub.length > 128) throw bad()
  if (c.firebase?.sign_in_provider !== 'google.com') throw bad('Please sign in with Google.')
  const email = String(c.email || '').trim().toLowerCase()
  if (!/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) throw bad()
  if (c.email_verified !== true) throw bad('Your Google e-mail is not verified.')
  return { email, name: String(c.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80), sub: c.sub }
}

const admin = async (path, method, body) => {
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1${path}`, {
    method,
    headers: { apikey: process.env.SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }
}

/** Gives the (Google-verified) e-mail a Supabase session: finds or creates the account, then signs it in. */
export async function sessionForEmail(email, name) {
  const newLink = () => admin('/admin/generate_link', 'POST', { type: 'magiclink', email, data: name ? { name } : undefined })
  let link = await newLink()
  if (!link.ok || !link.data.hashed_token || !link.data.id) throw new AuthError('We could not sign you in with Google. Please try again.', 502)
  const u = link.data
  const patch = {}
  // Someone may have registered this address with a password BEFORE its owner ever proved it. The owner has now proved it
  // with Google, so that earlier password must stop working, or whoever set it could walk into the account.
  if (!u.email_confirmed_at) patch.password = crypto.randomBytes(32).toString('base64url')
  if (name && !u.user_metadata?.name) patch.user_metadata = { ...(u.user_metadata || {}), name }
  if (Object.keys(patch).length) {
    const up = await admin(`/admin/users/${encodeURIComponent(u.id)}`, 'PUT', patch)
    if (!up.ok) throw new AuthError('We could not sign you in with Google. Please try again.', 502)
    // changing the account invalidates the link we just made, so ask for a fresh one
    link = await newLink()
    if (!link.ok || !link.data.hashed_token) throw new AuthError('We could not sign you in with Google. Please try again.', 502)
    u.hashed_token = link.data.hashed_token
    u.verification_type = link.data.verification_type
  }
  // The generic "email" type accepts the link for a new account (Supabase calls that "signup") and for an existing one alike.
  let d = {}
  for (const type of new Set(['email', u.verification_type].filter(Boolean))) {
    const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/verify`, {
      method: 'POST',
      headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, token_hash: u.hashed_token }),
      signal: AbortSignal.timeout(10000),
    })
    d = await r.json().catch(() => ({}))
    if (r.ok && d.access_token) break
  }
  if (!d.access_token) throw new AuthError('We could not sign you in with Google. Please try again.', 502)
  return { accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: d.expires_in, profile: profileOf(d.user) }
}
