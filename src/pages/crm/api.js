/* CRM client: sign-in, token refresh, and the one fetch wrapper every screen uses.
   The session lives in sessionStorage (this tab only; gone when the tab closes). */

const KEY = 'pt_crm_session'
const listeners = new Set()

export const getSession = () => {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null') } catch { return null }
}
const save = (s) => {
  try { s ? sessionStorage.setItem(KEY, JSON.stringify(s)) : sessionStorage.removeItem(KEY) } catch { /* private mode */ }
  listeners.forEach((f) => f(s))
}
export const onSession = (f) => { listeners.add(f); return () => listeners.delete(f) }
export const signOut = () => save(null)

const post = async (body, token) => {
  const r = await fetch('/api/crm', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: r.status })
  return data
}

const store = (d) => save({ accessToken: d.accessToken, refreshToken: d.refreshToken, expiresAt: Date.now() + (d.expiresIn - 60) * 1000, email: d.email })

export async function signIn(email, password) {
  store(await post({ action: 'login', email, password }))
}

let refreshing = null
async function token() {
  const s = getSession()
  if (!s) throw Object.assign(new Error('Please sign in.'), { status: 401 })
  if (Date.now() < s.expiresAt) return s.accessToken
  refreshing ||= post({ action: 'refresh', refreshToken: s.refreshToken }).then((d) => { store({ ...d, email: d.email || s.email }); return d.accessToken }).catch((e) => { signOut(); throw e }).finally(() => { refreshing = null })
  return refreshing
}

/** crm('bookings', {status: 'ticketed'}) = GET;  crm('bookingUpdate', {...}, 'POST') = POST. */
export async function crm(action, params = {}, method = 'GET') {
  const t = await token()
  let r
  if (method === 'GET') {
    r = await fetch(`/api/crm?${new URLSearchParams({ action, ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null)) })}`, { headers: { Authorization: `Bearer ${t}` } })
  } else {
    r = await fetch('/api/crm', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ action, ...params }) })
  }
  const data = await r.json().catch(() => ({}))
  if (r.status === 401) signOut()
  if (!r.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: r.status })
  return data
}

export async function download(entity, params = {}) {
  const t = await token()
  const r = await fetch(`/api/crm?${new URLSearchParams({ action: 'export', entity, ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null)) })}`, { headers: { Authorization: `Bearer ${t}` } })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Export failed.')
  const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || `${entity}.csv`
  const url = URL.createObjectURL(await r.blob())
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}
