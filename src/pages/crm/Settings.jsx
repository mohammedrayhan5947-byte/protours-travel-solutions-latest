import { useEffect, useState } from 'react'
import { Download, Loader2, LogOut, Trash2, Wallet } from 'lucide-react'

import { crm, download, getSession, signOut } from './api.js'
import { Card, Err, btnDark, btnLight, inr, input, whenFull } from './ui.jsx'


/** The price markup: what is added to the airline's fare, domestic and international separately: a percentage, a flat amount, or both. */
function Markup({ onSaved }) {
  const [m, setM] = useState(null) // what the server has
  const [f, setF] = useState(null) // what is typed (strings, so a field can be empty while typing)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const load = () => crm('markup').then((r) => { setM(r); setF({ domestic: { percent: String(r.domestic.percent), flat: String(r.domestic.flat) }, international: { percent: String(r.international.percent), flat: String(r.international.flat) } }) }).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])
  if (!f) return <Card title="Price markup">{err ? <Err>{err}</Err> : <Loader2 className="animate-spin" />}</Card>

  const lim = m.limits
  const num = (v) => (v === '' || v === null ? NaN : Number(v))
  const valid = (side) => Number.isFinite(num(f[side].percent)) && num(f[side].percent) >= lim.percent.min && num(f[side].percent) <= lim.percent.max && Number.isFinite(num(f[side].flat)) && num(f[side].flat) >= lim.flat.min && num(f[side].flat) <= lim.flat.max
  const ok = valid('domestic') && valid('international')
  const changed = ['domestic', 'international'].some((s) => num(f[s].percent) !== m[s].percent || num(f[s].flat) !== m[s].flat)
  const set = (side, k) => (e) => setF((x) => ({ ...x, [side]: { ...x[side], [k]: e.target.value } }))
  // the same arithmetic the server uses: fare + fare x % + flat x adults/children, rounded up
  const price = (fare, side, adults) => Math.ceil(fare * (1 + (num(f[side].percent) || 0) / 100) + (num(f[side].flat) || 0) * adults - 1e-9)

  const save = async (e) => {
    e.preventDefault(); setErr(''); setMsg('')
    const body = { domestic: { percent: num(f.domestic.percent), flat: num(f.domestic.flat) }, international: { percent: num(f.international.percent), flat: num(f.international.flat) } }
    if (!window.confirm(`Change the markup?\n\nDomestic: ${body.domestic.percent}% + ${inr(body.domestic.flat)} per traveller\nInternational: ${body.international.percent}% + ${inr(body.international.flat)} per traveller\n\nNew searches use it within about a minute. Bookings already in checkout keep the price they were quoted.`)) return
    setBusy(true)
    try { await crm('markupSave', { ...body, confirm: true }, 'POST'); setMsg('Saved. New searches will use these prices within about a minute.'); await load(); onSaved?.() } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }

  const Row = ({ side, title, example }) => (
    <fieldset className="rounded-xl border border-slate-200 p-4">
      <legend className="px-2 font-display text-[1rem] font-bold text-ink">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-[0.8rem] font-bold text-slate-600 uppercase">Percentage of the airline fare (%)
          <input className={`${input} mt-1`} type="number" inputMode="decimal" min={lim.percent.min} max={lim.percent.max} step="0.1" required value={f[side].percent} onChange={set(side, 'percent')} />
        </label>
        <label className="text-[0.8rem] font-bold text-slate-600 uppercase">Flat amount (₹ per adult / child, per ticket)
          <input className={`${input} mt-1`} type="number" inputMode="decimal" min={lim.flat.min} max={lim.flat.max} step="1" required value={f[side].flat} onChange={set(side, 'flat')} />
        </label>
      </div>
      {valid(side)
        ? <p className="mt-3 rounded-lg bg-sand/70 px-3 py-2 text-[0.85rem] text-slate-700">Example: an airline fare of <strong>{inr(example.fare)}</strong> for <strong>{example.adults} adult{example.adults > 1 ? 's' : ''}</strong> costs the customer <strong>{inr(price(example.fare, side, example.adults))}</strong>, of which <strong className="text-emerald-800">{inr(price(example.fare, side, example.adults) - example.fare)}</strong> is yours.</p>
        : <p className="mt-3 text-[0.85rem] font-semibold text-red-700">Percentage {lim.percent.min} to {lim.percent.max}, flat amount ₹{lim.flat.min} to ₹{lim.flat.max}.</p>}
    </fieldset>
  )

  return (
    <Card title="Price markup" right={<span className="text-[0.78rem] text-slate-500">{m.source === 'crm' ? `Last changed by ${m.updatedBy || 'staff'}${m.updatedAt ? ' · ' + whenFull(m.updatedAt) : ''}` : 'Not set yet: using the server default'}</span>}>
      <p className="mb-3 text-[0.9rem] text-slate-600">What is added to the airline's fare before the customer sees the price. Use a percentage, a flat amount, or both: <em>price = airline fare + fare × % + flat × (adults + children)</em>. Infants only get the percentage. The total is rounded up to a whole rupee.</p>
      <form onSubmit={save} className="grid gap-4">
        <Row side="domestic" title="Domestic flights (within India)" example={{ fare: 5000, adults: 1 }} />
        <Row side="international" title="International flights" example={{ fare: 30000, adults: 2 }} />
        <Err>{err}</Err>{msg && <p role="status" className="text-[0.9rem] font-semibold text-emerald-700">{msg}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button className={btnDark} disabled={busy || !ok || !changed}>{busy ? <Loader2 size={16} className="animate-spin" /> : 'Save markup'}</button>
          {!changed && <span className="text-[0.82rem] text-slate-500">No changes to save.</span>}
        </div>
      </form>
      <p className="mt-3 text-[0.8rem] text-slate-500">Each booking stores the airline fare and the markup separately, so your earnings add up exactly (see the dashboard and each booking).</p>
      {m.history?.length > 0 && (
        <details className="mt-3 text-[0.85rem] text-slate-600">
          <summary className="cursor-pointer font-bold text-brand-500">Change history</summary>
          <ul className="mt-2 grid gap-1">{m.history.map((h, i) => <li key={i}>{whenFull(h.at)} · {h.by} · domestic {h.domestic.percent}% + {inr(h.domestic.flat)} · international {h.international.percent}% + {inr(h.international.flat)}</li>)}</ul>
        </details>
      )}
    </Card>
  )
}

export default function Settings() {
  const [o, setO] = useState(null)
  const [wallet, setWallet] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [purged, setPurged] = useState(null)
  useEffect(() => { crm('overview').then(setO).catch((e) => setErr(e.message)) }, [])

  const run = async (what, fn) => { setBusy(what); setErr(''); try { await fn() } catch (e) { setErr(e.message) } finally { setBusy('') } }
  return (
    <div className="grid max-w-3xl gap-5">
      <Err>{err}</Err>
      <Card title="This system">
        <dl className="grid grid-cols-[10rem_1fr] gap-y-1.5 text-[0.92rem]">
          <dt className="text-slate-500">Signed in as</dt><dd className="font-semibold">{getSession()?.email}</dd>
          <dt className="text-slate-500">TBO environment</dt><dd className="font-semibold">{o ? (o.env === 'live' ? 'Live (real tickets)' : 'Staging (test tickets)') : '…'}</dd>
          <dt className="text-slate-500">Payments</dt><dd className="font-semibold">{o?.payments || '…'}</dd>
          <dt className="text-slate-500">Markup</dt><dd className="font-semibold">{o ? `Domestic ${o.markup.domestic.percent}% + ${inr(o.markup.domestic.flat)} · International ${o.markup.international.percent}% + ${inr(o.markup.international.flat)}` : '…'}</dd>
        </dl>
        <button className={`${btnLight} mt-4`} onClick={signOut}><LogOut size={16} /> Sign out</button>
      </Card>

      <Markup onSaved={() => crm('overview').then(setO).catch(() => {})} />

      <Card title="TBO wallet">
        {wallet ? <p className="text-[0.95rem]">{wallet.agencyType} account · cash <strong>{inr(wallet.cash)}</strong> · credit <strong>{inr(wallet.credit)}</strong></p> : <p className="text-[0.9rem] text-slate-600">Tickets are paid from this balance. Check it before a busy day.</p>}
        <button className={`${btnLight} mt-3`} disabled={busy === 'wallet'} onClick={() => run('wallet', async () => setWallet(await crm('balance')))}>{busy === 'wallet' ? <Loader2 size={16} className="animate-spin" /> : <Wallet size={16} />} Check balance</button>
      </Card>

      <Card title="Export">
        <p className="text-[0.9rem] text-slate-600">Download everything as a spreadsheet (CSV). Filters on the Bookings and Enquiries tabs apply to their own export buttons.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={btnLight} onClick={() => run('e1', () => download('bookings'))}><Download size={16} /> All bookings</button>
          <button className={btnLight} onClick={() => run('e2', () => download('enquiries'))}><Download size={16} /> All enquiries</button>
        </div>
      </Card>

      <Card title="Privacy clean-up">
        <p className="text-[0.9rem] text-slate-600">Our Privacy Policy says enquiries that do not become a booking are deleted within 12 months. This deletes enquiries older than 12 months, except the ones marked <strong>Won</strong>. Bookings and payment records are kept (the law requires 8 years).</p>
        <label className="mt-3 flex items-center gap-2 text-[0.9rem] font-semibold"><input type="checkbox" className="h-4 w-4" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I understand this cannot be undone</label>
        <button className={`${btnDark} mt-3`} disabled={!confirm || busy === 'purge'} onClick={() => run('purge', async () => { setPurged(await crm('purge', { confirm: true, months: 12 }, 'POST')); setConfirm(false) })}>{busy === 'purge' ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Delete old enquiries</button>
        {purged && <p className="mt-3 text-[0.9rem] font-semibold text-emerald-800">Deleted {purged.deleted} enquir{purged.deleted === 1 ? 'y' : 'ies'} older than {purged.months} months.</p>}
      </Card>
    </div>
  )
}
