import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, Eye, EyeOff, Loader2, LogOut, MailCheck, MessageCircle, Phone, Plane, Ticket, UserRound } from 'lucide-react'

import { BIZ, waLink } from '../data/site.js'
import { acct, authCall, setProfile, signIn, signOut, storeSession, useAccount } from './account/session.js'
import { googleIdToken } from './account/google.js'
import { downloadTicket } from './flights/ticket.js'

/* Customer accounts: create an account, sign in, reset a forgotten password, and "My trips":
   every booking made while signed in (and older ones made with the same confirmed e-mail),
   its status, tickets, and a PDF e-ticket to download. Guests can still book without an account. */

const input = 'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-[1rem] text-ink outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'
const label = 'mb-1 block text-[0.78rem] font-bold tracking-wide text-slate-600 uppercase'
const card = 'rounded-2xl border border-slate-200 bg-white shadow-sm'
const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '')
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '')
const todayIst = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

/** What the customer sees for each internal status (the staff-only wording stays in the CRM). */
const STATUS = {
  payment_pending: ['Payment not completed', 'bg-amber-100 text-amber-900'],
  paid: ['Issuing your ticket', 'bg-sky-100 text-sky-900'],
  ticketed: ['Confirmed', 'bg-emerald-100 text-emerald-900'],
  needs_attention: ['Being completed by our team', 'bg-amber-100 text-amber-900'],
  failed: ['Being completed by our team', 'bg-amber-100 text-amber-900'],
  cancelled: ['Cancelled', 'bg-slate-200 text-slate-700'],
  refunded: ['Refunded', 'bg-violet-100 text-violet-900'],
}
const Pill = ({ status }) => { const [t, c] = STATUS[status] || [status, 'bg-slate-100 text-slate-700']; return <span className={`inline-block rounded-full px-3 py-1 text-[0.78rem] font-bold whitespace-nowrap ${c}`}>{t}</span> }

const Err = ({ children }) => (children ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[0.9rem] font-semibold text-red-700">{children}</p> : null)

function Password({ id, value, onChange, autoComplete, minLength }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input id={id} type={show ? 'text' : 'password'} required minLength={minLength} autoComplete={autoComplete} className={`${input} pr-11`} value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" aria-label={show ? 'Hide password' : 'Show password'} className="absolute top-1/2 right-2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-slate-500 hover:bg-sand" onClick={() => setShow((s) => !s)}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>
    </div>
  )
}

/* ---------------- signed out: sign in / create account / forgot password ---------------- */

const GoogleG = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" /><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" /></svg>
)

