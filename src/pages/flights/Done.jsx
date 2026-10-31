import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, Loader2, MessageCircle, Phone, Printer, Plane } from 'lucide-react'

import { BIZ, waLink } from '../../data/site.js'
import { dateLabel, inr, time } from './shared.jsx'
import { TICKET_AGENCY, downloadTicket } from './ticket.js'

/* Confirmation: a printable e-ticket per booking. If the airline did not finish ticketing yet
   (payment is safe), we say so plainly and give the reference to quote. */

export default function Done({ done, contactEmail, onNew }) {
  const ok = done.results.every((r) => r.bookingId && !r.error)
  const issued = done.results.some((r) => r.bookingId && !r.error)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const save = async () => { setSaving(true); setSaveErr(''); try { await downloadTicket(done) } catch (e) { setSaveErr(e.message || 'Could not create the PDF. Please use Print instead.') } finally { setSaving(false) } }
  return (
    <div className="mx-auto max-w-3xl">
      <div className={`rounded-3xl p-6 text-center md:p-8 ${ok ? 'bg-palm/10' : 'bg-gold-500/15'}`}>
        {ok ? <CheckCircle2 className="mx-auto text-palm" size={52} /> : <AlertTriangle className="mx-auto text-gold-600" size={52} />}
        <h2 className="mt-3 font-display text-[1.7rem] leading-tight font-bold text-ink">{ok ? 'Booking confirmed' : 'Payment received, finishing your booking'}</h2>
        <p className="mt-2 text-slate-700">
          {ok ? <>Your e-ticket is below. Download it as a PDF{contactEmail ? <> and keep it with <strong>{contactEmail}</strong> handy for check-in</> : ''}.</> : 'The airline is still confirming. Our team is completing it now and will contact you. You have not been charged twice, and nothing needs to be repeated.'}
        </p>
        <p className="mt-3 inline-block rounded-full bg-white px-4 py-1.5 text-[0.92rem] shadow-sm">Reference <strong className="font-mono">{done.orderRef}</strong> · Paid <strong>{inr(done.amount)}</strong></p>
      </div>

      <div className="eticket mt-6 grid gap-5">
        {done.results.map((r, i) => (
          <article key={i} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b-2 border-brand-500 px-5 py-4">
              <img src="/logo.png" alt="Pro Tours & Travel Solutions" width="1200" height="209" className="h-9 w-auto max-w-full" />
              <address className="text-[0.74rem] leading-snug text-slate-600 not-italic sm:text-right">
                <strong className="block text-ink">{TICKET_AGENCY.name}</strong>
                {TICKET_AGENCY.lines.map((l) => <span key={l} className="block">{l}</span>)}
              </address>
            </div>
            <header className="flex flex-wrap items-center justify-between gap-3 bg-navy-950 px-5 py-4 text-white">
              <p className="flex items-center gap-2 font-display text-[1.05rem] font-bold"><Plane size={18} className="rotate-45 text-gold-400" /> E-ticket{done.results.length > 1 ? ` ${i + 1} of ${done.results.length}` : ''}</p>
              <p className="text-[0.9rem]">PNR <strong className="ml-1 font-mono text-[1.25rem] tracking-widest text-gold-400">{r.pnr || 'pending'}</strong></p>
            </header>
            <div className="p-5">
              {r.error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-red-700">{r.error}</p>}
              <div className="grid gap-3">
                {r.details?.segments?.map((s, k) => (
                  <div key={k} className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-dashed border-slate-200 pb-3 last:border-0">
                    <div><p className="font-display text-[1.15rem] font-bold text-ink">{s.from} → {s.to}</p><p className="text-[0.88rem] text-slate-600">{s.airline ? `${s.airline} ` : ''}{s.flight} · {dateLabel(s.dep)}</p>{(s.fromTerminal || s.toTerminal || s.baggage) && <p className="text-[0.78rem] text-slate-500">{[s.fromTerminal && `Departs T${s.fromTerminal}`, s.toTerminal && `Arrives T${s.toTerminal}`, s.baggage && `Check-in ${s.baggage}`, s.cabinBaggage && `Cabin ${s.cabinBaggage}`].filter(Boolean).join(' · ')}</p>}</div>
                    <p className="text-right font-display text-[1.4rem] font-bold text-ink">{time(s.dep)}{s.arr && <span className="block text-[0.8rem] font-semibold text-slate-500">arr. {time(s.arr)}</span>}</p>
                  </div>
                ))}
              </div>
              {r.details?.passengers?.length > 0 && (
                <table className="mt-4 w-full text-left text-[0.92rem]">
                  <thead><tr className="text-[0.72rem] tracking-wide text-slate-500 uppercase"><th className="py-1">Traveller</th><th className="py-1">Ticket number</th></tr></thead>
                  <tbody>{r.details.passengers.map((p, k) => <tr key={k} className="border-t border-slate-100"><td className="py-2 font-semibold text-ink">{p.name}</td><td className="py-2 font-mono text-slate-700">{p.ticket || 'issuing…'}</td></tr>)}</tbody>
                </table>
              )}
              <p className="mt-3 text-[0.8rem] text-slate-500">Booking ID {r.bookingId || 'pending'}. Carry a valid photo ID (passport for international travel). Web check-in opens on the airline's website.</p>
            </div>
          </article>
        ))}
      </div>

      {saveErr && <p role="alert" className="mt-4 text-center font-semibold text-red-700">{saveErr}</p>}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {issued && <button type="button" className="btn btn-gold" onClick={save} disabled={saving}>{saving ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />} Download e-ticket (PDF)</button>}
        <button type="button" className="btn btn-ghost" onClick={() => window.print()}><Printer size={17} /> Print</button>
        <a className="btn btn-wa" href={waLink(`Hi, I need help with my flight booking ${done.orderRef}.`)}><MessageCircle size={17} /> WhatsApp us</a>
        <a className="btn btn-ghost" href={`tel:${BIZ.phone}`}><Phone size={17} /> {BIZ.phoneDisplay}</a>
        <button type="button" className="btn btn-brand" onClick={onNew}>Book another flight</button>
      </div>
    </div>
  )
}
