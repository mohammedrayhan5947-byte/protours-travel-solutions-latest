import crypto from 'node:crypto'

/**
 * CRM staff login = Supabase Auth. The browser signs in with email + password through /api/crm
 * (action=login), gets a Supabase access token (a signed JWT), and sends it as a Bearer token.
 * Here we verify that token's signature against the project's public keys (JWKS), its expiry,
 * issuer and audience, and then require the e-mail to be on CRM_ALLOWED_EMAILS: a valid Supabase
 * account alone is not enough, so nobody who signs up can get in.
 */
export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message)
    this.status = status
  }
}

const b64 = (s) => Buffer.from(s, 'base64url')
let cache = { at: 0, keys: [] }

async function jwks(force = false) {
  if (!force && Date.now() - cache.at < 10 * 60_000 && cache.keys.length) return cache.keys
  const url = process.env.SUPABASE_JWKS_URL || `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new AuthError('Could not load the login keys.', 502)
  cache = { at: Date.now(), keys: (await r.json()).keys || [] }
  return cache.keys
}

const allowed = () => String(process.env.CRM_ALLOWED_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)

/** Returns { email, sub } for a valid staff token, or throws AuthError. */
export async function requireStaff(req) {
  const header = String(req.headers?.authorization || '')
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const parts = token.split('.')
  if (parts.length !== 3) throw new AuthError('Please sign in.')
  let head, claims
  try { head = JSON.parse(b64(parts[0]).toString()); claims = JSON.parse(b64(parts[1]).toString()) } catch { throw new AuthError('Please sign in.') }

  let jwk = (await jwks()).find((k) => k.kid === head.kid)
  if (!jwk) jwk = (await jwks(true)).find((k) => k.kid === head.kid) // keys rotated
  if (!jwk || !['ES256', 'RS256'].includes(head.alg)) throw new AuthError('Please sign in again.')
  const ok = crypto.verify(
    'sha256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    head.alg === 'ES256' ? { key: crypto.createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' } : crypto.createPublicKey({ key: jwk, format: 'jwk' }),
    b64(parts[2]),
  )
  if (!ok) throw new AuthError('Please sign in again.')
  if (!(claims.exp > Date.now() / 1000)) throw new AuthError('Your session expired. Please sign in again.')
  if (claims.iss !== `${process.env.SUPABASE_URL}/auth/v1` || claims.aud !== 'authenticated') throw new AuthError('Please sign in again.')

  const list = allowed()
  if (!list.length) throw new AuthError('No staff accounts are allowed yet. Set CRM_ALLOWED_EMAILS on the server.', 403)
  const email = String(claims.email || '').toLowerCase()
  if (!email || !list.includes(email)) throw new AuthError('This account does not have access to the CRM.', 403)
  return { email, sub: claims.sub }
}

/** Password sign-in through Supabase Auth (server side, so the keys stay on the server). */
export async function signIn(email, password) {
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(10000),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new AuthError(d.error_description === 'Invalid login credentials' || d.msg === 'Invalid login credentials' ? 'Wrong e-mail or password.' : 'Could not sign in.', r.status === 400 ? 401 : r.status)
  if (!allowed().includes(String(d.user?.email || '').toLowerCase())) throw new AuthError('This account does not have access to the CRM.', 403)
  return { accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: d.expires_in, email: d.user.email }
}

export async function refresh(refreshToken) {
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal: AbortSignal.timeout(10000),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new AuthError('Please sign in again.')
  return { accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: d.expires_in, email: d.user?.email }
}
