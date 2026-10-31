import { lazy, Suspense, useEffect, useState } from 'react'
import { LayoutDashboard, Loader2, MessageSquareText, Plane, ScrollText, Settings as Cog } from 'lucide-react'

import { getSession, onSession } from './crm/api.js'
import Login from './crm/Login.jsx'

const Dashboard = lazy(() => import('./crm/Dashboard.jsx'))
const Bookings = lazy(() => import('./crm/Bookings.jsx'))
const Enquiries = lazy(() => import('./crm/Enquiries.jsx'))
const Logs = lazy(() => import('./crm/Logs.jsx'))
const Settings = lazy(() => import('./crm/Settings.jsx'))

const TABS = [
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['bookings', 'Bookings', Plane],
  ['enquiries', 'Enquiries', MessageSquareText],
  ['logs', 'TBO logs', ScrollText],
  ['settings', 'Settings', Cog],
]

/** Back office: all flight bookings, all website enquiries, and the TBO call logs. Staff sign-in only. */
export default function Crm() {
  const [session, setSession] = useState(getSession)
  const [tab, setTab] = useState('dashboard')
  const [booking, setBooking] = useState(null)
  const [enquiry, setEnquiry] = useState(null)

  useEffect(() => onSession(setSession), [])
  useEffect(() => {
    // the back office must never show up in search results
    const m = document.createElement('meta')
    m.name = 'robots'; m.content = 'noindex, nofollow'
    document.head.appendChild(m)
    return () => m.remove()
  }, [])

  const goBooking = (id) => { setBooking(id); if (tab !== 'bookings') setTab('bookings') }
  const goEnquiry = (id) => { setEnquiry(id); if (tab !== 'enquiries') setTab('enquiries') }

  return (
    <section className="min-h-screen bg-paper pt-28 pb-16 md:pt-36">
      <div className="wrap">
        {!session ? <Login /> : (
          <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h1 className="font-display text-[1.6rem] font-bold text-ink">Back office</h1>
              <p className="text-[0.85rem] text-slate-500">{session.email}</p>
            </div>
            <nav aria-label="CRM sections" className="mb-6 flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
              {TABS.map(([id, label, Icon]) => (
                <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}
                  className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-[0.92rem] font-bold ${tab === id ? 'bg-navy-950 text-white' : 'text-slate-700 hover:bg-sand'}`}><Icon size={17} /> {label}</button>
              ))}
            </nav>
            <Suspense fallback={<Loader2 className="mx-auto mt-10 animate-spin" />}>
              {tab === 'dashboard' && <Dashboard go={setTab} onOpenBooking={goBooking} onOpenEnquiry={goEnquiry} />}
              {tab === 'bookings' && <Bookings openId={booking} onOpen={setBooking} />}
              {tab === 'enquiries' && <Enquiries openId={enquiry} onOpen={setEnquiry} />}
              {tab === 'logs' && <Logs onOpenBooking={goBooking} />}
              {tab === 'settings' && <Settings />}
            </Suspense>
          </>
        )}
      </div>
    </section>
  )
}
