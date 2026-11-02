import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, BadgeCheck, Check, ChevronDown, ChevronUp, Filter, Loader2, Luggage, Pencil, Plane, RotateCcw, Users, X } from 'lucide-react'

import SearchWidget, { useMonthFares } from './Search.jsx'
import { addDays, AirlineMark, bucketOf, cityOf, dateLabel, dayMonth, dur, inr, minutesBetween, time, TIME_BUCKETS, todayIso, weekday } from './shared.jsx'

/* Results: modify-search bar, ±3-day fare strip, filters, sort tabs, expandable flight cards
   and a sticky "book" bar for round trips. All filtering/sorting happens in the browser on the
   results the server already returned, so it is instant. */

const totalMin = (r) => r.journeys.reduce((m, j) => m + j.minutes, 0)
const maxStops = (r) => Math.max(...r.journeys.map((j) => j.stops))
const priceOf = (r) => (r.price == null ? Infinity : r.price)
const score = (r) => priceOf(r) + totalMin(r) * 8 + maxStops(r) * 600 // rupee-equivalent of price + time + stops

const SORTS = [
  { id: 'best', label: 'Best value', hint: 'Price, travel time and stops together', fn: (a, b) => score(a) - score(b) },
  { id: 'cheapest', label: 'Cheapest', hint: 'Lowest fare first', fn: (a, b) => priceOf(a) - priceOf(b) },
  { id: 'fastest', label: 'Fastest', hint: 'Shortest journey first', fn: (a, b) => totalMin(a) - totalMin(b) },
  { id: 'earliest', label: 'Earliest', hint: 'Earliest departure first', fn: (a, b) => a.journeys[0].dep.localeCompare(b.journeys[0].dep) },
]
const STOP_OPTIONS = [{ id: 0, label: 'Non-stop' }, { id: 1, label: '1 stop' }, { id: 2, label: '2+ stops' }]
const EMPTY = { stops: [], airlines: [], times: [], maxPrice: null, refundable: false }

/* TBO returns every fare for a flight as its own result. Fold them into one card per flight: cheapest first, the rest behind "more fares". */
const flightKey = (r) => r.journeys.map((j) => `${j.flights.map((g) => g.code + g.number).join('+')}@${j.dep}`).join('|')
function groupFares(rows) {
  const m = new Map()
  for (const r of rows) { const k = flightKey(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r) }
  return [...m.values()].map((g) => g.slice().sort((a, b) => (a.price ?? 1e12) - (b.price ?? 1e12)))
}

const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])
const stopBucket = (r) => Math.min(2, maxStops(r))

function matches(r, f) {
  if (f.stops.length && !f.stops.includes(stopBucket(r))) return false
  if (f.airlines.length && !f.airlines.includes(r.airline)) return false
  if (f.times.length && !f.times.includes(bucketOf(r.journeys[0].dep))) return false
  if (f.maxPrice != null && priceOf(r) > f.maxPrice) return false
  if (f.refundable && !r.refundable) return false
  return true
}

/* ---------------- date strip ---------------- */

function DateStrip({ from, to, date, onPick }) {
  const t = todayIso()
  const start = date > addDays(t, 3) ? addDays(date, -3) : t
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const ym1 = days[0].slice(0, 7), ym2 = days[6].slice(0, 7)
  const f1 = useMonthFares(from, to, ym1)
  const f2 = useMonthFares(from, to, ym2, ym2 !== ym1)
  const fare = (d) => (d.slice(0, 7) === ym1 ? f1 : f2)?.[d]
  if (f1 && !Object.keys(f1).length && (!f2 || !Object.keys(f2).length)) return null // no calendar data: hide quietly
  return (
    <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const on = d === date, p = fare(d)
          return (
            <button key={d} type="button" onClick={() => !on && onPick(d)} aria-current={on ? 'date' : undefined}
              className={`rounded-xl px-1 py-2 text-center transition ${on ? 'bg-navy-950 text-white' : 'hover:bg-sand'}`}>
              <span className={`block text-[0.7rem] font-semibold ${on ? 'text-white/70' : 'text-slate-500'}`}>{weekday(d)}</span>
              <span className="block text-[0.88rem] font-bold">{dayMonth(d)}</span>
              <span className={`block text-[0.75rem] font-semibold ${on ? 'text-gold-400' : 'text-palm'}`}>{p ? inr(p) : f1 === null ? '…' : '—'}</span>
            </button>
          )
        })}
      </div>
      <p className="mt-1 px-1 text-[0.7rem] text-slate-500">Lowest fares shown for 1 adult. Tap a date to search it.</p>
    </div>
  )
}

