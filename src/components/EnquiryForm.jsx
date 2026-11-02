import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { waLink, SERVICES } from '../data/site.js'

const SERVICE_OPTIONS = [...SERVICES.map((s) => s.title), 'Corporate Travel', 'Travel Insurance']

/** Saves a copy of the enquiry for our desk (the CRM). Never blocks or breaks the WhatsApp hand-off. */
function saveEnquiry(fields, trap) {
  const message = Object.entries(fields).filter(([k, v]) => v && !['Name', 'Mobile', 'Service'].includes(k)).map(([k, v]) => `${k}: ${v}`).join('\n')
  return fetch('/api/enquiry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({ name: fields.Name, phone: fields.Mobile, topic: fields.Service, message, page: window.location.pathname, consent: true, website: trap }),
  }).then((r) => r.ok).catch(() => false)
}

/** Off-screen field that people leave empty and bots fill in. */
const Trap = () => <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="pointer-events-none absolute -left-[9999px] h-0 w-0 opacity-0" />

/** WhatsApp glyph (lucide has no WhatsApp mark). */
const WaIcon = ({ size = 19 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.65-2.05-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35zM12.04 21.5h-.01a9.4 9.4 0 0 1-4.79-1.31l-.34-.2-3.56.93.95-3.47-.22-.36a9.38 9.38 0 0 1-1.44-5.01c0-5.19 4.23-9.41 9.42-9.41a9.36 9.36 0 0 1 9.41 9.42c0 5.19-4.23 9.41-9.42 9.41zM20.5 3.49A11.79 11.79 0 0 0 12.04 0C5.5 0 .18 5.32.18 11.86c0 2.09.55 4.13 1.59 5.93L.08 24l6.36-1.66a11.85 11.85 0 0 0 5.6 1.42h.01c6.54 0 11.86-5.32 11.86-11.86 0-3.17-1.23-6.15-3.41-8.41z" />
  </svg>
)

/* Plain, solid fields: sentence-case labels, a clear border, and a
   focus ring you can actually see. No frosted panels. */
const STYLE = {
  light: {
    label: 'mb-1.5 block font-display text-[0.98rem] font-bold text-navy-900',
    hint: 'font-sans text-[0.88rem] font-medium text-slate-500',
    field:
      'w-full rounded-lg border border-slate-300 bg-paper px-4 py-3 text-[1.05rem] text-ink placeholder:text-slate-500 outline-none ' +
      'transition-[border-color,box-shadow] duration-200 hover:border-slate-400 focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(15_94_158/0.18)]',
    foot: 'text-slate-500',
  },
  // For dark / photographic grounds: solid navy fields, ivory text.
  glass: {
    label: 'mb-1.5 block font-display text-[0.98rem] font-bold text-white',
    hint: 'font-sans text-[0.88rem] font-medium text-white/70',
    field:
      'w-full rounded-lg border border-white/30 bg-navy-900 px-4 py-3 text-[1.05rem] text-white placeholder:text-white/60 outline-none ' +
      'transition-[border-color,box-shadow] duration-200 hover:border-white/50 focus:border-gold-400 focus:shadow-[0_0_0_3px_rgb(245_188_72/0.25)] [&>option]:bg-navy-900',
    foot: 'text-white/75',
  },
}

/* Local calendar date as YYYY-MM-DD. Read in an effect, never during
   render: a pre-rendered page would otherwise bake in the build date and
   mismatch on hydration. */
const today = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Enquiry form. Serialises its fields into a formatted WhatsApp message and opens the chat; a copy is also
 * saved for our desk (the notice under the button says so, and the Privacy Policy covers it).
 * The WhatsApp hand-off never depends on the copy being saved.
 *
 * variant: 'glass' (on photography / navy) | 'light' (on paper or sand)
 * layout:  'bar' (single row, hero) | 'full' (stacked, contact pages)
 */
export default function EnquiryForm({ variant = 'light', layout = 'full', defaultService }) {
  const s = variant === 'glass' ? STYLE.glass : STYLE.light
  const uid = useId()
  const id = (name) => `${uid}-${name}`
  const [sent, setSent] = useState(false)
  const [minDate, setMinDate] = useState(undefined)
  useEffect(() => { setMinDate(today()) }, [])

  const submit = (e) => {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    const lines = [], fields = {}
    let trap = ''
    data.forEach((v, k) => {
      if (k === 'website') { trap = String(v); return }
      fields[k] = String(v).trim()
      if (String(v).trim()) lines.push(`${k}: ${v}`)
    })
    if (!lines.length) return

    const msg = `*New Enquiry — Pro Tours & Travel Solutions*\n\n${lines.join('\n')}`
    window.open(waLink(msg), '_blank', 'noopener,noreferrer') // first, inside the click, so it is not blocked as a pop-up
    saveEnquiry(fields, trap)
    setSent(true)
    setTimeout(() => setSent(false), 4000)
    form.reset()
  }

  if (layout === 'bar') {
    return (
      <form onSubmit={submit} className="relative grid gap-4 md:grid-cols-[1.1fr_1fr_1fr_auto] md:items-end">
        <Trap />
        <div className="min-w-0">
          <label className={s.label} htmlFor={id('service')}>What do you need?</label>
          <select id={id('service')} name="Service" autoComplete="off" className={s.field} defaultValue={defaultService}>
            {SERVICE_OPTIONS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div className="min-w-0">
          <label className={s.label} htmlFor={id('dest')}>Where to?</label>
          <input id={id('dest')} name="Destination" autoComplete="off" className={s.field} placeholder="Dubai, Makkah, Bali…" />
        </div>
        <div className="min-w-0">
          <label className={s.label} htmlFor={id('mob')}>Your mobile number</label>
          <input
            id={id('mob')} name="Mobile" type="tel" inputMode="tel" autoComplete="tel" required
            className={s.field} placeholder="10-digit number"
          />
        </div>
        <button type="submit" className="btn btn-wa h-[52px] w-full !px-6 md:w-auto">
          <WaIcon /> {sent ? 'Opening WhatsApp…' : 'Get a free quote'}
        </button>
        <p role="status" aria-live="polite" className="sr-only">{sent ? 'Opening WhatsApp with your enquiry.' : ''}</p>
        <p className={`text-[0.82rem] md:col-span-full ${s.foot}`}>
          By sending, you agree we also save your enquiry so our desk can follow up. <Link to="/privacy" className="underline">Privacy Policy</Link>
        </p>
      </form>
    )
  }

  return (
    <form onSubmit={submit} className="relative grid gap-5">
      <Trap />
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="min-w-0">
          <label className={s.label} htmlFor={id('name')}>Your name</label>
          <input
            id={id('name')} name="Name" type="text" required autoComplete="name" autoCapitalize="words"
            className={s.field} placeholder="Full name"
          />
        </div>
        <div className="min-w-0">
          <label className={s.label} htmlFor={id('mob')}>Mobile / WhatsApp</label>
          <input
            id={id('mob')} name="Mobile" type="tel" inputMode="tel" autoComplete="tel" required
            className={s.field} placeholder="10-digit number"
          />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="min-w-0">
          <label className={s.label} htmlFor={id('service')}>What do you need?</label>
          <select id={id('service')} name="Service" autoComplete="off" className={s.field} defaultValue={defaultService}>
            {SERVICE_OPTIONS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div className="min-w-0">
          <label className={s.label} htmlFor={id('trav')}>Who's travelling?</label>
          <select id={id('trav')} name="Travellers" autoComplete="off" className={s.field}>
            <option>1 adult</option><option>2 adults</option>
            <option>Family (3–5)</option><option>Group (6+)</option>
          </select>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="min-w-0">
          <label className={s.label} htmlFor={id('dest')}>
            Destination <span className={s.hint}>(if you know it)</span>
          </label>
          <input id={id('dest')} name="Destination" type="text" autoComplete="off" className={s.field} placeholder="e.g. Dubai, Makkah, Kerala" />
        </div>
        <div className="min-w-0">
          <label className={s.label} htmlFor={id('date')}>
            Travel date <span className={s.hint}>(roughly is fine)</span>
          </label>
          <input id={id('date')} name="Travel Date" type="date" min={minDate} autoComplete="off" className={s.field} />
        </div>
      </div>

      <div>
        <label className={s.label} htmlFor={id('msg')}>
          Anything else? <span className={s.hint}>(optional)</span>
        </label>
        <textarea
          id={id('msg')} name="Message" rows={4} autoComplete="off" className={`${s.field} resize-y`}
          placeholder="Budget, hotel preference, meal needs, who's coming…"
        />
      </div>

      <button type="submit" className="btn btn-wa mt-1 w-full">
        <WaIcon /> {sent ? 'Opening WhatsApp…' : 'Send on WhatsApp'}
      </button>

      <p role="status" aria-live="polite" className="sr-only">{sent ? 'Opening WhatsApp with your enquiry.' : ''}</p>

      <p className={`text-center text-[0.92rem] text-pretty ${s.foot}`}>
        This opens WhatsApp with your details filled in, so you can check them before sending. By pressing the button you
        also agree that we save your enquiry so our desk can follow up. See our <Link to="/privacy" className="underline">Privacy Policy</Link>.
      </p>
    </form>
  )
}
