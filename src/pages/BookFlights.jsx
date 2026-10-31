import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, BadgeCheck, Headset, Loader2, Plane, ShieldCheck } from 'lucide-react'

import { BIZ, waLink } from '../data/site.js'
import SearchWidget from './flights/Search.jsx'
import { Stepper, api } from './flights/shared.jsx'

const Results = lazy(() => import('./flights/Results.jsx'))
const Review = lazy(() => import('./flights/Review.jsx'))
const Done = lazy(() => import('./flights/Done.jsx'))

/*
 * Online flight booking on TBO's Air API, laid out like the big booking sites:
 *   search → select flights (filters, fare strip) → review & travellers → payment → e-ticket.
 * Everything that talks to TBO runs in /api/flights; this page only holds the sealed session
 * tokens the server hands back. The browser Back button walks the steps.
 */

function razorpay(c, contact) {
  return new Promise((resolve, reject) => {
    const open = () => {
      const rz = new window.Razorpay({
        key: c.payment.keyId,
        order_id: c.payment.orderId,
        amount: c.payment.amountPaise,
        currency: 'INR',
        name: BIZ.name,
        description: `Flight booking ${c.orderRef}`,
        prefill: { email: contact.email, contact: contact.phone },
        theme: { color: '#0b2545' },
        handler: (r) => resolve({ orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }),
        modal: { ondismiss: () => reject(new Error('Payment was cancelled. Nothing has been booked.')) },
      })
      rz.on('payment.failed', (r) => reject(new Error(r.error?.description || 'Payment failed. Nothing has been booked.')))
      rz.open()
    }
    if (window.Razorpay) return open()
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = open
    s.onerror = () => reject(new Error('Could not load the payment window. Check your connection.'))
    document.body.appendChild(s)
  })
}

