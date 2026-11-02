import { useEffect, useRef, useState } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Phone, Mail, MapPin, ArrowRight, UserRound } from 'lucide-react'
import { BIZ, NAV, waLink } from '../data/site.js'
import { lockScroll, scrollTo } from './SmoothScroll.jsx'
import { introDone } from './fx.jsx'
import { useAccount } from '../pages/account/session.js'

export default function Navbar() {
  const account = useAccount()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const burgerRef = useRef(null)
  const { pathname } = useLocation()

  // Clicking Home/the logo while already on "/" doesn't trigger a route
  // change, so SmoothScroll's pathname-based reset never fires — this
  // covers that case by scrolling to top directly on click.
  const goHome = () => {
    if (pathname === '/') scrollTo(0)
    setOpen(false)
  }

  // Only the home page has a full-bleed hero for the bar to float over.
  const overHero = pathname === '/' && !scrolled

  // Desktop link entrance waits for the first-visit intro curtain (with a
  // hard fallback so the links can never stay hidden).
  const [introReady, setIntroReady] = useState(false)
  useEffect(() => {
    let alive = true
    const done = () => alive && setIntroReady(true)
    introDone.then(done)
    const t = setTimeout(done, 3400)
    return () => { alive = false; clearTimeout(t) }
  }, [])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close the drawer on navigation, and lock body scroll while it is open.
  useEffect(() => setOpen(false), [pathname])

  // Escape closes the drawer; focus goes back to the trigger.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        burgerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  useEffect(() => {
    lockScroll(open)
    return () => lockScroll(false)
  }, [open])

  return (
    <>
      {/* ---------- Contact strip: numbers + email, no social icons ---------- */}
      <div className="hidden bg-navy-950 text-white/70 lg:block">
        <div className="wrap flex items-center justify-between gap-6 py-2.5 text-[0.92rem]">
          <div className="flex items-center gap-7">
            <a href={`tel:${BIZ.phone}`} className="flex items-center gap-2 transition-colors hover:text-gold-400">
              <Phone size={14} aria-hidden="true" className="text-gold-500" /> <span className="sr-only">Call </span>{BIZ.phoneDisplay}
            </a>
            <a href={`mailto:${BIZ.email}`} className="flex items-center gap-2 transition-colors hover:text-gold-400">
              <Mail size={14} aria-hidden="true" className="text-gold-500" /> <span className="sr-only">Email </span>{BIZ.email}
            </a>
            <a href={`mailto:${BIZ.email2}`} className="flex items-center gap-2 transition-colors hover:text-gold-400">
              <Mail size={14} aria-hidden="true" className="text-gold-500" /> <span className="sr-only">Email </span>{BIZ.email2}
            </a>
          </div>
          <div className="flex shrink-0 items-center gap-5">
            <a
              href={BIZ.mapsUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 transition-colors hover:text-gold-400"
            >
              <MapPin size={14} aria-hidden="true" className="text-gold-500" />
              A.M. Plaza, Hospital Road, Shivaji Nagar, Bengaluru 560001
            </a>
            <img src="/iata-logo.png" alt="IATA accredited travel agent" width={512} height={512} decoding="async" className="h-7 w-7 shrink-0" />
          </div>
        </div>
      </div>

      {/* ---------- Main bar ---------- */}
      <header
        className={`sticky top-0 z-50 transition-all duration-500 ${
          overHero
            ? 'bg-transparent'
            : 'border-b border-slate-200 bg-paper/[0.97] shadow-[0_10px_26px_-22px_rgb(60_40_20/0.5)]'
        }`}
      >
        <div className="wrap flex h-[74px] items-center justify-between gap-4">
          {/* Logo */}
          <Link to="/" onClick={goHome} className="flex shrink-0 items-center" aria-label={`${BIZ.name} — home`}>
            {/* White cut over the hero photography, full colour on the light bar */}
            <img
              src={overHero ? '/logo-white.png' : '/logo.png'}
              alt={BIZ.name}
              width={1200}
              height={209}
              className="h-10 w-auto sm:h-12 xl:h-10"
            />
          </Link>

          {/* Desktop links — the active pill glides between links (shared
              layoutId), and the row staggers in once the intro curtain lifts. */}
          <motion.nav
            className="hidden items-center xl:flex"
            aria-label="Main"
            initial="hidden"
            animate={introReady ? 'show' : 'hidden'}
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: 0.1 } } }}
          >
            {NAV.map((n) => (
              <motion.div
                key={n.to}
                variants={{
                  hidden: { opacity: 0, y: -10 },
                  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
                }}
              >
                <NavLink
                  to={n.to}
                  end={n.to === '/'}
                  onClick={n.to === '/' ? goHome : undefined}
                  className={({ isActive }) =>
                    `group relative isolate block rounded-md whitespace-nowrap px-2 py-2 font-display text-[0.86rem] font-semibold transition-colors duration-250 ${
                      overHero
                        ? isActive ? 'text-white' : 'text-white/85 hover:text-white'
                        : isActive ? 'text-navy-950' : 'text-body hover:text-navy-950'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {/* Active page: a small hand-drawn underline that glides
                          between links (shared layoutId) instead of a pill. */}
                      {isActive && (
                        <motion.svg
                          layoutId="nav-active-mark"
                          aria-hidden="true"
                          focusable="false"
                          viewBox="0 0 40 8"
                          preserveAspectRatio="none"
                          fill="none"
                          transition={{ type: 'spring', stiffness: 380, damping: 34 }}
                          className={`pointer-events-none absolute right-2 bottom-[1px] left-2 h-[6px] ${overHero ? 'text-gold-400' : 'text-gold-600'}`}
                        >
                          <path d="M1.5 5.2C8 2.2 14 2 20 4.1s12 2.3 18.5-.9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                        </motion.svg>
                      )}
                      {n.label}
                    </>
                  )}
                </NavLink>
              </motion.div>
            ))}
          </motion.nav>

          {/* Right side */}
          <div className="flex items-center gap-2.5">
            <Link
              to="/account"
              title={account ? 'My trips' : 'Sign in'}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-2 font-display text-[0.86rem] font-semibold whitespace-nowrap transition-colors ${overHero ? 'text-white/90 hover:text-white' : 'text-body hover:text-navy-950'}`}
            >
              <UserRound size={18} aria-hidden="true" />
              {/* the label only where there is room: phones/tablets and very wide screens; icon alone in between */}
              <span className="sr-only sm:not-sr-only xl:sr-only 2xl:not-sr-only">{account ? 'My trips' : 'Sign in'}</span>
            </Link>
            <a
              href={waLink()} target="_blank" rel="noopener noreferrer"
              className="btn btn-gold hidden !px-5 !py-2.5 !text-[0.97rem] sm:inline-flex"
            >
              Get a Quote <span className="sr-only">on WhatsApp</span> <ArrowRight size={15} aria-hidden="true" />
            </a>

            {/* Three-line hamburger — plain icon, no box, just a tap target */}
            <button
              ref={burgerRef}
              onClick={() => setOpen((v) => !v)}
              type="button"
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              aria-controls="mobile-menu"
              className="grid h-11 w-11 shrink-0 place-items-center gap-[4px] xl:hidden"
            >
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  aria-hidden="true"
                  animate={
                    open
                      ? i === 0 ? { rotate: 45, y: 6.5 } : i === 1 ? { opacity: 0, scaleX: 0 } : { rotate: -45, y: -6.5 }
                      : { rotate: 0, y: 0, opacity: 1, scaleX: 1 }
                  }
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className={`block h-[2.5px] w-5 rounded-full ${overHero ? 'bg-white' : 'bg-navy-900'}`}
                />
              ))}
            </button>
          </div>
        </div>
      </header>

      {/*
        Mobile drawer — deliberately NOT gated by AnimatePresence mount/unmount.
        Real bug found via testing the production bundle (not the dev server):
        AnimatePresence keeps the exiting backdrop/panel mounted, at full size,
        until Framer Motion's exit transition reports complete. If that never
        fires cleanly on a given device (a throttled/backgrounded phone, low
        power mode, or any rAF hiccup — the same class of thing we've hit with
        this animation stack before), the fixed inset-0 backdrop stays mounted
        and can keep intercepting scroll/tap input over the whole page even
        though `open` has already gone back to false and the button no longer
        looks pressed.
        Fix: keep both elements permanently mounted, animate them by feeding
        `open` into `animate` (not by mounting/unmounting), and tie
        `pointerEvents` directly to the `open` boolean via inline style —
        that applies in the same render as the state change, synchronously,
        regardless of whether any animation ever finishes.
      */}
      <motion.div
        initial={false}
        animate={{ opacity: open ? 1 : 0 }}
        transition={{ duration: 0.3 }}
        onClick={() => setOpen(false)}
        style={{ pointerEvents: open ? 'auto' : 'none' }}
        aria-hidden={!open}
        className="fixed inset-0 z-40 bg-navy-950/70 backdrop-blur-sm xl:hidden"
      />
      <motion.nav
        initial={false}
        animate={{ x: open ? 0 : '100%' }}
        transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
        style={{ pointerEvents: open ? 'auto' : 'none' }}
        aria-hidden={!open}
        // Closed = off-screen: `inert` also takes its links out of the tab
        // order, so keyboard focus can't land on hidden items.
        inert={!open}
        id="mobile-menu"
        className="fixed top-0 right-0 z-50 flex h-[100dvh] w-[86%] max-w-sm flex-col overflow-y-auto bg-navy-950 px-7 pt-7 pb-10 xl:hidden"
        aria-label="Mobile"
      >
              <div className="mb-8 flex items-center justify-between">
                <span className="font-display text-[0.75rem] font-bold uppercase tracking-[0.3em] text-gold-400">
                  Menu
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 bg-white/5 text-white"
                >
                  <span className="relative block h-4 w-4">
                    <span className="absolute top-1/2 left-0 block h-[2.5px] w-4 -translate-y-1/2 rotate-45 rounded-full bg-white" />
                    <span className="absolute top-1/2 left-0 block h-[2.5px] w-4 -translate-y-1/2 -rotate-45 rounded-full bg-white" />
                  </span>
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                {NAV.map((n, i) => (
                  <motion.div
                    key={n.to}
                    initial={false}
                    // Tied to `open` (not mount) since the drawer itself no longer
                    // remounts on every open — otherwise this stagger only ever
                    // played once, on first page load.
                    animate={open ? { opacity: 1, x: 0 } : { opacity: 0, x: 28 }}
                    transition={{ delay: open ? 0.1 + i * 0.055 : 0, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <NavLink
                      to={n.to}
                      end={n.to === '/'}
                      onClick={n.to === '/' ? goHome : undefined}
                      className={({ isActive }) =>
                        `flex items-center justify-between rounded-2xl px-5 py-4 font-display text-[1.19rem] font-bold transition-colors ${
                          isActive ? 'bg-gold-500 text-navy-950' : 'text-white/85 hover:bg-white/10'
                        }`
                      }
                    >
                      {n.label} <ArrowRight size={17} aria-hidden="true" />
                    </NavLink>
                  </motion.div>
                ))}
              </div>

              <div className="mt-auto space-y-3 pt-9">
                <Link to="/account" className="btn w-full border-white/30 text-white hover:border-white/70"><UserRound size={16} aria-hidden="true" /> {account ? 'My trips' : 'Sign in / Create account'}</Link>
                <a href={waLink()} target="_blank" rel="noopener noreferrer" className="btn btn-wa w-full">
                  Chat on WhatsApp<span className="sr-only"> with {BIZ.shortName}</span>
                </a>
                <a href={`tel:${BIZ.phone}`} className="btn w-full border-white/30 text-white hover:border-white/70">
                  <Phone size={16} aria-hidden="true" /> <span className="sr-only">Call </span>{BIZ.phoneDisplay}
                </a>
                <a
                  href={`mailto:${BIZ.email}`}
                  className="flex items-center justify-center gap-2 pt-2 text-[0.97rem] text-white/60 hover:text-gold-400"
                >
                  <Mail size={14} aria-hidden="true" /> <span className="sr-only">Email </span>{BIZ.email}
                </a>
                <a
                  href={`mailto:${BIZ.email2}`}
                  className="flex items-center justify-center gap-2 text-[0.97rem] text-white/60 hover:text-gold-400"
                >
                  <Mail size={14} aria-hidden="true" /> <span className="sr-only">Email </span>{BIZ.email2}
                </a>
                <img
                  src="/iata-logo.png" alt="IATA accredited travel agent"
                  width={512} height={512} loading="lazy" decoding="async"
                  className="mx-auto h-10 w-10 pt-2"
                />
              </div>
            </motion.nav>
    </>
  )
}
