import { useState } from 'react'
import { Loader2, Lock } from 'lucide-react'

import { signIn } from './api.js'
import { Err, input } from './ui.jsx'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    try { await signIn(email.trim(), password) } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="mx-auto mt-6 grid max-w-sm gap-4 rounded-3xl border border-slate-200 bg-white p-7 shadow-xl">
      <div className="text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-navy-950 text-gold-400"><Lock size={22} /></span><h1 className="mt-3 font-display text-[1.5rem] font-bold text-ink">Staff sign-in</h1><p className="mt-1 text-[0.9rem] text-slate-600">Bookings, enquiries and TBO logs. Authorised staff only.</p></div>
      <label className="text-[0.8rem] font-bold text-slate-600 uppercase">E-mail<input type="email" required autoComplete="username" className={`${input} mt-1 normal-case`} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="text-[0.8rem] font-bold text-slate-600 uppercase">Password<input type="password" required autoComplete="current-password" className={`${input} mt-1 normal-case`} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <Err>{err}</Err>
      <button className="btn btn-gold w-full" disabled={busy}>{busy ? <Loader2 size={18} className="animate-spin" /> : 'Sign in'}</button>
    </form>
  )
}