export default function BookFlights() {
  const [status, setStatus] = useState(null) // { enabled, live }
  useEffect(() => {
    fetch('/api/flights').then((r) => r.json()).then(setStatus).catch(() => setStatus({ enabled: false }))
  }, [])

  const [step, setStep] = useState('search')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState(null)
  const [found, setFound] = useState(null)
  const [searchedAt, setSearchedAt] = useState(0)
  const [picked, setPicked] = useState([])
  const [q, setQ] = useState(null)
  const [done, setDone] = useState(null)

  /* history: every step is a history entry, so Back/Forward behave like a normal site */
  const go = useCallback((s) => {
    window.history.pushState({ flightStep: s }, '')
    setStep(s)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [])
  useEffect(() => { window.history.replaceState({ flightStep: 'search' }, '') }, [])
  useEffect(() => {
    const onPop = (e) => {
      const s = e.state?.flightStep || 'search'
      setError('')
      setStep(s === 'done' ? 'search' : s) // never step back into a finished payment
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  // a step whose data is gone (reload, expired) falls back to the one before it
  const view = step === 'results' && !found ? 'search' : step === 'review' && !q ? (found ? 'results' : 'search') : step === 'done' && !done ? 'search' : step

  const run = async (what, fn) => {
    setError('')
    setBusy(what)
    try {
      await fn()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  const search = (f) =>
    run('search', async () => {
      const r = await api('search', f)
      setForm(f)
      setFound(r)
      setQ(null)
      setPicked(r.lists.map(() => null))
      setSearchedAt(Date.now())
      if (view !== 'results') go('results')
      else window.scrollTo({ top: 0, behavior: 'smooth' })
    })

  const book = (picks) =>
    run('quote', async () => {
      const r = await api('quote', { session: found.session, resultIndexes: picks.map((p) => p.resultIndex) })
      setQ(r)
      go('review')
    })

  const pay = (details) =>
    run('pay', async () => {
      const c = await api('checkout', { quote: q.quote, ...details })
      const payment = c.payment.mode === 'razorpay' ? await razorpay(c, details.contact) : { orderId: c.payment.orderId }
      setBusy('ticket')
      const t = await api('ticket', { checkout: c.checkout, payment })
      // the booking is finished: drop everything that could be paid for twice, so Back never returns to the payment page
      setQ(null); setFound(null); setPicked([])
      setDone({ ...t, contactEmail: details.contact.email })
      go('done')
    })

  const startOver = () => { setDone(null); setQ(null); setFound(null); setForm(null); setPicked([]); go('search') }
  const onSearchPage = view === 'search'

  return (
    <>
      <section className={`bg-navy-950 text-white ${onSearchPage ? 'pt-28 pb-24 md:pt-36 md:pb-28' : 'pt-24 pb-4 md:pt-28'}`}>
        <div className="wrap">
          {onSearchPage ? (
            <>
              <p className="eyebrow eyebrow-light">Book flights online</p>
              <h1 className="mt-3 font-display text-[2rem] leading-tight font-bold md:text-[2.9rem]">Where are you flying next?</h1>
              <p className="mt-3 max-w-2xl text-white/80">Domestic and international fares on live airline systems, ticketed instantly through our IATA-accredited desk in Bengaluru.</p>
            </>
          ) : (
            <h1 className="sr-only">Book flights online</h1>
          )}
          {status && !status.live && status.enabled && (
            <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-gold-500/15 px-4 py-1.5 text-[0.88rem] font-semibold text-gold-400"><AlertTriangle size={16} /> Test mode: bookings here use TBO's test system and are not real tickets.</p>
          )}
          <Stepper current={view === 'search' ? 'search' : view} />
        </div>
      </section>

      <section className={`bg-paper ${onSearchPage ? 'pb-14' : 'pt-6 pb-12'}`}>
        <div className="wrap">
          {status && !status.enabled ? (
            <Offline />
          ) : (
            <>
              {error && (
                <div role="alert" className={`mb-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800 ${onSearchPage ? '-mt-14 md:-mt-16' : ''}`}>
                  <AlertTriangle size={20} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold">{error}</p>
                    <p className="mt-1 text-[0.92rem]">Need help? Call <a className="font-bold underline" href={`tel:${BIZ.phone}`}>{BIZ.phoneDisplay}</a> or <a className="font-bold underline" href={waLink('Hi, I need help booking a flight.')}>WhatsApp us</a>.</p>
                  </div>
                </div>
              )}

              {view === 'search' && (
                <div className={error ? '' : '-mt-14 md:-mt-16'}>
                  <SearchWidget initial={form} busy={busy === 'search'} onSearch={search} />
                  <ul className="mt-8 grid gap-4 text-[0.95rem] text-slate-700 md:grid-cols-3">
                    {[[BadgeCheck, 'Live airline fares', 'The price you see is the price you pay: all taxes included, no hidden convenience fee.'],
                      [ShieldCheck, 'Rules before you pay', 'Baggage, cancellation and date-change rules are shown on the review page.'],
                      [Headset, 'A real desk behind it', 'Our Bengaluru team helps before and after you fly. Call or WhatsApp any time.']].map(([Icon, t, d]) => (
                      <li key={t} className="flex gap-3 rounded-2xl bg-white p-4 shadow-sm"><Icon className="mt-0.5 shrink-0 text-brand-500" size={22} /><span><strong className="block text-ink">{t}</strong>{d}</span></li>
                    ))}
                  </ul>
                </div>
              )}

              <Suspense fallback={<p className="flex items-center justify-center gap-2 py-16 text-slate-600"><Loader2 className="animate-spin" size={18} /> Loading…</p>}>
                {view === 'results' && found && (
                  <Results found={found} form={form} picked={picked} setPicked={setPicked} busy={busy === 'quote'} searching={busy === 'search'} onBook={book} onSearchAgain={search} />
                )}
                {view === 'review' && q && <Review q={q} searchedAt={searchedAt} busy={busy} onBack={() => window.history.back()} onPay={pay} />}
                {view === 'done' && done && <Done done={done} contactEmail={done.contactEmail} onNew={startOver} />}
              </Suspense>
            </>
          )}
        </div>
      </section>

      {!status || status.enabled ? (
        <p className="bg-paper px-5 pb-28 text-center text-[0.92rem] text-slate-600 lg:pb-10">
          Need help booking? Call <a className="font-bold text-navy-900 underline" href={`tel:${BIZ.phone}`}>{BIZ.phoneDisplay}</a> or <a className="font-bold text-navy-900 underline" href={waLink('Hi, I need help booking a flight.')}>WhatsApp our desk</a>.
        </p>
      ) : null}

      {(busy === 'pay' || busy === 'ticket') && <Processing stage={busy} />}
      {busy === 'search' && view === 'results' && <p role="status" className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full bg-navy-950 px-5 py-2.5 text-[0.9rem] font-semibold text-white shadow-xl"><Loader2 className="mr-2 inline animate-spin" size={16} />Searching flights…</p>}
    </>
  )
}

function Processing({ stage }) {
  return (
    <div role="alertdialog" aria-modal="true" aria-label="Processing your booking" className="fixed inset-0 z-50 grid place-items-center bg-navy-950/85 p-5 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-2xl">
        <Loader2 className="mx-auto animate-spin text-brand-500" size={44} />
        <h2 className="mt-4 font-display text-[1.4rem] font-bold text-ink">{stage === 'pay' ? 'Opening secure payment…' : 'Payment received. Issuing your ticket…'}</h2>
        <p className="mt-2 text-slate-600">{stage === 'pay' ? 'Please complete the payment in the window that opens.' : 'The airline is confirming your seats. This can take up to a minute.'}</p>
        <p className="mt-4 rounded-xl bg-gold-500/15 px-4 py-2.5 text-[0.9rem] font-semibold text-navy-900">Please don't close, refresh or go back until this finishes.</p>
      </div>
    </div>
  )
}

function Offline() {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center md:p-10">
      <Plane className="mx-auto text-brand-500" size={40} />
      <h2 className="mt-3 font-display text-[1.6rem] font-bold text-ink">Online booking is coming soon</h2>
      <p className="mx-auto mt-2 max-w-xl text-slate-600">Until then, send us your route and dates and we'll reply with fare options.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <a className="btn btn-wa" href={waLink('Hi, I want to book a flight: from __ to __ on __ for __ travellers.')}>WhatsApp us</a>
        <Link className="btn btn-ghost" to="/flights-hotels">Flights &amp; hotels desk</Link>
      </div>
    </div>
  )
}
