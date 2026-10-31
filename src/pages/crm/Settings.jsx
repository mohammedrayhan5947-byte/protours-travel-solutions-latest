import { useEffect, useState } from 'react'
import { Download, Loader2, LogOut, Trash2, Wallet } from 'lucide-react'

import { crm, download, getSession, signOut } from './api.js'
import { Card, Err, btnDark, btnLight, inr } from './ui.jsx'

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
          <dt className="text-slate-500">Service fee</dt><dd className="font-semibold">{o ? `${o.markupPercent}% on the airline fare` : '…'}</dd>
        </dl>
        <button className={`${btnLight} mt-4`} onClick={signOut}><LogOut size={16} /> Sign out</button>
      </Card>

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
