import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, CalendarDays, ChevronLeft, ChevronRight, Clock, Loader2, Minus, Plane, Plus, Trash2, Users } from 'lucide-react'

import { AIRPORT_LIST, plain, addDays, airportName, api, cityOf, dayMonth, inr, todayIso, ui, weekday } from './shared.jsx'

/* Search widget: from/to cards with a swap button, a fare calendar, travellers & class,
   popular routes and recent searches. Same payload as before: onSearch(form). */

const CABINS = [['economy', 'Economy'], ['premium', 'Premium economy'], ['business', 'Business'], ['first', 'First']]
const POPULAR = [['BLR', 'DEL'], ['BLR', 'BOM'], ['DEL', 'BOM'], ['BLR', 'HYD'], ['BLR', 'MAA'], ['DEL', 'DXB']].filter(([a, b]) => AIRPORT_LIST.some((x) => x.code === a) && AIRPORT_LIST.some((x) => x.code === b))
const RECENT_KEY = 'pt_recent_flights'

const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] } }
const saveRecent = (from, to) => {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([{ from, to }, ...readRecent().filter((r) => !(r.from === from && r.to === to))].slice(0, 4))) } catch { /* private mode */ }
}

function useOutside(ref, onClose) {
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', h)
    document.addEventListener('touchstart', h)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('touchstart', h) }
  }, [ref, onClose])
}

/* A big clickable card, the building block of the widget. */
function FieldCard({ caption, children, onClick, active, className = '', id }) {
  return (
    <button type="button" id={id} onClick={onClick} aria-expanded={!!active}
      className={`block w-full rounded-2xl border bg-white p-3.5 text-left transition hover:border-brand-500 ${active ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-slate-300'} ${className}`}>
      <span className="block text-[0.72rem] font-bold tracking-wide text-slate-500 uppercase">{caption}</span>
      {children}
    </button>
  )
}

/* ---------------- airport ---------------- */

