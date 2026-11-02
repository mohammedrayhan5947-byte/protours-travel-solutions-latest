import { useSyncExternalStore } from 'react'

/* Customer account session. Small on purpose: the navbar and the booking page import this on every page load.
   The session is kept in localStorage so "My trips" is still there when the customer comes back; signing out clears it.
   (The CRM, by contrast, keeps its staff session in sessionStorage and signs out after 30 idle minutes.) */

const KEY = 'pt_account'
const listeners = new Set()
let cached

const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return null }
}
export const getAccount = () => (cached === undefined ? (cached = read()) : cached)
const save = (s) => {
  cached = s
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY) } catch { /* private mode: lives for this page only */ }
  listeners.forEach((f) => f())
}
const subscribe = (f) => { listeners.add(f); return () => listeners.delete(f) }
// signing in or out in another tab of this browser updates this one too
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === KEY) { cached = read(); listeners.forEach((f) => f()) } })
/** The signed-in customer ({ profile, ... }) or null. Re-renders when they sign in or out. */
export const useAccount = () => useSyncExternalStore(subscribe, getAccount, () => null)

export const signOut = () => save(null)
export const storeSession = (d, keep = getAccount()) =>
  save({ accessToken: d.accessToken, refreshToken: d.refreshToken, expiresAt: Date.now() + (d.expiresIn - 60) * 1000, profile: d.profile || keep?.profile || {} })
export const setProfile = (profile) => { const s = getAccount(); if (s) save({ ...s, profile }) }

const post = async (body, token) => {
  const r = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: r.status })
  return data
}

/** A valid access token (refreshed when it is about to expire), or null when signed out. */
let refreshing = null
export async function accountToken() {
  const s = getAccount()
  if (!s) return null
  if (Date.now() < s.expiresAt) return s.accessToken
  refreshing ||= post({ action: 'refresh', refreshToken: s.refreshToken })
    .then((d) => { storeSession(d, s); return d.accessToken })
    .catch((e) => { if (e.status === 401 || e.status === 403) signOut(); return null })
    .finally(() => { refreshing = null })
  return refreshing
}

/** Public calls (sign up, sign in, forgot / reset password). */
export const authCall = (action, params = {}) => post({ action, ...params })

/** Calls that need the customer to be signed in. */
export async function acct(action, params = {}) {
  const t = await accountToken()
  if (!t) throw Object.assign(new Error('Please sign in.'), { status: 401 })
  try { return await post({ action, ...params }, t) } catch (e) { if (e.status === 401) signOut(); throw e }
}

export async function signIn(email, password) {
  storeSession(await post({ action: 'login', email, password }), null)
}