/* ---------------- filters ---------------- */

function Facet({ title, children }) {
  return <div role="group" aria-label={title} className="border-t border-slate-200 py-3 first:border-t-0"><p className="mb-2 text-[0.8rem] font-bold tracking-wide text-slate-600 uppercase">{title}</p>{children}</div>
}

function Filters({ f, setF, facets, onReset, active }) {
  const check = (key, on, onChange, label, right) => (
    <label key={key} className="flex cursor-pointer items-center justify-between gap-2 py-1 text-[0.92rem]">
      <span className="flex min-w-0 items-center gap-2"><input type="checkbox" className="h-4 w-4 shrink-0" checked={on} onChange={onChange} /><span className="truncate">{label}</span></span>
      {right != null && <span className="shrink-0 text-[0.8rem] text-slate-500">{right}</span>}
    </label>
  )
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <p className="font-display text-[1.05rem] font-bold text-ink">Filters</p>
        {active > 0 && <button type="button" className="inline-flex items-center gap-1 text-[0.85rem] font-bold text-brand-500" onClick={onReset}><RotateCcw size={14} /> Reset ({active})</button>}
      </div>
      <Facet title="Stops">{STOP_OPTIONS.map((o) => facets.stops[o.id] != null && check(o.id, f.stops.includes(o.id), () => setF({ ...f, stops: toggle(f.stops, o.id) }), o.label, inr(facets.stops[o.id])))}</Facet>
      <Facet title="Departure time">{TIME_BUCKETS.map((b) => check(b.id, f.times.includes(b.id), () => setF({ ...f, times: toggle(f.times, b.id) }), b.label, facets.times[b.id] != null ? inr(facets.times[b.id]) : null))}</Facet>
      <Facet title="Airlines">{facets.airlines.map(([name, min]) => check(name, f.airlines.includes(name), () => setF({ ...f, airlines: toggle(f.airlines, name) }), name, inr(min)))}</Facet>
      <Facet title="Price">
        <input type="range" aria-label="Maximum price" className="w-full accent-brand-500" min={facets.min} max={facets.max} step={100} value={f.maxPrice ?? facets.max} onChange={(e) => setF({ ...f, maxPrice: Number(e.target.value) >= facets.max ? null : Number(e.target.value) })} />
        <p className="flex justify-between text-[0.8rem] text-slate-600"><span>{inr(facets.min)}</span><strong>up to {inr(f.maxPrice ?? facets.max)}</strong></p>
      </Facet>
      <Facet title="Fare type">{check('refundable', f.refundable, () => setF({ ...f, refundable: !f.refundable }), 'Refundable only')}</Facet>
    </div>
  )
}

/* ---------------- flight card ---------------- */

function Journey({ j, compact }) {
  const via = j.flights.slice(0, -1).map((g) => g.to).join(', ')
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 md:gap-5">
      <div><p className="font-display text-[1.35rem] leading-none font-bold text-ink md:text-[1.5rem]">{time(j.dep)}</p><p className="mt-1 text-[0.82rem] font-semibold text-slate-700">{j.from}</p>{!compact && <p className="text-[0.75rem] text-slate-500">{dateLabel(j.dep)}</p>}</div>
      <div className="text-center">
        <p className="text-[0.78rem] font-semibold text-slate-600">{dur(j.minutes)}</p>
        <div className="relative mx-auto my-1.5 h-px w-full max-w-40 bg-slate-300"><Plane size={14} className="absolute -top-[7px] left-1/2 -translate-x-1/2 rotate-90 bg-white text-slate-400" /></div>
        <p className={`text-[0.75rem] font-semibold whitespace-nowrap ${j.stops ? 'text-gold-600' : 'text-palm'}`}>{j.stops ? `${j.stops} stop${j.stops > 1 ? 's' : ''}${via ? ` · ${via}` : ''}` : 'Non-stop'}</p>
      </div>
      <div className="text-right"><p className="font-display text-[1.35rem] leading-none font-bold text-ink md:text-[1.5rem]">{time(j.arr)}</p><p className="mt-1 text-[0.82rem] font-semibold text-slate-700">{j.to}</p>{!compact && <p className="text-[0.75rem] text-slate-500">{dateLabel(j.arr)}</p>}</div>
    </div>
  )
}

