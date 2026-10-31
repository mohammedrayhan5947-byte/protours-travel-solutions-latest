import { Check } from 'lucide-react'

import { AIRPORTS } from '../../../api/_lib/airports.js'

/* Helpers shared by every step of the flight-booking flow. */

export const AIRPORT_LIST = Object.entries(AIRPORTS).map(([code, a]) => ({ code, ...a }))
export const cityOf = (code) => AIRPORTS[code]?.city || code
export const airportName = (code) => AIRPORTS[code]?.name || ''

export const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
export const addDays = (iso, n) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10)
export const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
export const time = (s) => (s ? s.slice(11, 16) : '')
export const isoDay = (s) => (s ? s.slice(0, 10) : '')
const asDate = (s) => new Date(`${isoDay(s)}T00:00:00Z`)
export const dateLabel = (s) => (s ? asDate(s).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '')
export const longDate = (s) => (s ? asDate(s).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '')
export const weekday = (s) => (s ? asDate(s).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }) : '')
export const dayMonth = (s) => (s ? asDate(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '')
export const dur = (m) => `${Math.floor((m || 0) / 60)}h ${String((m || 0) % 60).padStart(2, '0')}m`
export const minutesBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 60000)
const hourOf = (s) => Number((s || '').slice(11, 13)) || 0

/** Departure-time buckets used by the filter. */
export const TIME_BUCKETS = [
  { id: 'early', label: 'Before 6 AM', test: (h) => h < 6 },
  { id: 'morning', label: '6 AM – 12 PM', test: (h) => h >= 6 && h < 12 },
  { id: 'afternoon', label: '12 PM – 6 PM', test: (h) => h >= 12 && h < 18 },
  { id: 'evening', label: 'After 6 PM', test: (h) => h >= 18 },
]
export const bucketOf = (s) => TIME_BUCKETS.find((b) => b.test(hourOf(s)))?.id

export async function api(action, payload, { signal } = {}) {
  const r = await fetch('/api/flights', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }), signal })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || 'Something went wrong. Please try again.')
  return data
}

export const ui = {
  input: 'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-[1rem] text-ink outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20',
  label: 'mb-1 block text-[0.78rem] font-bold tracking-wide text-slate-600 uppercase',
  card: 'rounded-2xl border border-slate-200 bg-white shadow-sm',
}

/** A round badge with the airline code (we have no logo licence, so no logos). */
export function AirlineMark({ code, size = 40 }) {
  const hue = [...String(code || 'X')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-full font-display font-bold text-white" style={{ width: size, height: size, background: `hsl(${hue} 55% 38%)`, fontSize: size * 0.34 }}>
      {String(code || '').slice(0, 2)}
    </span>
  )
}

export const STEPS = [
  { id: 'search', label: 'Search' },
  { id: 'results', label: 'Select flights' },
  { id: 'review', label: 'Review & travellers' },
  { id: 'pay', label: 'Payment' },
  { id: 'done', label: 'E-ticket' },
]

/** Progress indicator across the top, like the big booking sites. */
export function Stepper({ current }) {
  const at = STEPS.findIndex((s) => s.id === current)
  return (
    <ol className="flex items-center gap-1 overflow-x-auto py-3 text-[0.85rem]" aria-label="Booking progress">
      {STEPS.map((s, i) => {
        const done = i < at, on = i === at
        return (
          <li key={s.id} className="flex shrink-0 items-center gap-1" aria-current={on ? 'step' : undefined}>
            <span className={`grid h-6 w-6 place-items-center rounded-full text-[0.75rem] font-bold ${done ? 'bg-palm text-white' : on ? 'bg-gold-500 text-navy-950' : 'bg-white/15 text-white/70'}`}>
              {done ? <Check size={14} /> : i + 1}
            </span>
            <span className={`mr-2 font-semibold ${on ? 'text-white' : done ? 'text-white/85' : 'text-white/55'}`}>{s.label}</span>
            {i < STEPS.length - 1 && <span className="mr-1 h-px w-5 bg-white/25 md:w-8" />}
          </li>
        )
      })}
    </ol>
  )
}
