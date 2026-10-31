import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2, Mail, MessageCircle, Phone, RefreshCw, Search } from 'lucide-react'

import { crm, download } from './api.js'
import { Card, Drawer, ENQUIRY_STATUS, Empty, Err, Pager, Pill, Timeline, ago, btnDark, btnLight, input, waTo, whenFull } from './ui.jsx'

const STATUSES = Object.keys(ENQUIRY_STATUS)

export default function Enquiries({ openId, onOpen }) {
  const [f, setF] = useState({ q: '', status: '', from: '', to: '' })
  const [debounced, setDebounced] = useState(f)
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { const t = setTimeout(() => { setDebounced(f); setPage(1) }, 300); return () => clearTimeout(t) }, [f])
  const load = useCallback(async () => {
    setBusy(true); setErr('')
    try { setData(await crm('enquiries', { ...debounced, page })) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }, [debounced, page])
  useEffect(() => { load() }, [load])
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  return (
    <div className="grid gap-4">
      <Card>
        <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Enquiry status">
          {[['', 'All'], ...STATUSES.map((s) => [s, ENQUIRY_STATUS[s][0]])].map(([v, l]) => (
            <button key={v} role="tab" aria-selected={f.status === v} onClick={() => setF((x) => ({ ...x, status: v }))} className={`rounded-full px-3.5 py-1.5 text-[0.85rem] font-bold ${f.status === v ? 'bg-navy-950 text-white' : 'bg-sand text-navy-900 hover:bg-slate-200'}`}>{l}</button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-[1.6fr_1fr_1fr_auto]">
          <label className="relative block"><span className="sr-only">Search enquiries</span><Search size={16} className="absolute top-3 left-3 text-slate-400" /><input className={`${input} pl-9`} placeholder="Search name, phone, e-mail, message" value={f.q} onChange={set('q')} /></label>
          <input aria-label="From date" type="date" className={input} value={f.from} onChange={set('from')} />
          <input aria-label="To date" type="date" className={input} value={f.to} onChange={set('to')} />
          <div className="flex gap-2"><button className={btnLight} onClick={load} aria-label="Refresh"><RefreshCw size={16} className={busy ? 'animate-spin' : ''} /></button><button className={btnLight} onClick={() => download('enquiries', debounced).catch((e) => setErr(e.message))}><Download size={16} /> CSV</button></div>
        </div>
      </Card>
      <Err>{err}</Err>
      {!data ? <Empty><Loader2 className="mx-auto animate-spin" /></Empty> : !data.rows.length ? <Empty>No enquiries match.</Empty> : (
        <ul className="grid gap-2">
          {data.rows.map((e) => (
            <li key={e.id}>
              <button onClick={() => onOpen(e.id)} className="grid w-full gap-1 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-brand-500 md:grid-cols-[14rem_1fr_auto] md:items-center md:gap-4">
                <span><span className="block font-semibold text-ink">{e.name}</span><span className="text-[0.82rem] text-slate-500">{e.phone}</span></span>
                <span className="min-w-0"><span className="block text-[0.82rem] font-bold text-brand-600">{e.topic || 'Enquiry'}{e.page ? <span className="font-normal text-slate-400"> · from {e.page}</span> : ''}</span><span className="line-clamp-2 text-[0.9rem] whitespace-pre-line text-slate-700">{e.message || '—'}</span></span>
                <span className="flex items-center gap-3 md:flex-col md:items-end md:gap-1"><Pill status={e.status} map={ENQUIRY_STATUS} /><span className="text-[0.75rem] text-slate-500">{ago(e.created_at)}{e.assigned_to ? ` · ${e.assigned_to}` : ''}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && <Pager page={data.page} size={data.size} total={data.total} onPage={setPage} />}
      {openId && <EnquiryDrawer id={openId} onClose={() => onOpen(null)} onChanged={load} />}
    </div>
  )
}

function EnquiryDrawer({ id, onClose, onChanged }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [status, setStatus] = useState('')
  const [assigned, setAssigned] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try { const r = await crm('enquiry', { id }); setD(r); setStatus(r.enquiry.status); setAssigned(r.enquiry.assigned_to || '') } catch (e) { setErr(e.message) }
  }, [id])
  useEffect(() => { load() }, [load])
  const save = async (e) => {
    e.preventDefault(); setSaving(true); setErr('')
    try { await crm('enquiryUpdate', { id, status, assigned_to: assigned, note }, 'POST'); setNote(''); await load(); onChanged?.() } catch (x) { setErr(x.message) } finally { setSaving(false) }
  }
  const q = d?.enquiry
  return (
    <Drawer title={q ? q.name : 'Enquiry'} onClose={onClose}>
      {!q ? (err ? <Err>{err}</Err> : <Loader2 className="mx-auto animate-spin" />) : (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3"><Pill status={q.status} map={ENQUIRY_STATUS} /><span className="text-[0.82rem] text-slate-500">Received {whenFull(q.created_at)}{q.page ? ` from ${q.page}` : ''}</span></div>
          <Card title="Contact">
            <p className="font-semibold text-ink">{q.name}</p>
            <p className="text-[0.92rem] text-slate-600">{q.phone}{q.email ? ` · ${q.email}` : ''}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a className={btnLight} href={waTo(q.phone, `Hi ${q.name}, thanks for your enquiry${q.topic ? ' about ' + q.topic : ''}. `)} target="_blank" rel="noreferrer"><MessageCircle size={16} /> WhatsApp</a>
              <a className={btnLight} href={`tel:${q.phone}`}><Phone size={16} /> Call</a>
              {q.email && <a className={btnLight} href={`mailto:${q.email}`}><Mail size={16} /> E-mail</a>}
            </div>
          </Card>
          <Card title={q.topic || 'Message'}><p className="text-[0.95rem] whitespace-pre-line text-ink">{q.message || 'No message.'}</p></Card>
          <Card title="Update">
            <form onSubmit={save} className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-[0.8rem] font-bold text-slate-600 uppercase">Status<select className={`${input} mt-1 normal-case`} value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{ENQUIRY_STATUS[s][0]}</option>)}</select></label>
                <label className="text-[0.8rem] font-bold text-slate-600 uppercase">Assigned to<input className={`${input} mt-1 normal-case`} maxLength={60} value={assigned} onChange={(e) => setAssigned(e.target.value)} placeholder="Staff name" /></label>
              </div>
              <label className="text-[0.8rem] font-bold text-slate-600 uppercase">Add a note<textarea className={`${input} mt-1 normal-case`} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Quote sent, call back Friday, ..." /></label>
              <Err>{err}</Err>
              <button className={btnDark} disabled={saving}>{saving ? <Loader2 size={16} className="animate-spin" /> : 'Save'}</button>
            </form>
          </Card>
          <Card title="Timeline"><Timeline events={d.events} /></Card>
        </div>
      )}
    </Drawer>
  )
}
