import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { crm } from './api.js'
import { Card, Drawer, Empty, Err, Pill, BOOKING_STATUS, btnLight, when } from './ui.jsx'

/** Pretty JSON, long strings cut for display only (the CRM never edits what TBO sent or returned). */
export function Json({ data }) {
  const text = JSON.stringify(data, null, 2)
  return (
    <>
      <div className="mb-2 flex justify-end"><button className={btnLight} onClick={() => navigator.clipboard?.writeText(text)}>Copy JSON</button></div>
      <pre className="max-h-[70vh] overflow-auto rounded-xl bg-navy-950 p-4 text-[0.78rem] leading-relaxed text-emerald-100">{text.length > 400_000 ? text.slice(0, 400_000) + '\n… (cut for display)' : text}</pre>
    </>
  )
}

/** TBO API traces: every request and response TBO asked us to keep, grouped by TraceId. */
export default function Logs({ onOpenBooking }) {
  const [list, setList] = useState(null)
  const [err, setErr] = useState('')
  const [view, setView] = useState(null)
  useEffect(() => { crm('traces').then(setList).catch((e) => setErr(e.message)) }, [])
  const open = async (t) => { try { setView({ title: `Trace ${t.traceId}`, data: await crm('trace', { id: t.traceId }) }) } catch (e) { setErr(e.message) } }
  return (
    <div className="grid gap-4">
      <Card title="TBO API traces" right={<span className="text-[0.8rem] text-slate-500">Most recent 60</span>}>
        <p className="text-[0.88rem] text-slate-600">Every request and response between this site and TBO, as JSON, grouped by the search that started it. Large search replies are stored as a summary.</p>
      </Card>
      <Err>{err}</Err>
      {!list ? <Empty><Loader2 className="mx-auto animate-spin" /></Empty> : !list.length ? <Empty>No TBO calls recorded yet.</Empty> : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[40rem] text-left text-[0.88rem]">
            <thead className="bg-sand/70 text-[0.72rem] tracking-wide text-slate-600 uppercase"><tr>{['Started', 'Trace', 'Calls', 'Methods', 'Booking', ''].map((h) => <th key={h} className="px-3 py-2.5">{h}</th>)}</tr></thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.traceId} className="border-t border-slate-100">
                  <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{when(t.at)}</td>
                  <td className="px-3 py-2.5 font-mono text-[0.75rem]">{t.traceId.slice(0, 13)}…</td>
                  <td className="px-3 py-2.5">{t.calls}</td>
                  <td className="px-3 py-2.5 text-slate-600">{t.methods.join(' · ')}</td>
                  <td className="px-3 py-2.5">{t.booking ? <button className="font-bold text-brand-500 underline" onClick={() => onOpenBooking(t.booking.id)}>{t.booking.order_ref}</button> : <span className="text-slate-400">search only</span>}{t.booking && <span className="ml-2"><Pill status={t.booking.status} map={BOOKING_STATUS} /></span>}</td>
                  <td className="px-3 py-2.5 text-right"><button className={btnLight} onClick={() => open(t)}>View JSON</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view && <Drawer title={view.title} onClose={() => setView(null)}><Json data={view.data} /></Drawer>}
    </div>
  )
}