function Details({ r }) {
  return (
    <div className="mt-3 rounded-xl bg-sand/70 p-3 text-[0.85rem]">
      {r.journeys.map((j, ji) => (
        <div key={ji} className={ji ? 'mt-3 border-t border-slate-300 pt-3' : ''}>
          {j.flights.map((g, gi) => (
            <div key={gi}>
              {gi > 0 && <p className="my-2 rounded-lg bg-white px-3 py-1.5 text-center text-[0.8rem] font-semibold text-gold-600">Change of plane at {cityOf(g.from)} · {dur(minutesBetween(j.flights[gi - 1].arr, g.dep))} layover</p>}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold text-ink">{g.airline} <span className="font-mono text-slate-600">{g.code}-{g.number}</span>{g.craft ? <span className="font-normal text-slate-500"> · {g.craft}</span> : null}</p>
                <p className="text-slate-600">{dur(g.minutes)}</p>
              </div>
              <p className="text-slate-700">{time(g.dep)} {cityOf(g.from)} ({g.from}){g.fromTerminal ? ` · T${g.fromTerminal}` : ''} → {time(g.arr)} {cityOf(g.to)} ({g.to}){g.toTerminal ? ` · T${g.toTerminal}` : ''}</p>
              <p className="mt-0.5 flex flex-wrap gap-x-4 text-slate-600"><span className="inline-flex items-center gap-1"><Luggage size={13} /> Check-in {g.baggage || r.baggage || 'as per airline'}</span><span>Cabin {g.cabinBaggage || r.cabinBaggage || 'as per airline'}</span></p>
            </div>
          ))}
        </div>
      ))}
      <p className="mt-3 border-t border-slate-300 pt-2 text-slate-600">{r.refundable ? 'Refundable fare (airline cancellation charges apply).' : 'Non-refundable fare.'} {r.fareType ? `Fare: ${r.fareType}.` : ''} Cancellation and date-change rules are shown before you pay.</p>
    </div>
  )
}

