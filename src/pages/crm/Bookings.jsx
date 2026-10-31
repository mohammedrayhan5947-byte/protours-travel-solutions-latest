import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2, MessageCircle, Phone, RefreshCw, Search, Mail, Radar } from 'lucide-react'

import { crm, download } from './api.js'
import { BOOKING_STATUS, Card, Drawer, Empty, Err, Pager, Pill, Timeline, btnDark, btnLight, dayLabel, inr, input, waTo, when, whenFull } from './ui.jsx'
import { Json } from './Logs.jsx'

const STATUSES = Object.keys(BOOKING_STATUS)

export default function Bookings({ openId, onOpen }) {
  const [f, setF] = useState({ q: '', status: '', from: '', to: '' })
  const [debounced, setDebounced] = useState(f)
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { const t = setTimeout(() => { setDebounced(f); setPage(1) }, 300); return () => clearTimeout(t) }, [f])
  const load = useCallback(async () => {
    setBusy(true); setErr('')
    try { setData(await crm('bookings', { ...debounced, page })) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }, [debounced, page])
  useEffect(() => { load() }, [load])

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  return (
    <div className="grid gap-4">
      <Card>
        <div className="grid gap-3 md:grid-cols-[1.6fr_1fr_1fr_1fr_auto]">
          <label className="relative block"><span className="sr-only">Search bookings</span><Search size={16} className="absolute top-3 left-3 text-slate-400" /><input className={`${input} pl-9`} placeholder="Search name, phone, e-mail, PNR, order ref, route" value={f.q} onChange={set('q')} /></label>
          <select aria-label="Status" className={input} value={f.status} onChange={set('status')}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{BOOKING_STATUS[s][0]}</option>)}</select>
          <input aria-label="From date" type="date" className={input} value={f.from} onChange={set('from')} />
          <input aria-label="To date" type="date" className={input} value={f.to} onChange={set('to')} />
          <div className="flex gap-2"><button className={btnLight} onClick={load} aria-label="Refresh"><RefreshCw size={16} className={busy ? 'animate-spin' : ''} /></button><button className={btnLight} onClick={() => download('bookings', debounced).catch((e) => setErr(e.message))}><Download size={16} /> CSV</button></div>
        </div>
      </Card>
      <Err>{err}</Err>
      {!data ? <Empty><Loader2 className="mx-auto animate-spin" /></Empty> : !data.rows.length ? <Empty>No bookings match.</Empty> : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[56rem] text-left text-[0.88rem]">
            <thead className="bg-sand/70 text-[0.72rem] tracking-wide text-slate-600 uppercase"><tr>{['When', 'Order', 'Customer', 'Trip', 'Pax', 'Amount', 'PNR', 'Status'].map((h) => <th key={h} className="px-3 py-2.5">{h}</th>)}</tr></thead>
            <tbody>
              {data.rows.map((b) => (
                <tr key={b.id} tabIndex={0} onClick={() => onOpen(b.id)} onKeyDown={(e) => e.key === 'Enter' && onOpen(b.id)} className="cursor-pointer border-t border-slate-100 hover:bg-sand/50 focus:bg-sand/50 focus:outline-none">
                  <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{when(b.created_at)}</td>
                  <td className="px-3 py-2.5 font-mono text-[0.8rem]">{b.order_ref}{b.env === 'staging' && <span className="ml-1 rounded bg-slate-200 px-1 text-[0.65rem] font-sans font-bold text-slate-600">TEST</span>}</td>
                  <td className="px-3 py-2.5"><span className="block font-semibold text-ink">{b.customer_name || '—'}</span><span className="text-[0.78rem] text-slate-500">{b.contact_phone}</span></td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{b.route || '—'}<span className="block text-[0.78rem] text-slate-500">{dayLabel(b.travel_date)}{b.return_date ? ` → ${dayLabel(b.return_date)}` : ''}</span></td>
                  <td className="px-3 py-2.5">{b.pax_count || '—'}</td>
                  <td className="px-3 py-2.5 font-semibold whitespace-nowrap">{inr(b.amount_inr)}</td>
                  <td className="px-3 py-2.5 font-mono text-[0.8rem]">{b.pnr || '—'}</td>
                  <td className="px-3 py-2.5"><Pill status={b.status} map={BOOKING_STATUS} />{b.assigned_to && <span className="mt-1 block text-[0.72rem] text-slate-500">→ {b.assigned_to}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} size={data.size} total={data.total} onPage={setPage} />}
      {openId && <BookingDrawer id={openId} onClose={() => onOpen(null)} onChanged={load} />}
    </div>
  )
}

export function BookingDrawer({ id, onClose, onChanged }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [status, setStatus] = useState('')
  const [assigned, setAssigned] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState(null) // { title, data }

  const load = useCallback(async () => {
    try { const r = await crm('booking', { id }); setD(r); setStatus(r.booking.status); setAssigned(r.booking.assigned_to || '') } catch (e) { setErr(e.message) }
  }, [id])
  useEffect(() => { load() }, [load])

  const save = async (e) => {
    e.preventDefault(); setSaving(true); setErr('')
    try { await crm('bookingUpdate', { id, status, assigned_to: assigned, note }, 'POST'); setNote(''); await load(); onChanged?.() } catch (x) { setErr(x.message) } finally { setSaving(false) }
  }
  const trace = async () => { try { setView({ title: `TBO calls for ${d.booking.order_ref}`, data: await crm('trace', { id: d.booking.trace_id }) }) } catch (e) { setErr(e.message) } }
  const live = async (bookingId) => { try { setView({ title: `TBO says (booking ${bookingId})`, data: await crm('live', { id: bookingId }) }) } catch (e) { setErr(e.message) } }

  const b = d?.booking
  return (
    <Drawer title={b ? `${b.order_ref}` : 'Booking'} onClose={onClose}>
      {!b ? (err ? <Err>{err}</Err> : <Loader2 className="mx-auto animate-spin" />) : (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3"><Pill status={b.status} map={BOOKING_STATUS} /><span className="font-display text-[1.5rem] font-bold text-navy-950">{inr(b.amount_inr)}</span><span className="text-[0.82rem] text-slate-500">{b.env === 'live' ? 'Live' : 'Test (staging)'} · started {whenFull(b.created_at)}</span></div>

          <Card title="Customer">
            <p className="font-semibold text-ink">{b.customer_name || '—'}</p>
            <p className="text-[0.92rem] text-slate-600">{b.contact_phone} · {b.contact_email}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {b.contact_phone && <a className={btnLight} href={waTo(b.contact_phone, `Hi ${b.customer_name || ''}, about your booking ${b.order_ref}`)} target="_blank" rel="noreferrer"><MessageCircle size={16} /> WhatsApp</a>}
              {b.contact_phone && <a className={btnLight} href={`tel:${b.contact_phone}`}><Phone size={16} /> Call</a>}
              {b.contact_email && <a className={btnLight} href={`mailto:${b.contact_email}?subject=${encodeURIComponent('Your booking ' + b.order_ref)}`}><Mail size={16} /> E-mail</a>}
            </div>
          </Card>

          <Card title="Trip">
            <p className="font-semibold">{b.route || '—'} <span className="font-normal text-slate-500">· {b.journey || ''}</span></p>
            <p className="text-[0.92rem] text-slate-600">{dayLabel(b.travel_date)}{b.return_date ? ` → ${dayLabel(b.return_date)}` : ''} · {b.pax_count || 0} traveller{b.pax_count > 1 ? 's' : ''}</p>
            {b.pax?.length > 0 && (
              <table className="mt-3 w-full text-left text-[0.88rem]"><thead className="text-[0.72rem] tracking-wide text-slate-500 uppercase"><tr><th className="py-1">Traveller</th><th>Type</th><th>Ticket</th></tr></thead>
                <tbody>{b.pax.map((p, i) => <tr key={i} className="border-t border-slate-100"><td className="py-1.5 font-semibold">{p.name}</td><td>{p.type}</td><td className="font-mono text-[0.8rem]">{p.ticket || '—'}</td></tr>)}</tbody></table>
            )}
          </Card>

          <Card title="Tickets & airline records">
            {!b.legs?.length ? <p className="text-[0.9rem] text-slate-500">Not ticketed yet.</p> : b.legs.map((l, i) => (
              <div key={i} className="mb-3 rounded-xl bg-sand/60 p-3 text-[0.9rem] last:mb-0">
                <p><strong>PNR</strong> <span className="font-mono">{l.pnr || '—'}</span> · <strong>TBO booking</strong> <span className="font-mono">{l.bookingId || '—'}</span></p>
                {l.error && <p className="mt-1 font-semibold text-red-700">{l.error}</p>}
                {l.details?.segments?.map((s, k) => <p key={k} className="text-slate-600">{s.flight} · {s.from} → {s.to} · {when(s.dep)}</p>)}
                {l.bookingId && <button className={`${btnLight} mt-2`} onClick={() => live(l.bookingId)}><Radar size={15} /> Check with TBO now</button>}
              </div>
            ))}
          </Card>

          <Card title="Payment"><dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-[0.9rem]"><dt className="text-slate-500">Payment id</dt><dd className="font-mono break-all">{b.payment_id || '—'}</dd><dt className="text-slate-500">Razorpay order</dt><dd className="font-mono break-all">{b.razorpay_order_id || '—'}</dd><dt className="text-slate-500">TBO trace</dt><dd className="font-mono break-all">{b.trace_id || '—'}</dd></dl></Card>

          <Card title="Update">
            <form onSubmit={save} className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-[0.8rem] font-bold text-slate-600 uppercase">Status<select className={`${input} mt-1 normal-case`} value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{BOOKING_STATUS[s][0]}</option>)}</select></label>
                <label className="text-[0.8rem] font-bold text-slate-600 uppercase">Assigned to<input className={`${input} mt-1 normal-case`} maxLength={60} value={assigned} onChange={(e) => setAssigned(e.target.value)} placeholder="Staff name" /></label>
              </div>
              <label className="text-[0.8rem] font-bold text-slate-600 uppercase">Add a note<textarea className={`${input} mt-1 normal-case`} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Called customer, refund approved, ..." /></label>
              <Err>{err}</Err>
              <button className={btnDark} disabled={saving}>{saving ? <Loader2 size={16} className="animate-spin" /> : 'Save'}</button>
            </form>
          </Card>

          <Card title="Timeline"><Timeline events={d.events} /></Card>

          <Card title={`TBO calls (${d.calls.length})`} right={b.trace_id && d.calls.length > 0 && <button className={btnLight} onClick={trace}>View JSON</button>}>
            {!d.calls.length ? <p className="text-[0.9rem] text-slate-500">No API calls recorded for this booking.</p> : (
              <ul className="grid gap-1 text-[0.85rem]">{d.calls.map((c) => <li key={c.id} className="flex justify-between gap-3"><span className="font-semibold">{c.method} <span className="font-normal text-slate-500">{c.kind}</span></span><span className="text-slate-500">{when(c.created_at)}</span></li>)}</ul>
            )}
          </Card>
        </div>
      )}
      {view && <Drawer title={view.title} onClose={() => setView(null)}><Json data={view.data} /></Drawer>}
    </Drawer>
  )
}
