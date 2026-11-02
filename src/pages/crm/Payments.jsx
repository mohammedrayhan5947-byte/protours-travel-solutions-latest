import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2, RefreshCw, Search } from 'lucide-react'

import { crm, download } from './api.js'
import { Card, Empty, Err, PAYMENT_STATUS, Pager, Pill, btnLight, inr, input, whenFull } from './ui.jsx'

const METHODS = [['', 'All methods'], ['upi', 'UPI'], ['card', 'Card'], ['netbanking', 'Net banking'], ['wallet', 'Wallet'], ['emi', 'EMI'], ['paylater', 'Pay later']]

/** How the customer paid, in one line: the UPI id, the card (network + last 4), the bank or the wallet. */
export function payDetail(p) {
  if (p.method === 'upi') return p.vpa || 'UPI'
  if (p.method === 'card') return [p.card_network, p.card_type, p.card_last4 && `•••• ${p.card_last4}`, p.card_issuer].filter(Boolean).join(' ') || 'Card'
  if (p.method === 'netbanking') return p.bank || 'Net banking'
  if (p.method === 'wallet') return p.wallet || 'Wallet'
  return p.method || '—'
}

/** Every payment attempt with its times, method, UPI id and references. Used in the booking panel too. */
export function PaymentTable({ rows }) {
  if (!rows?.length) return <p className="text-[0.9rem] text-slate-500">No payment attempt recorded.</p>
  return (
    <div className="grid gap-3">
      {rows.map((p) => (
        <div key={p.payment_id} className="rounded-xl border border-slate-200 p-3 text-[0.88rem]">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-[0.8rem] break-all">{p.payment_id}</span><Pill status={p.status} map={PAYMENT_STATUS} /></div>
          <dl className="mt-2 grid grid-cols-[9rem_1fr] gap-y-1">
            <dt className="text-slate-500">Amount</dt><dd className="font-semibold">{inr(p.amount_inr)}{Number(p.refunded_inr) > 0 ? ` · refunded ${inr(p.refunded_inr)}` : ''}</dd>
            <dt className="text-slate-500">Method</dt><dd>{(p.method || '—').toUpperCase()} · {payDetail(p)}</dd>
            {p.upi_ref && (<><dt className="text-slate-500">UPI transaction id</dt><dd className="font-mono break-all">{p.upi_ref}</dd></>)}
            {p.bank_ref && (<><dt className="text-slate-500">Bank reference</dt><dd className="font-mono break-all">{p.bank_ref}</dd></>)}
            <dt className="text-slate-500">Started</dt><dd>{whenFull(p.initiated_at) || '—'}</dd>
            <dt className="text-slate-500">Authorised</dt><dd>{whenFull(p.authorized_at) || '—'}</dd>
            <dt className="text-slate-500">Captured</dt><dd>{whenFull(p.captured_at) || '—'}</dd>
            {p.failed_at && (<><dt className="text-slate-500">Failed</dt><dd className="font-semibold text-red-700">{whenFull(p.failed_at)} · {p.error_description || p.error_reason || p.error_code}</dd></>)}
            {Number(p.fee_inr) > 0 && (<><dt className="text-slate-500">Gateway fee + tax</dt><dd>{inr(p.fee_inr)} + {inr(p.tax_inr || 0)}</dd></>)}
            <dt className="text-slate-500">Payer</dt><dd>{[p.contact, p.email].filter(Boolean).join(' · ') || '—'}</dd>
          </dl>
        </div>
      ))}
    </div>
  )
}

export default function Payments({ onOpenOrder }) {
  const [f, setF] = useState({ q: '', status: '', method: '', from: '', to: '' })
  const [d, setD] = useState(f)
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { const t = setTimeout(() => { setD(f); setPage(1) }, 300); return () => clearTimeout(t) }, [f])
  const load = useCallback(async () => { setBusy(true); setErr(''); try { setData(await crm('payments', { ...d, page })) } catch (e) { setErr(e.message) } finally { setBusy(false) } }, [d, page])
  useEffect(() => { load() }, [load])
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  return (
    <div className="grid gap-4">
      <Card>
        <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Payment status">
          {[['', 'All'], ...Object.entries(PAYMENT_STATUS).map(([k, v]) => [k, v[0]])].map(([v, l]) => (
            <button key={v} role="tab" aria-selected={f.status === v} onClick={() => setF((x) => ({ ...x, status: v }))} className={`rounded-full px-3.5 py-1.5 text-[0.85rem] font-bold ${f.status === v ? 'bg-navy-950 text-white' : 'bg-sand text-navy-900 hover:bg-slate-200'}`}>{l}</button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-[1.6fr_1fr_1fr_1fr_auto]">
          <label className="relative block"><span className="sr-only">Search payments</span><Search size={16} className="absolute top-3 left-3 text-slate-400" /><input className={`${input} pl-9`} placeholder="Payment id, UPI id, order, phone, e-mail" value={f.q} onChange={set('q')} /></label>
          <select aria-label="Method" className={input} value={f.method} onChange={set('method')}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <input aria-label="From date" type="date" className={input} value={f.from} onChange={set('from')} />
          <input aria-label="To date" type="date" className={input} value={f.to} onChange={set('to')} />
          <div className="flex gap-2"><button className={btnLight} onClick={load} aria-label="Refresh"><RefreshCw size={16} className={busy ? 'animate-spin' : ''} /></button><button className={btnLight} onClick={() => download('payments', d).catch((e) => setErr(e.message))}><Download size={16} /> CSV</button></div>
        </div>
      </Card>
      <Err>{err}</Err>
      {!data ? <Empty><Loader2 className="mx-auto animate-spin" /></Empty> : !data.rows.length ? <Empty>No payments yet. They appear here as soon as a customer starts paying.</Empty> : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[60rem] text-left text-[0.86rem]">
            <thead className="bg-sand text-[0.72rem] tracking-wide text-slate-600 uppercase"><tr><th className="p-3">Started</th><th>Payment id</th><th>Booking</th><th>Amount</th><th>Method / UPI id / card</th><th>Status</th><th>Captured</th></tr></thead>
            <tbody>{data.rows.map((p) => (
              <tr key={p.payment_id} className="border-t border-slate-100 align-top">
                <td className="p-3 whitespace-nowrap">{whenFull(p.initiated_at)}</td>
                <td className="font-mono text-[0.78rem] break-all">{p.payment_id}{p.upi_ref ? <span className="block text-slate-500">UPI {p.upi_ref}</span> : null}</td>
                <td>{p.order_ref ? <button className="font-mono text-[0.8rem] font-bold text-brand-500" onClick={() => onOpenOrder(p.order_ref)}>{p.order_ref}</button> : '—'}</td>
                <td className="font-semibold">{inr(p.amount_inr)}</td>
                <td><span className="font-semibold">{(p.method || '—').toUpperCase()}</span><span className="block text-slate-600">{payDetail(p)}</span>{p.error_description && <span className="block text-red-700">{p.error_description}</span>}</td>
                <td><Pill status={p.status} map={PAYMENT_STATUS} /></td>
                <td className="whitespace-nowrap">{whenFull(p.captured_at) || '—'}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} size={data.size} total={data.total} onPage={setPage} />}
    </div>
  )
}