function AuthForms({ notice, startTab = 'in' }) {
  const [tab, setTab] = useState(startTab) // in | up | forgot
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('') // '' | 'signup' | 'forgot'
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }))

  const google = async () => {
    setBusy(true); setErr('')
    try {
      const idToken = await googleIdToken()
      if (idToken) storeSession(await authCall('google', { idToken }), null)
    } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      if (tab === 'in') await signIn(f.email.trim(), f.password)
      else if (tab === 'up') {
        const r = await authCall('signup', { name: f.name, email: f.email.trim(), phone: f.phone, password: f.password })
        if (r.accessToken) storeSession(r, null) // only when the project does not require e-mail confirmation
        else setDone('signup')
      } else { await authCall('forgot', { email: f.email.trim() }); setDone('forgot') }
    } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }

  if (done) {
    return (
      <div className={`${card} mx-auto max-w-md p-7 text-center`}>
        <MailCheck className="mx-auto text-palm" size={46} />
        <h2 className="mt-3 font-display text-[1.4rem] font-bold text-ink">{done === 'signup' ? 'Check your e-mail' : 'Reset link sent'}</h2>
        <p className="mt-2 text-slate-600">
          {done === 'signup'
            ? <>We sent a confirmation link to <strong>{f.email}</strong>. Click it to activate your account, then sign in. Look in Spam or Promotions if you cannot see it.</>
            : <>If <strong>{f.email}</strong> has an account, a link to choose a new password is on its way. It works for a short time only.</>}
        </p>
        <button type="button" className="btn btn-ghost mt-5" onClick={() => { setDone(''); setTab('in'); setF((x) => ({ ...x, password: '' })) }}>Back to sign in</button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md">
      {notice && <p role="status" className="mb-4 flex gap-2 rounded-xl bg-white p-3 text-[0.92rem] font-semibold text-navy-900 shadow-sm"><AlertTriangle size={18} className="mt-0.5 shrink-0 text-gold-600" />{notice}</p>}
      <form onSubmit={submit} className={`${card} grid gap-4 p-6 md:p-7`}>
        {tab !== 'forgot' ? (
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-sand p-1" role="tablist" aria-label="Account">
            {[['in', 'Sign in'], ['up', 'Create account']].map(([id, l]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setErr('') }} className={`rounded-lg px-3 py-2 text-[0.92rem] font-bold ${tab === id ? 'bg-white text-ink shadow-sm' : 'text-slate-600'}`}>{l}</button>
            ))}
          </div>
        ) : (
          <div><h2 className="font-display text-[1.3rem] font-bold text-ink">Forgot your password?</h2><p className="mt-1 text-[0.92rem] text-slate-600">Enter your e-mail and we will send you a link to choose a new one.</p></div>
        )}

        {tab !== 'forgot' && (
          <>
            <button type="button" onClick={google} disabled={busy} className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-display text-[0.98rem] font-bold text-ink transition hover:border-slate-500 disabled:opacity-60">
              {busy ? <Loader2 size={18} className="animate-spin" /> : <GoogleG />} Continue with Google
            </button>
            <p className="-my-1 flex items-center gap-3 text-[0.78rem] font-semibold tracking-wide text-slate-400 uppercase"><span className="h-px flex-1 bg-slate-200" />or with e-mail<span className="h-px flex-1 bg-slate-200" /></p>
          </>
        )}

        {tab === 'up' && (
          <>
            <div><label className={label} htmlFor="a-name">Full name</label><input id="a-name" required minLength={2} maxLength={80} autoComplete="name" className={input} value={f.name} onChange={(e) => set('name')(e.target.value)} /></div>
            <div><label className={label} htmlFor="a-phone">Mobile (optional)</label><input id="a-phone" type="tel" inputMode="tel" maxLength={20} autoComplete="tel" className={input} value={f.phone} onChange={(e) => set('phone')(e.target.value)} /></div>
          </>
        )}
        <div><label className={label} htmlFor="a-email">E-mail</label><input id="a-email" type="email" required maxLength={120} autoComplete="email" className={input} value={f.email} onChange={(e) => set('email')(e.target.value)} /></div>
        {tab !== 'forgot' && (
          <div>
            <label className={label} htmlFor="a-pw">Password</label>
            <Password id="a-pw" value={f.password} onChange={set('password')} minLength={tab === 'up' ? 8 : undefined} autoComplete={tab === 'up' ? 'new-password' : 'current-password'} />
            {tab === 'up' && <p className="mt-1 text-[0.78rem] text-slate-500">At least 8 characters, with some letters.</p>}
          </div>
        )}
        <Err>{err}</Err>
        <button className="btn btn-gold w-full" disabled={busy}>{busy ? <Loader2 size={18} className="animate-spin" /> : tab === 'in' ? 'Sign in' : tab === 'up' ? 'Create my account' : 'Send reset link'}</button>
        {tab === 'in' && <button type="button" className="text-[0.88rem] font-bold text-brand-500" onClick={() => { setTab('forgot'); setErr('') }}>Forgot your password?</button>}
        {tab === 'forgot' && <button type="button" className="text-[0.88rem] font-bold text-brand-500" onClick={() => { setTab('in'); setErr('') }}>Back to sign in</button>}
        {tab === 'up' && <p className="text-[0.78rem] text-slate-500">By creating an account you agree to our <Link className="underline" to="/terms">Terms</Link> and <Link className="underline" to="/privacy">Privacy Policy</Link>.</p>}
      </form>
      <p className="mt-4 text-center text-[0.9rem] text-slate-600">No account needed to book: <Link className="font-bold text-brand-500 underline" to="/book-flights">book as a guest</Link>. An account lets you see all your trips and e-tickets in one place.</p>
    </div>
  )
}

/* ---------------- recovery link: choose a new password ---------------- */

