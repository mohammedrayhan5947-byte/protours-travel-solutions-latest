import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Phone, ArrowUp, MessageSquareText } from 'lucide-react'
import { BIZ, waLink } from '../data/site.js'
import { scrollTo } from './SmoothScroll.jsx'

/** Inline WhatsApp glyph — lucide has no official WhatsApp mark. */
const WhatsAppIcon = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.65-2.05-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35zM12.04 21.5h-.01a9.4 9.4 0 0 1-4.79-1.31l-.34-.2-3.56.93.95-3.47-.22-.36a9.38 9.38 0 0 1-1.44-5.01c0-5.19 4.23-9.41 9.42-9.41a9.36 9.36 0 0 1 9.41 9.42c0 5.19-4.23 9.41-9.42 9.41zM20.5 3.49A11.79 11.79 0 0 0 12.04 0C5.5 0 .18 5.32.18 11.86c0 2.09.55 4.13 1.59 5.93L.08 24l6.36-1.66a11.85 11.85 0 0 0 5.6 1.42h.01c6.54 0 11.86-5.32 11.86-11.86 0-3.17-1.23-6.15-3.41-8.41z" />
  </svg>
)

/* The WhatsApp message opens with what the visitor was looking at, so
   the desk can reply with something useful instead of "how can I help?". */
const CONTEXT = {
  '/packages': 'I was looking at your tour packages',
  '/umrah': 'I would like to know about your Umrah packages',
  '/visa': 'I need help with a visa',
  '/flights-hotels': 'I need a flight / hotel booking',
  '/services': 'I was looking at your services',
}

export default function FloatingActions() {
  const { pathname } = useLocation()
  const [showTop, setShowTop] = useState(false)

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 700)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Booking page: a focused checkout. The floating contact controls would sit on top of the Book/Pay buttons;
  // the page carries its own "Need help?" line instead.
  if (pathname === '/book-flights') return null

  const context = CONTEXT[pathname]
  const wa = waLink(context ? `Hello ${BIZ.name}, ${context}.` : undefined)

  // The back office (/crm) is staff-only: no customer contact buttons over its tables.
  if (pathname === '/crm') return null
  if (pathname === '/account') return null // sign-in forms and e-tickets: nothing floating over them

  return (
    <>
      {/* ---------- Desktop: one clear WhatsApp button + back to top ---------- */}
      <div className="fixed right-6 bottom-6 z-40 hidden flex-col items-end gap-3 lg:flex">
        <AnimatePresence>
          {showTop && (
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.25 }}
              onClick={() => scrollTo(0)}
              aria-label="Back to top"
              className="grid h-11 w-11 place-items-center rounded-xl border border-slate-300 bg-white text-navy-900 shadow-[var(--shadow-lift)] transition-colors hover:border-navy-900"
            >
              <ArrowUp size={18} strokeWidth={2.3} />
            </motion.button>
          )}
        </AnimatePresence>
        <motion.a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="btn btn-wa !gap-2.5 !rounded-2xl !px-5 !py-3.5 !text-[0.98rem]"
        >
          <WhatsAppIcon size={21} />
          Chat on WhatsApp
        </motion.a>
      </div>

      {/* ---------- Mobile: a slim bottom bar, WhatsApp first ---------- */}
      <nav
        aria-label="Contact"
        className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-sm lg:hidden"
      >
        <div className="mx-auto flex max-w-lg items-stretch gap-2 px-3 py-2.5">
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[48px] flex-[1.6] items-center justify-center gap-2 rounded-xl bg-palm font-display text-[0.98rem] font-bold text-white active:scale-[0.98]"
          >
            <WhatsAppIcon size={20} /> WhatsApp us
          </a>
          <a
            href={`tel:${BIZ.phone}`}
            aria-label={`Call ${BIZ.phoneDisplay}`}
            className="flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-300 font-display text-[0.95rem] font-bold text-navy-900 active:scale-[0.98]"
          >
            <Phone size={17} strokeWidth={2.3} /> Call
          </a>
          <Link
            to="/contact"
            className="flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-300 font-display text-[0.95rem] font-bold text-navy-900 active:scale-[0.98]"
          >
            <MessageSquareText size={17} strokeWidth={2.3} /> Enquire
          </Link>
        </div>
      </nav>
      {/* Keeps the footer's last lines from sitting under the bar. */}
      <div aria-hidden="true" className="h-[72px] lg:hidden" />
    </>
  )
}