function FareOptions({ fares, pax, picked, single, busy, onBook, onSelect, session }) {
  // TBO calls most fares "RegularFare", so name each one by what actually sets it apart from the cheapest.
  const base = fares[0]
  const nameOf = (f, i) => {
    if (i === 0) return fares.length > 1 ? 'Lowest fare' : 'Fare'
    const parts = []
    if (f.refundable && !base.refundable) parts.push('Refundable')
    if (f.baggage && f.baggage !== base.baggage) parts.push(`${f.baggage} baggage`)
    if (f.fareType && f.fareType !== base.fareType) parts.push(f.fareType.replace(/([a-z])([A-Z])/g, '$1 $2'))
    return parts.length ? parts.join(' + ') : `Fare option ${i + 1}`
  }
  return (
    <div className="mt-3 grid gap-2 rounded-xl bg-sand/70 p-3" role="group" aria-label="Fare options">
      {fares.map((f, i) => (
        <div key={f.resultIndex} className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border bg-white p-3 ${picked?.resultIndex === f.resultIndex ? 'border-brand-500' : 'border-slate-200'}`}>
          <div className="min-w-0 text-[0.85rem]">
            <p className="font-bold text-ink">{nameOf(f, i)}</p>
            <p className="flex flex-wrap gap-x-3 text-slate-600">
              <span className={f.refundable ? 'font-semibold text-palm' : ''}>{f.refundable ? 'Refundable' : 'Non-refundable'}</span>
              <span><Luggage size={12} className="mr-1 inline" />{f.baggage ? `${f.baggage} check-in` : 'Check-in baggage not included'}</span>
              {f.cabinBaggage && <span>Cabin {f.cabinBaggage}</span>}
              {f.seats != null && f.seats > 0 && f.seats < 6 && <span className="font-semibold text-red-700">{f.seats} seats left</span>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-right"><span className="block font-display text-[1.2rem] leading-none font-bold text-navy-950">{f.price == null ? 'View fare' : inr(f.price)}</span><span className="text-[0.7rem] text-slate-500">for {pax}, incl. taxes</span></p>
            {single
              ? <button type="button" className="btn btn-gold px-4 py-2" disabled={busy || f.price == null} onClick={() => onBook([f])}>Book</button>
              : <button type="button" className={`btn px-4 py-2 ${picked?.resultIndex === f.resultIndex ? 'btn-brand' : 'btn-ghost'}`} aria-pressed={picked?.resultIndex === f.resultIndex} onClick={() => onSelect(f)}>{picked?.resultIndex === f.resultIndex ? 'Selected' : 'Select'}</button>}
          </div>
        </div>
      ))}
    </div>
  )
}

function FlightCard({ session, r, fares, picked, selected, onSelect, single, badges, pax, onBook, busy, twoCol }) {
  const [open, setOpen] = useState(false)
  const [showFares, setShowFares] = useState(false)
  const priceText = r.price == null ? 'View fare' : inr(r.price)
  return (
    <li className={`rounded-2xl border bg-white p-4 shadow-sm transition ${selected ? 'border-brand-500 ring-2 ring-brand-500/25' : 'border-slate-200 hover:border-slate-400'}`}>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <AirlineMark code={r.airlineCode || r.journeys[0].flights[0].code} name={r.airline} size={36} />
        <p className="font-semibold text-ink">{r.airline}</p>
        <p className="font-mono text-[0.8rem] text-slate-500">{r.journeys.flatMap((j) => j.flights).map((g) => `${g.code}-${g.number}`).join(' · ')}</p>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {badges.map((b) => <span key={b} className="rounded-full bg-palm/10 px-2.5 py-0.5 text-[0.72rem] font-bold text-palm">{b}</span>)}
          {r.seats != null && r.seats > 0 && r.seats < 6 && <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[0.72rem] font-bold text-red-700">{r.seats} seats left</span>}
        </div>
      </div>

      <div className={`grid gap-4 ${twoCol ? '' : 'md:grid-cols-[1fr_11rem] md:items-center'}`}>
        <div className="grid min-w-0 gap-3">{r.journeys.map((j, i) => <Journey key={i} j={j} compact={false} />)}</div>
        <div className={`flex items-end justify-between gap-3 border-t border-dashed border-slate-200 pt-3 ${twoCol ? '' : 'md:flex-col md:items-end md:justify-center md:border-t-0 md:border-l md:pt-0 md:pl-4'}`}>
          <div className={twoCol ? '' : 'md:text-right'}>
            <p className="font-display text-[1.6rem] leading-none font-bold text-navy-950">{priceText}</p>
            <p className="mt-0.5 text-[0.72rem] text-slate-500">for {pax} traveller{pax > 1 ? 's' : ''}, incl. taxes</p>
          </div>
          {single ? (
            <button type="button" className="btn btn-gold px-6 py-2.5" disabled={busy || r.price == null} onClick={() => onBook([r])}>{busy ? <Loader2 className="animate-spin" size={16} /> : 'Book now'}</button>
          ) : (
            <button type="button" className={`btn px-5 py-2.5 ${selected ? 'btn-brand' : 'btn-ghost'}`} aria-pressed={selected} onClick={() => onSelect()}>{selected ? <><Check size={16} /> Selected</> : 'Select'}</button>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[0.8rem] text-slate-600">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className={r.refundable ? 'font-semibold text-palm' : ''}>{r.refundable ? 'Refundable' : 'Non-refundable'}</span>
          {r.baggage && <span className="inline-flex items-center gap-1"><Luggage size={13} /> {r.baggage} check-in</span>}
          <span>{r.isLCC ? 'Low-cost carrier' : 'Full-service'}</span>
        </p>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {fares.length > 1 && <button type="button" className="inline-flex items-center gap-1 font-bold text-brand-500" aria-expanded={showFares} onClick={() => setShowFares((o) => !o)}>{fares.length} fares {showFares ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>}
          <button type="button" className="inline-flex items-center gap-1 font-bold text-brand-500" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Flight details {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
        </span>
      </div>
      {showFares && <FareOptions session={session} fares={fares} pax={pax} picked={picked} single={single} busy={busy} onBook={onBook} onSelect={onSelect} />}
      {open && <Details r={r} />}
    </li>
  )
}

/* ---------------- the page ---------------- */

export default function Results({ found, form, picked, setPicked, busy, searching, onBook, onSearchAgain }) {
  const [filters, setFilters] = useState(EMPTY)
  const [sort, setSort] = useState('best')
  const [showFilters, setShowFilters] = useState(false)
  const [editing, setEditing] = useState(false)
  const [limit, setLimit] = useState(30)
  const lists = found.lists
  const pax = found.pax.adults + found.pax.children + found.pax.infants
  const single = lists.length === 1
  const first = form.segments[0]
  const last = form.journeyType === 'multicity' ? form.segments.at(-1) : null
  const canStrip = form.journeyType !== 'multicity' && !editing
  const tripDays = form.journeyType === 'return' ? Math.max(1, Math.round((new Date(form.returnDate) - new Date(first.date)) / 864e5)) : 0

  useEffect(() => { setLimit(30) }, [filters, sort])
  useEffect(() => { setFilters(EMPTY) }, [found])

  // facets are computed over every list, so the filter works across outbound and return alike
  const facets = useMemo(() => {
    const all = lists.flat().filter((r) => r.price != null)
    const air = new Map(), stops = {}, times = {}
    for (const r of all) {
      air.set(r.airline, Math.min(air.get(r.airline) ?? Infinity, r.price))
      const s = stopBucket(r); stops[s] = Math.min(stops[s] ?? Infinity, r.price)
      const b = bucketOf(r.journeys[0].dep); times[b] = Math.min(times[b] ?? Infinity, r.price)
    }
    const prices = all.map((r) => r.price)
    return { airlines: [...air.entries()].sort((a, b) => a[1] - b[1]), stops, times, min: prices.length ? Math.floor(Math.min(...prices) / 100) * 100 : 0, max: prices.length ? Math.ceil(Math.max(...prices) / 100) * 100 : 0 }
  }, [lists])

  const active = filters.stops.length + filters.airlines.length + filters.times.length + (filters.maxPrice != null ? 1 : 0) + (filters.refundable ? 1 : 0)
  const sorter = SORTS.find((s) => s.id === sort).fn
  const shown = useMemo(() => lists.map((l) => groupFares(l.filter((r) => matches(r, filters)).sort(sorter))), [lists, filters, sorter])
  const ready = picked.every(Boolean)
  const total = picked.reduce((t, p) => t + (p?.price || 0), 0)
  const cheapestIds = useMemo(() => lists.map((l) => { const p = l.filter((r) => r.price != null); return p.length ? p.reduce((a, b) => (b.price < a.price ? b : a)).resultIndex : null }), [lists])
  const fastestIds = useMemo(() => lists.map((l) => (l.length ? l.reduce((a, b) => (totalMin(b) < totalMin(a) ? b : a)).resultIndex : null)), [lists])

  const heading = (li) => {
    if (found.journey === 'return') return li ? `${cityOf(first.to)} → ${cityOf(first.from)}` : `${cityOf(first.from)} → ${cityOf(first.to)}`
    return lists.length > 1 ? `Flight ${li + 1}` : null
  }
  const dateOf = (li) => (found.journey === 'return' ? (li ? form.returnDate : first.date) : form.segments[li]?.date)

  return (
    <div>
      {/* modify search */}
      <div className="mb-4 rounded-2xl bg-white p-3 shadow-md md:p-4">
        {editing ? (
          <SearchWidget initial={form} busy={searching} submitLabel="Update search" onCancel={() => setEditing(false)} onSearch={(f) => { onSearchAgain(f); setEditing(false) }} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
              <p className="inline-flex items-center gap-2 font-display text-[1.15rem] font-bold text-ink">{cityOf(first.from)} <ArrowRight size={18} className="text-brand-500" /> {cityOf(last ? last.to : first.to)}{form.journeyType === 'return' && <span className="text-[0.8rem] font-semibold text-slate-500">round trip</span>}</p>
              <p className="text-[0.88rem] text-slate-600">{dateLabel(first.date)}{form.journeyType === 'return' ? ` – ${dateLabel(form.returnDate)}` : ''}</p>
              <p className="inline-flex items-center gap-1 text-[0.88rem] text-slate-600"><Users size={14} /> {pax} · {form.cabin}</p>
            </div>
            <button type="button" className="btn btn-ghost px-4 py-2" onClick={() => setEditing(true)}><Pencil size={15} /> Modify search</button>
          </div>
        )}
      </div>

      {canStrip && <DateStrip from={first.from} to={first.to} date={first.date} onPick={(d) => onSearchAgain({ ...form, segments: [{ ...first, date: d }], returnDate: form.journeyType === 'return' ? addDays(d, tripDays) : undefined })} />}

      <div className="grid gap-5 lg:grid-cols-[17rem_1fr]">
        <aside>
          <button type="button" className="btn btn-ghost mb-3 w-full lg:hidden" onClick={() => setShowFilters((s) => !s)}>{showFilters ? <X size={16} /> : <Filter size={16} />} {showFilters ? 'Hide filters' : `Filters${active ? ` (${active})` : ''}`}</button>
          <div className={`${showFilters ? 'block' : 'hidden'} lg:sticky lg:top-24 lg:block lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:rounded-2xl lg:pr-1 [scrollbar-width:thin]`}>
            <Filters f={filters} setF={setFilters} facets={facets} active={active} onReset={() => setFilters(EMPTY)} />
          </div>
        </aside>

        <div className={searching ? 'opacity-60 transition' : 'transition'} aria-busy={searching}>
          <div className="mb-3 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm" role="tablist" aria-label="Sort flights">
            {SORTS.map((s) => (
              <button key={s.id} type="button" role="tab" aria-selected={sort === s.id} title={s.hint} onClick={() => setSort(s.id)}
                className={`flex-1 rounded-xl px-3 py-2 text-[0.9rem] font-bold whitespace-nowrap ${sort === s.id ? 'bg-navy-950 text-white' : 'text-slate-700 hover:bg-sand'}`}>{s.label}</button>
            ))}
          </div>

          <div className={`grid gap-5 ${lists.length === 2 ? 'xl:grid-cols-2' : ''}`}>
            {lists.map((list, li) => (
              <section key={li} className="min-w-0" aria-label={heading(li) || 'Flights'}>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h2 className="font-display text-[1.15rem] font-bold text-ink">{heading(li) || 'Available flights'}{dateOf(li) && <span className="ml-2 text-[0.85rem] font-semibold text-slate-500">{dateLabel(dateOf(li))}</span>}</h2>
                  <p className="text-[0.82rem] text-slate-600">{shown[li].length} of {new Set(list.map(flightKey)).size} flights</p>
                </div>
                {!shown[li].length ? (
                  <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
                    <AlertTriangle className="mx-auto text-gold-600" size={28} />
                    <p className="mt-2 font-semibold text-ink">{list.length ? 'No flights match your filters.' : 'No flights found for this day.'}</p>
                    {active > 0 && <button type="button" className="btn btn-ghost mt-3" onClick={() => setFilters(EMPTY)}>Reset filters</button>}
                  </div>
                ) : (
                  <ul className="grid gap-3">
                    {shown[li].slice(0, limit).map((fares) => {
                      const chosen = fares.find((f) => picked[li]?.resultIndex === f.resultIndex)
                      const r = chosen || fares[0]
                      return (
                        <FlightCard key={fares[0].resultIndex} session={found.session} r={r} fares={fares} picked={chosen} pax={pax} single={single} busy={busy} twoCol={lists.length === 2}
                          selected={!!chosen} onBook={onBook}
                          onSelect={(f) => setPicked((p) => p.map((x, j) => (j === li ? (f && f.resultIndex ? f : r) : x)))}
                          badges={[...(fares.some((f) => f.resultIndex === cheapestIds[li]) ? ['Cheapest'] : []), ...(fares.some((f) => f.resultIndex === fastestIds[li]) ? ['Fastest'] : [])]} />
                      )
                    })}
                  </ul>
                )}
                {shown[li].length > limit && <button type="button" className="btn btn-ghost mt-3 w-full" onClick={() => setLimit((l) => l + 30)}>Show more flights ({shown[li].length - limit} more)</button>}
              </section>
            ))}
          </div>
        </div>
      </div>

      {!single && (
        <div className="sticky bottom-3 z-20 mt-6 rounded-2xl bg-navy-950 p-3 text-white shadow-2xl md:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap gap-x-6 gap-y-1 text-[0.85rem]">
              {picked.map((p, i) => (
                <p key={i} className="min-w-0 truncate">{p ? <><BadgeCheck size={14} className="mr-1 inline text-gold-400" />{p.journeys[0].from}→{p.journeys.at(-1).to} {time(p.journeys[0].dep)} · {p.airline} · <strong>{inr(p.price)}</strong></> : <span className="text-white/65">Pick {heading(i) || `flight ${i + 1}`}</span>}</p>
              ))}
            </div>
            <div className="flex items-center gap-4">
              {ready && <p>Total <strong className="ml-1 font-display text-[1.3rem]">{inr(total)}</strong></p>}
              <button type="button" className="btn btn-gold px-8" disabled={!ready || busy} onClick={() => onBook(picked)}>{busy ? <><Loader2 className="animate-spin" size={17} /> Checking fare…</> : 'Book now'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