function NewPassword({ token, onDone }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    try { await authCall('reset', { accessToken: token, password: pw }); setOk(true) } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  if (ok) return <div className={`${card} mx-auto max-w-md p-7 text-center`}><CheckCircle2 className="mx-auto text-palm" size={46} /><h2 className="mt-3 font-display text-[1.4rem] font-bold text-ink">Password changed</h2><p className="mt-2 text-slate-600">You can now sign in with your new password.</p><button className="btn btn-gold mt-5" onClick={onDone}>Sign in</button></div>
  return (
    <form onSubmit={submit} className={`${card} mx-auto grid max-w-md gap-4 p-7`}>
      <h2 className="font-display text-[1.3rem] font-bold text-ink">Choose a new password</h2>
      <div><label className={label} htmlFor="n-pw">New password</label><Password id="n-pw" value={pw} onChange={setPw} minLength={8} autoComplete="new-password" /><p className="mt-1 text-[0.78rem] text-slate-500">At least 8 characters, with some letters.</p></div>
      <Err>{err}</Err>
      <button className="btn btn-gold w-full" disabled={busy}>{busy ? <Loader2 size={18} className="animate-spin" /> : 'Save new password'}</button>
    </form>
  )
}

/* ---------------- My trips ---------------- */

function TripCard({ b, onOpen }) {
  const multi = b.route?.includes('|')
  return (
    <li>
      <button type="button" onClick={() => onOpen(b.order_ref)} className="grid w-full gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-brand-500 md:grid-cols-[1fr_auto] md:items-center">
        <span className="min-w-0">
          <span className="flex items-center gap-2 font-display text-[1.15rem] font-bold text-ink"><Plane size={17} className="shrink-0 rotate-45 text-brand-500" />{(b.route || 'Flight').replace(/-/g, ' → ').replace(/ \| /g, '   ·   ')}</span>
          <span className="mt-1 block text-[0.88rem] text-slate-600">{day(b.travel_date)}{b.return_date ? ` – ${day(b.return_date)}` : ''}{b.pax_count ? ` · ${b.pax_count} traveller${b.pax_count > 1 ? 's' : ''}` : ''}</span>
          <span className="mt-0.5 block text-[0.78rem] text-slate-500">Ref <span className="font-mono">{b.order_ref}</span>{b.pnr ? <> · PNR <span className="font-mono font-semibold text-ink">{b.pnr}</span></> : ''}{multi ? ' · 2 tickets' : ''}</span>
        </span>
        <span className="flex items-center justify-between gap-4 md:flex-col md:items-end md:gap-1"><Pill status={b.status} /><span className="font-display text-[1.1rem] font-bold text-navy-950">{inr(b.amount_inr)}</span></span>
      </button>
    </li>
  )
}

const EVENT_TEXT = {
  created: 'Booking started',
  paid: 'Payment received',
  payment_failed: 'Payment was not completed',
  ticketed: 'Ticket issued',
  failed: 'Our team is completing your ticket',
}