function AirportCard({ id, caption, value, onChange, compact }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const ref = useRef(null)
  useOutside(ref, () => setOpen(false))
  useEffect(() => { if (open) setText('') }, [open])
  const matches = useMemo(() => {
    const t = plain(text.trim())
    if (!t) return AIRPORT_LIST.slice(0, 8)
    // best matches first: the code itself, a city that starts with what was typed, then city / airport / country anywhere
    const score = (a) => {
      const c = a.k.code, city = a.k.city
      if (c === t) return 0
      if (city.startsWith(t)) return 1
      if (c.startsWith(t)) return 2
      if (city.includes(t)) return 3
      if (a.k.name.includes(t)) return 4
      if (a.k.country.startsWith(t)) return 5
      return 9
    }
    return AIRPORT_LIST.map((a, i) => [score(a), i, a]).filter((x) => x[0] < 9).sort((x, y) => x[0] - y[0] || x[1] - y[1]).slice(0, 8).map((x) => x[2])
  }, [text])
  return (
    <div className="relative" ref={ref}>
      <FieldCard id={id} caption={caption} active={open} onClick={() => setOpen((o) => !o)}>
        <span className={`mt-0.5 block truncate font-display font-bold text-ink ${compact ? 'text-[1.1rem]' : 'text-[1.5rem] leading-tight'}`}>{value ? cityOf(value) : 'Select city'}</span>
        <span className="block truncate text-[0.82rem] text-slate-500">{value ? `${value}, ${airportName(value)}` : 'City or airport'}</span>
      </FieldCard>
      {open && (
        <div className="absolute left-0 z-30 mt-2 w-[min(22rem,92vw)] rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
          <input autoFocus className={ui.input} placeholder="Type a city, airport or code" value={text} onChange={(e) => setText(e.target.value)} aria-label={`${caption} airport`} />
          <ul className="mt-1 max-h-64 overflow-auto">
            {matches.map((a) => (
              <li key={a.code}>
                <button type="button" className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-sand"
                  onClick={() => { onChange(a.code); setOpen(false) }}>
                  <span className="min-w-0"><span className="block truncate font-semibold text-ink">{a.city}</span><span className="block truncate text-[0.8rem] text-slate-500">{a.name}{a.countryName && a.country !== "IN" ? `, ${a.countryName}` : ""}</span></span>
                  <span className="font-mono font-bold text-navy-900">{a.code}</span>
                </button>
              </li>
            ))}
            {!matches.length && <li className="px-3 py-3 text-[0.9rem] text-slate-500">No airport found.</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ---------------- fare calendar ---------------- */

const fareCache = new Map() // `${from}-${to}-${yyyy-mm}` -> { 'yyyy-mm-dd': price }

export function useMonthFares(from, to, ym, enabled = true) {
  const key = `${from}-${to}-${ym}`
  const [fares, setFares] = useState(() => fareCache.get(key) || null)
  useEffect(() => {
    if (!enabled || !from || !to || from === to) { setFares(null); return }
    if (fareCache.has(key)) { setFares(fareCache.get(key)); return }
    let live = true
    setFares(null)
    const first = `${ym}-01` < todayIso() ? todayIso() : `${ym}-01`
    api('calendar', { from, to, date: first })
      .then((r) => {
        const m = {}
        for (const d of r.days || []) m[String(d.date).slice(0, 10)] = d.price
        fareCache.set(key, m)
        if (live) setFares(m)
      })
      .catch(() => { fareCache.set(key, {}); if (live) setFares({}) }) // no fares: the calendar still works
    return () => { live = false }
  }, [key, from, to, ym, enabled])
  return fares
}

function Calendar({ value, min, onPick, from, to }) {
  const [ym, setYm] = useState((value || todayIso()).slice(0, 7))
  const fares = useMonthFares(from, to, ym)
  const [y, m] = ym.split('-').map(Number)
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cheapest = fares ? Math.min(...Object.values(fares).filter(Boolean), Infinity) : Infinity
  const shift = (n) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); setYm(d.toISOString().slice(0, 7)) }
  const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const canPrev = `${ym}-01` > min.slice(0, 7) + '-01'
  return (
    <div className="w-[min(21rem,92vw)]">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" aria-label="Previous month" disabled={!canPrev} className="grid h-9 w-9 place-items-center rounded-full hover:bg-sand disabled:opacity-30" onClick={() => shift(-1)}><ChevronLeft size={18} /></button>
        <p className="font-display font-bold text-ink">{title}</p>
        <button type="button" aria-label="Next month" className="grid h-9 w-9 place-items-center rounded-full hover:bg-sand" onClick={() => shift(1)}><ChevronRight size={18} /></button>
      </div>
      <div className="grid grid-cols-7 text-center text-[0.7rem] font-bold text-slate-500">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i} className="py-1">{d}</span>)}</div>
      <div className="grid grid-cols-7 gap-y-1">
        {Array.from({ length: lead }).map((_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: days }).map((_, i) => {
          const iso = `${ym}-${String(i + 1).padStart(2, '0')}`
          const off = iso < min
          const price = fares?.[iso]
          const sel = iso === value
          return (
            <button key={iso} type="button" disabled={off} onClick={() => onPick(iso)} aria-label={`${dayMonth(iso)}${price ? `, from ${inr(price)}` : ''}`} aria-pressed={sel}
              className={`mx-auto flex h-12 w-11 flex-col items-center justify-center rounded-lg text-[0.92rem] ${sel ? 'bg-navy-950 font-bold text-white' : off ? 'text-slate-300' : 'text-ink hover:bg-sand'}`}>
              <span>{i + 1}</span>
              {price ? <span className={`text-[0.6rem] leading-none font-semibold ${sel ? 'text-gold-400' : price === cheapest ? 'text-palm' : 'text-slate-500'}`}>{inr(price).replace('₹', '')}</span> : <span className="h-[0.6rem]" />}
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-[0.72rem] text-slate-500">{fares === null && from && to ? 'Loading fares…' : Object.keys(fares || {}).length ? 'Lowest one-way fare per day for 1 adult. Green = cheapest this month.' : 'Pick the airports first to see fares on the calendar.'}</p>
    </div>
  )
}

function DateCard({ caption, value, min, onPick, from, to, empty, onEmpty, id }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useOutside(ref, () => setOpen(false))
  if (empty) {
    return (
      <FieldCard id={id} caption={caption} className="bg-sand/60 text-slate-500" onClick={onEmpty}>
        <span className="mt-0.5 block text-[1rem] font-semibold">Tap to add a return date</span>
        <span className="block text-[0.82rem]">Book a round trip and save time</span>
      </FieldCard>
    )
  }
  return (
    <div className="relative" ref={ref}>
      <FieldCard id={id} caption={caption} active={open} onClick={() => setOpen((o) => !o)}>
        <span className="mt-0.5 flex items-baseline gap-1.5"><span className="font-display text-[1.5rem] leading-tight font-bold text-ink">{dayMonth(value)}</span><span className="text-[0.9rem] text-slate-500">{value.slice(0, 4)}</span></span>
        <span className="flex items-center gap-1 text-[0.82rem] text-slate-500"><CalendarDays size={13} /> {new Date(`${value}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' })}</span>
      </FieldCard>
      {open && (
        <div className="absolute right-0 z-30 mt-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl md:left-0 md:right-auto">
          <Calendar value={value} min={min} from={from} to={to} onPick={(d) => { onPick(d); setOpen(false) }} />
        </div>
      )}
    </div>
  )
}

/* ---------------- travellers & class ---------------- */

function Counter({ label, hint, value, min, max, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div><p className="font-semibold text-ink">{label}</p><p className="text-[0.8rem] text-slate-500">{hint}</p></div>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)} className="grid h-9 w-9 place-items-center rounded-full border border-slate-300 disabled:opacity-35"><Minus size={16} /></button>
        <span className="w-6 text-center font-bold">{value}</span>
        <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)} className="grid h-9 w-9 place-items-center rounded-full border border-slate-300 disabled:opacity-35"><Plus size={16} /></button>
      </div>
    </div>
  )
}

function TravellersCard({ pax, setPax, cabin, setCabin }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useOutside(ref, () => setOpen(false))
  const n = pax.adults + pax.children + pax.infants
  const cabinLabel = CABINS.find(([v]) => v === cabin)?.[1]
  return (
    <div className="relative" ref={ref}>
      <FieldCard id="travellers" caption="Travellers & class" active={open} onClick={() => setOpen((o) => !o)}>
        <span className="mt-0.5 flex items-baseline gap-1.5"><span className="font-display text-[1.5rem] leading-tight font-bold text-ink">{n}</span><span className="text-[0.95rem] font-semibold text-ink">Traveller{n > 1 ? 's' : ''}</span></span>
        <span className="block truncate text-[0.82rem] text-slate-500">{cabinLabel}</span>
      </FieldCard>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[min(22rem,92vw)] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
          <Counter label="Adults" hint="12 years and above" value={pax.adults} min={1} max={9 - pax.children} onChange={(v) => setPax((p) => ({ ...p, adults: v, infants: Math.min(p.infants, v) }))} />
          <Counter label="Children" hint="2 – 11 years" value={pax.children} min={0} max={9 - pax.adults} onChange={(v) => setPax((p) => ({ ...p, children: v }))} />
          <Counter label="Infants" hint="Under 2 years, on an adult's lap" value={pax.infants} min={0} max={pax.adults} onChange={(v) => setPax((p) => ({ ...p, infants: v }))} />
          <p className="mt-3 mb-2 text-[0.72rem] font-bold tracking-wide text-slate-500 uppercase">Travel class</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Travel class">
            {CABINS.map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={cabin === v} onClick={() => setCabin(v)}
                className={`rounded-full border px-3.5 py-1.5 text-[0.88rem] font-semibold ${cabin === v ? 'border-navy-950 bg-navy-950 text-white' : 'border-slate-300 text-ink hover:border-slate-500'}`}>{l}</button>
            ))}
          </div>
          <button type="button" className="btn btn-brand mt-4 w-full" onClick={() => setOpen(false)}>Apply</button>
        </div>
      )}
    </div>
  )
}

/* ---------------- the widget ---------------- */

export default function SearchWidget({ initial, onSearch, busy, submitLabel = 'Search flights', onCancel }) {
  const t = todayIso()
  const [journeyType, setJourney] = useState(initial?.journeyType || 'oneway')
  const [segs, setSegs] = useState(initial?.segments?.length ? initial.segments : [{ from: 'BLR', to: '', date: addDays(t, 7) }])
  const [returnDate, setReturn] = useState(initial?.returnDate || addDays(t, 12))
  const [pax, setPax] = useState(initial ? { adults: initial.adults, children: initial.children, infants: initial.infants } : { adults: 1, children: 0, infants: 0 })
  const [cabin, setCabin] = useState(initial?.cabin || 'economy')
  const [directOnly, setDirect] = useState(!!initial?.directOnly)
  const [msg, setMsg] = useState('')
  const [recent] = useState(readRecent)

  const setSeg = (i, k, v) => setSegs((s) => s.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  const setType = (jt) => {
    setJourney(jt)
    if (jt === 'multicity' && segs.length < 2) setSegs((s) => [...s, { from: s[0].to, to: '', date: addDays(s[0].date, 3) }])
    if (jt !== 'multicity') setSegs((s) => s.slice(0, 1))
    if (jt === 'return' && returnDate < segs[0].date) setReturn(addDays(segs[0].date, 5))
  }
  const swap = (i) => setSegs((x) => x.map((y, j) => (j === i ? { ...y, from: y.to, to: y.from } : y)))
  const setDepart = (d) => {
    setSeg(0, 'date', d)
    if (journeyType === 'return' && returnDate < d) setReturn(addDays(d, 5))
  }
  const applyRoute = (from, to) => { setSegs((s) => [{ ...s[0], from, to }, ...s.slice(1)]); if (journeyType === 'multicity') setJourney('oneway') }

  const submit = (e) => {
    e.preventDefault()
    setMsg('')
    if (segs.some((s) => !s.from || !s.to)) return setMsg('Choose where you are flying from and to.')
    if (segs.some((s) => s.from === s.to)) return setMsg('From and To must be different.')
    if (pax.infants > pax.adults) return setMsg('Each infant must travel with an adult.')
    saveRecent(segs[0].from, segs[0].to)
    onSearch({ journeyType, segments: segs, returnDate: journeyType === 'return' ? returnDate : undefined, ...pax, cabin, directOnly })
  }

  const first = segs[0]
  return (
    <form onSubmit={submit} className="rounded-3xl bg-white p-4 text-ink shadow-xl md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Trip type">
          {[['oneway', 'One way'], ['return', 'Round trip'], ['multicity', 'Multi-city']].map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={journeyType === v} onClick={() => setType(v)}
              className={`rounded-full px-4 py-1.5 text-[0.92rem] font-bold ${journeyType === v ? 'bg-navy-950 text-white' : 'bg-sand text-navy-900 hover:bg-slate-200'}`}>{l}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[0.9rem] font-semibold text-slate-700"><input type="checkbox" checked={directOnly} onChange={(e) => setDirect(e.target.checked)} className="h-4.5 w-4.5" /> Non-stop only</label>
      </div>

      {journeyType !== 'multicity' ? (
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_1fr_0.8fr_0.8fr_0.8fr] md:items-stretch">
          <AirportCard id="from0" caption="From" value={first.from} onChange={(v) => setSeg(0, 'from', v)} />
          <div className="relative flex items-center justify-center md:w-0">
            <button type="button" aria-label="Swap from and to" onClick={() => swap(0)} className="z-10 grid h-10 w-10 place-items-center rounded-full border border-slate-300 bg-white text-brand-500 shadow hover:bg-sand md:-mx-5"><ArrowLeftRight size={18} /></button>
          </div>
          <AirportCard id="to0" caption="To" value={first.to} onChange={(v) => setSeg(0, 'to', v)} />
          <DateCard id="depart" caption="Departure" value={first.date} min={todayIso()} from={first.from} to={first.to} onPick={setDepart} />
          <DateCard id="return" caption="Return" value={returnDate} min={first.date} from={first.to} to={first.from} empty={journeyType !== 'return'} onEmpty={() => setType('return')} onPick={setReturn} />
          <TravellersCard pax={pax} setPax={setPax} cabin={cabin} setCabin={setCabin} />
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          {segs.map((s, i) => (
            <div key={i} className="grid gap-3 md:grid-cols-[1fr_auto_1fr_0.8fr_auto] md:items-stretch">
              <AirportCard id={`from${i}`} caption={`Flight ${i + 1} from`} compact value={s.from} onChange={(v) => setSeg(i, 'from', v)} />
              <button type="button" aria-label="Swap" onClick={() => swap(i)} className="hidden self-center rounded-full border border-slate-300 p-2.5 text-brand-500 md:block"><ArrowLeftRight size={16} /></button>
              <AirportCard id={`to${i}`} caption="To" compact value={s.to} onChange={(v) => setSeg(i, 'to', v)} />
              <DateCard id={`d${i}`} caption="Date" value={s.date} min={i ? segs[i - 1].date : todayIso()} from={s.from} to={s.to} onPick={(d) => setSeg(i, 'date', d)} />
              {i > 1 ? <button type="button" aria-label="Remove flight" className="grid h-11 w-11 place-items-center self-center rounded-full text-red-600 hover:bg-red-50" onClick={() => setSegs((x) => x.filter((_, j) => j !== i))}><Trash2 size={18} /></button> : <span className="hidden w-11 md:block" />}
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {segs.length < 5 ? <button type="button" className="inline-flex items-center gap-2 font-bold text-brand-500" onClick={() => setSegs((x) => [...x, { from: x.at(-1).to, to: '', date: addDays(x.at(-1).date, 3) }])}><Plus size={18} /> Add another flight</button> : <span />}
            <div className="w-full md:w-64"><TravellersCard pax={pax} setPax={setPax} cabin={cabin} setCabin={setCabin} /></div>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[0.85rem]">
          {recent.length > 0 && <><span className="inline-flex items-center gap-1 font-semibold text-slate-500"><Clock size={14} /> Recent</span>{recent.map((r) => (
            <button key={`${r.from}${r.to}`} type="button" className="rounded-full border border-slate-300 px-3 py-1 font-semibold hover:border-brand-500" onClick={() => applyRoute(r.from, r.to)}>{r.from} → {r.to}</button>
          ))}</>}
          <span className="ml-1 font-semibold text-slate-500">Popular</span>
          {POPULAR.slice(0, 4).map(([a, b]) => (
            <button key={a + b} type="button" className="rounded-full bg-sand px-3 py-1 font-semibold text-navy-900 hover:bg-slate-200" onClick={() => applyRoute(a, b)}>{cityOf(a)} → {cityOf(b)}</button>
          ))}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        {msg && <p role="alert" className="w-full text-center text-[0.95rem] font-semibold text-red-700">{msg}</p>}
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
        <button className="btn btn-gold min-w-64 px-10 py-3.5 text-[1.1rem] uppercase" disabled={busy}>
          {busy ? <><Loader2 className="animate-spin" size={20} /> Searching flights…</> : <><Plane size={20} /> {submitLabel}</>}
        </button>
      </div>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-[0.78rem] text-slate-500"><Users size={13} /> Prices include all taxes. Fare rules are shown before you pay.</p>
    </form>
  )
}