function TripDetail({ orderRef, onBack }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let live = true
    acct('booking', { orderRef }).then((r) => live && setD(r)).catch((e) => live && setErr(e.message))
    return () => { live = false }
  }, [orderRef])

  const b = d?.booking
  const tickets = useMemo(() => (b?.legs || []).filter((l) => l.bookingId && l.details), [b])
  const download = async () => {
    setSaving(true); setErr('')
    try { await downloadTicket({ orderRef: b.order_ref, amount: b.amount_inr, results: tickets.map((l) => ({ pnr: l.pnr, bookingId: l.bookingId, details: l.details })) }) } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="grid gap-5">
      <button type="button" className="inline-flex w-fit items-center gap-1.5 font-bold text-brand-500" onClick={onBack}><ArrowLeft size={17} /> All trips</button>
      {!b ? (err ? <Err>{err}</Err> : <Loader2 className="mx-auto mt-6 animate-spin" />) : (
        <>
          <div className={`${card} p-5 md:p-6`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-[1.45rem] font-bold text-ink">{(b.route || 'Flight').replace(/-/g, ' → ').replace(/ \| /g, '   ·   ')}</h2>
                <p className="text-[0.9rem] text-slate-600">{day(b.travel_date)}{b.return_date ? ` – ${day(b.return_date)}` : ''}</p>
              </div>
              <Pill status={b.status} />
            </div>
            <dl className="mt-4 grid gap-x-6 gap-y-2 text-[0.9rem] sm:grid-cols-3">
              <div><dt className="text-[0.72rem] font-bold tracking-wide text-slate-500 uppercase">Booking reference</dt><dd className="font-mono font-semibold">{b.order_ref}</dd></div>
              <div><dt className="text-[0.72rem] font-bold tracking-wide text-slate-500 uppercase">Airline PNR</dt><dd className="font-mono font-semibold">{b.pnr || 'Not issued yet'}</dd></div>
              <div><dt className="text-[0.72rem] font-bold tracking-wide text-slate-500 uppercase">Amount</dt><dd className="font-semibold">{inr(b.amount_inr)}</dd></div>
            </dl>
            {b.env && b.env !== 'live' && <p className="mt-3 rounded-lg bg-gold-500/15 px-3 py-2 text-[0.82rem] font-semibold text-navy-900">Test booking: not a real ticket.</p>}
            {b.status === 'ticketed' && <button type="button" className="btn btn-gold mt-5" onClick={download} disabled={saving}>{saving ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />} Download e-ticket (PDF)</button>}
            <Err>{err}</Err>
            {(b.status === 'needs_attention' || b.status === 'failed') && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-[0.92rem] text-amber-900">Your payment is safe. The airline needs a little more time to confirm this booking and our team is completing it. We will contact you; you do not need to book again.</p>}
            {b.status === 'payment_pending' && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-[0.92rem] text-amber-900">This payment was not completed, so no ticket was issued. If any money was deducted, please contact us with the reference above.</p>}
            {b.status === 'paid' && <p className="mt-4 rounded-xl bg-sky-50 p-3 text-[0.92rem] text-sky-900">Payment received. The airline is issuing your ticket. Refresh this page in a minute.</p>}
          </div>

          {tickets.some((l) => l.details?.segments?.length) && (
            <div className={`${card} p-5 md:p-6`}>
              <h3 className="mb-3 font-display text-[1.1rem] font-bold text-ink">Flights</h3>
              <div className="grid gap-3">
                {tickets.flatMap((l) => (l.details.segments || []).map((s, i) => (
                  <div key={`${l.pnr}-${i}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-slate-200 pb-3 last:border-0 last:pb-0">
                    <div><p className="font-display text-[1.1rem] font-bold text-ink">{s.from} → {s.to}</p><p className="text-[0.85rem] text-slate-600">{s.airline ? `${s.airline} ` : ''}{s.flight} · {day(s.dep)}</p></div>
                    <p className="text-right font-display text-[1.25rem] font-bold text-ink">{String(s.dep || '').slice(11, 16)}{s.arr && <span className="block text-[0.78rem] font-semibold text-slate-500">arr. {String(s.arr).slice(11, 16)}</span>}</p>
                  </div>
                )))}
              </div>
            </div>
          )}

          <div className={`${card} p-5 md:p-6`}>
            <h3 className="mb-3 font-display text-[1.1rem] font-bold text-ink">Travellers</h3>
            <table className="w-full text-left text-[0.92rem]">
              <thead><tr className="text-[0.72rem] tracking-wide text-slate-500 uppercase"><th className="py-1">Name</th><th className="py-1">Ticket number</th></tr></thead>
              <tbody>{(b.pax || []).map((p, i) => <tr key={i} className="border-t border-slate-100"><td className="py-2 font-semibold text-ink">{p.name}<span className="ml-2 text-[0.75rem] font-normal text-slate-500">{p.type}</span></td><td className="py-2 font-mono text-slate-700">{p.ticket || (b.status === 'ticketed' ? 'issuing…' : '—')}</td></tr>)}</tbody>
            </table>
          </div>

          <div className={`${card} p-5 md:p-6`}>
            <h3 className="mb-3 font-display text-[1.1rem] font-bold text-ink">Progress</h3>
            <ol className="grid gap-3 border-l-2 border-slate-200 pl-4">
              {(d.events || []).map((e, i) => <li key={i} className="relative"><span className={`absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full ${e.kind === 'ticketed' ? 'bg-palm' : e.kind.includes('fail') ? 'bg-amber-500' : 'bg-brand-500'}`} /><p className="text-[0.92rem] text-ink">{EVENT_TEXT[e.kind] || e.kind}</p><p className="text-[0.75rem] text-slate-500">{when(e.created_at)} IST</p></li>)}
            </ol>
          </div>

          <div className={`${card} flex flex-wrap items-center justify-between gap-3 p-5`}>
            <p className="text-[0.92rem] text-slate-700">Need to change or cancel? Our Bengaluru desk handles it.</p>
            <div className="flex flex-wrap gap-2">
              <a className="btn btn-wa" href={waLink(`Hi, I need help with my flight booking ${b.order_ref}.`)} target="_blank" rel="noreferrer"><MessageCircle size={17} /> WhatsApp</a>
              <a className="btn btn-ghost" href={`tel:${BIZ.phone}`}><Phone size={17} /> {BIZ.phoneDisplay}</a>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// The last list we fetched, per signed-in e-mail, so coming back from a trip is instant (it still refreshes quietly).
// Cleared on sign out, so nothing of one customer's trips stays in memory for the next person on the device.
const TRIPS = new Map()

function Trips({ onOpen }) {
  const email = useAccount()?.profile?.email || ''
  const [rows, setRows] = useState(() => TRIPS.get(email) || null)
  const [err, setErr] = useState('')
  const load = useCallback(() => acct('bookings').then((r) => { TRIPS.set(email, r.bookings); setRows(r.bookings); setErr('') }).catch((e) => setErr(e.message)), [email])
  useEffect(() => { load() }, [load])
  const today = todayIst()
  const upcoming = (rows || []).filter((b) => ['ticketed', 'paid'].includes(b.status) && String(b.return_date || b.travel_date || '9999') >= today)
  const rest = (rows || []).filter((b) => !upcoming.includes(b))
  if (err) return <Err>{err}</Err>
  if (!rows) return <Loader2 className="mx-auto mt-6 animate-spin" />
  if (!rows.length) return (
    <div className={`${card} p-8 text-center`}>
      <Ticket className="mx-auto text-slate-400" size={40} />
      <h2 className="mt-3 font-display text-[1.3rem] font-bold text-ink">No trips yet</h2>
      <p className="mt-1 text-slate-600">Flights you book while signed in appear here, with their e-tickets.</p>
      <Link to="/book-flights" className="btn btn-gold mt-5">Book a flight</Link>
    </div>
  )
  return (
    <div className="grid gap-6">
      {upcoming.length > 0 && <section><h2 className="mb-2 font-display text-[1.15rem] font-bold text-ink">Upcoming trips</h2><ul className="grid gap-3">{upcoming.map((b) => <TripCard key={b.order_ref} b={b} onOpen={onOpen} />)}</ul></section>}
      {rest.length > 0 && <section><h2 className="mb-2 font-display text-[1.15rem] font-bold text-ink">{upcoming.length ? 'Past and other bookings' : 'Your bookings'}</h2><ul className="grid gap-3">{rest.map((b) => <TripCard key={b.order_ref} b={b} onOpen={onOpen} />)}</ul></section>}
    </div>
  )
}

function Profile() {
  const a = useAccount()
  const [f, setF] = useState({ name: a?.profile?.name || '', phone: a?.profile?.phone || '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr(''); setMsg('')
    try { setProfile({ ...a.profile, ...(await acct('profile', f)) }); setMsg('Saved.') } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={save} className={`${card} mx-auto grid max-w-md gap-4 p-6`}>
      <div><span className={label}>E-mail</span><p className="font-semibold text-ink">{a?.profile?.email}</p></div>
      <div><label className={label} htmlFor="p-name">Full name</label><input id="p-name" required minLength={2} maxLength={80} className={input} value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} /></div>
      <div><label className={label} htmlFor="p-phone">Mobile</label><input id="p-phone" type="tel" inputMode="tel" maxLength={20} className={input} value={f.phone} onChange={(e) => setF((x) => ({ ...x, phone: e.target.value }))} /></div>
      <Err>{err}</Err>{msg && <p role="status" className="text-[0.9rem] font-semibold text-palm">{msg}</p>}
      <button className="btn btn-gold" disabled={busy}>{busy ? <Loader2 size={17} className="animate-spin" /> : 'Save details'}</button>
      <p className="text-[0.78rem] text-slate-500">Your name and mobile are used to fill in the booking form. Travellers' names are always typed as on their ID.</p>
    </form>
  )
}

/* ---------------- the page ---------------- */

/** Supabase sends people back here from e-mail links with the result in the URL fragment (#access_token=..&type=recovery). */
function readHash() {
  const h = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : ''
  if (!h) return null
  const p = new URLSearchParams(h)
  if (!p.get('access_token') && !p.get('error')) return null
  return { token: p.get('access_token'), refresh: p.get('refresh_token'), expires: Number(p.get('expires_in')) || 3600, type: p.get('type'), error: p.get('error_description') || p.get('error') }
}

export default function Account() {
  const a = useAccount()
  const [view, setView] = useState('trips') // trips | profile
  const [open, setOpen] = useState(null)
  const [link, setLink] = useState(null) // result of an e-mail link
  const [linkMsg, setLinkMsg] = useState('')

  useEffect(() => {
    const m = document.createElement('meta')
    m.name = 'robots'; m.content = 'noindex, nofollow'
    document.head.appendChild(m)
    const prev = document.title
    document.title = 'My account | Pro Tours & Travel Solutions'
    return () => { m.remove(); document.title = prev }
  }, [])

  // opening a trip (or going back to the list) starts at the top, not wherever the last screen was scrolled to
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [open])

  useEffect(() => {
    const h = readHash()
    if (!h) return
    history.replaceState(null, '', window.location.pathname) // do not leave tokens in the address bar or history
    if (h.error) { setLinkMsg(/expired|invalid/i.test(h.error) ? 'That link has expired or was already used. Please request a new one.' : h.error.replace(/\+/g, ' ')); return }
    if (h.type === 'recovery') { setLink({ type: 'recovery', token: h.token }); return }
    // e-mail confirmation: the link signs the customer straight in
    storeSession({ accessToken: h.token, refreshToken: h.refresh, expiresIn: h.expires, profile: {} }, null)
    acct('me').then((p) => setProfile(p)).catch(() => {})
    setLinkMsg('Your e-mail is confirmed. Welcome aboard!')
  }, [])

  let body
  if (link?.type === 'recovery') body = <NewPassword token={link.token} onDone={() => setLink(null)} />
  else if (!a) body = <AuthForms notice={linkMsg} />
  else if (open) body = <TripDetail orderRef={open} onBack={() => setOpen(null)} />
  else body = view === 'profile' ? <Profile /> : <Trips onOpen={setOpen} />

  return (
    <section className="min-h-screen bg-paper pt-28 pb-20 md:pt-36">
      <div className="wrap max-w-3xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-[1.8rem] font-bold text-ink">{a && !link ? 'My trips' : 'My account'}</h1>
          {a && !link && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="hidden items-center gap-1.5 text-[0.88rem] text-slate-600 sm:inline-flex"><UserRound size={15} />{a.profile?.name || a.profile?.email}</span>
              <button type="button" className="btn btn-ghost !px-4 !py-2" onClick={() => { setOpen(null); TRIPS.clear(); signOut() }}><LogOut size={16} /> Sign out</button>
            </div>
          )}
        </div>
        {a && !link && !open && (
          <div className="mb-5 flex gap-1 rounded-xl bg-white p-1 shadow-sm" role="tablist" aria-label="Account sections">
            {[['trips', 'My trips'], ['profile', 'My details']].map(([id, l]) => <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)} className={`flex-1 rounded-lg px-3 py-2 text-[0.92rem] font-bold ${view === id ? 'bg-navy-950 text-white' : 'text-slate-700 hover:bg-sand'}`}>{l}</button>)}
          </div>
        )}
        {a && linkMsg && !link && <p role="status" className="mb-4 flex items-center gap-2 rounded-xl bg-palm/10 p-3 font-semibold text-palm"><CheckCircle2 size={18} />{linkMsg}</p>}
        {body}
      </div>
    </section>
  )
}
