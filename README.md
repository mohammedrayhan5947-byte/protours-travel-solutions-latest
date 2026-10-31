# Pro Tours & Travel Solutions — website

Marketing website for **Pro Tours & Travel Solutions**, a travel agency at A.M. Plaza, Hospital Road,
Shivaji Nagar, Bengaluru (since 2009, IATA-accredited agent). Live at
<https://www.protoursandtravelsolutions.com>. Created and developed by [naazailabs.com](https://naazailabs.com).

## Stack

- **React 19 + Vite 7**, **Tailwind CSS v4**, **React Router 7**
- **GSAP 3.15** (ScrollTrigger, SplitText, DrawSVG, MotionPath) for scroll-driven motion, **Framer Motion** for UI transitions
- **Build-time pre-rendering** (React `prerenderToNodeStream`) so every route ships as real HTML
- Hosted on **Vercel**; two optional serverless functions in `api/` (Razorpay — currently unused by any page)

## Commands

```bash
npm install
npm run dev        # dev server on http://localhost:5173
npm run build      # client build + SSR build + pre-render every route into dist/
npm run build:spa  # client build only (no pre-render) — quicker, for debugging
npm run preview    # serve dist/ locally
```

## Project structure

```
index.html                 HTML shell. Route-specific <head> tags live between <!--seo:start--> / <!--seo:end-->
vercel.json                Clean URLs, apex→www redirect, security + cache headers (no SPA catch-all: real 404s)
scripts/prerender.mjs      Renders every route to dist/<route>.html, writes 404.html and sitemap.xml
public/                    Static files: logos, icons, og-image.jpg, robots.txt, llms.txt, site.webmanifest
api/                       Vercel serverless functions (Razorpay order + signature verification)
src/
  main.jsx                 Browser entry
  entry-server.jsx         Build-time entry used by the pre-renderer
  App.jsx                  Routes, page transitions, per-route <head> updates on navigation
  seo.js                   ★ Titles, descriptions, canonical URLs and JSON-LD for every route
  index.css                ★ Design tokens (palette, radii, shadows) + component classes
  data/site.js             ★ Business details, services, packages, reviews, FAQs, photo slots
  data/visas.js            Visa rules by country
  lib/gsap.js              GSAP plugin registration + shared easing / reduced-motion helpers
  lib/img.js               photo(url, { sizes }) → responsive srcset for Unsplash images
  components/
    fx.jsx                 Hand-made motion primitives (stamps, polaroids, circled words, flight path, …)
    motion.jsx             Scroll reveals, split headings, parallax, counters
    ui.jsx                 SectionHeading, PageHero, Accordion, Stars
    legal.jsx              Layout for the policy pages
    Navbar / Footer / FloatingActions (mobile contact bar) / EnquiryForm / SmoothScroll
  pages/                   One file per route (Home, Services, Packages, FlightsHotels, Umrah, Visa,
                           About, Contact, Terms, Privacy, RefundPolicy, Disclaimer, NotFound)
```

★ = the files you'll edit most.

## Editing content

- **Phone, email, address, hours** → `BIZ` in `src/data/site.js` (used everywhere, including structured data).
- **Packages, services, FAQs, reviews** → arrays in `src/data/site.js`. Prices are intentionally **not** shown anywhere.
- **Page titles / descriptions for Google** → `ROUTES` in `src/seo.js` (keep titles ≲ 60 and descriptions ≲ 160 characters).
- **Only publish figures the business can confirm** (no invented ratings, traveller counts or success rates).

### Adding the business's own photos

1. Put the files in `public/photos/` (e.g. `office-front.jpg`, ≈1600px wide JPG/WebP).
2. Set the path in `PHOTOS` in `src/data/site.js`, e.g. `office: '/photos/office-front.jpg'`.
3. Rebuild. Every page that shows that slot switches from the stock fallback to the real photo, and
   captions that say "our office" / "our team" only appear once a real photo is set.

## Adding a new page

1. Create `src/pages/MyPage.jsx` (default export).
2. Add a lazy import and `<Route>` in `src/App.jsx`.
3. Add its title, description and breadcrumb label to `ROUTES` in `src/seo.js` — the pre-renderer and sitemap pick it up automatically.
4. Code must be **SSR-safe**: no `window` / `document` / `localStorage` / `matchMedia` during render or at module top level — only in effects and event handlers. `npm run build` fails loudly if a page breaks this.

## Forms

The enquiry form opens WhatsApp with the message pre-filled (that part never depends on anything else) and also saves a
copy in the CRM so the desk can follow up. The form says so before sending and the Privacy Policy covers it
(`POST /api/enquiry`, saved only when Supabase is connected). Spam: a hidden field bots fill in, a per-IP limit, and a
10-minute duplicate check.

The visa data in `src/data/visas.js` is indicative and hand-maintained; review it regularly.

## Back office (CRM) — `/crm`

Staff-only: every flight booking (including abandoned and failed payments), every website enquiry, and the TBO API logs.

- **Bookings**: created when payment starts, updated when payment clears and the ticket is issued
  (`api/_lib/store.js`). Passengers, PNRs, ticket numbers, payment ids, a timeline, staff notes, status and assignee.
- **Enquiries**: status pipeline (new, contacted, quoted, won, lost), notes, one-tap WhatsApp / call / e-mail.
- **TBO logs**: every request and response, grouped by search (large search replies are stored as a summary).
- **Settings**: TBO wallet balance, CSV exports, and the 12-month enquiry clean-up the Privacy Policy promises.

**Set up once**
1. Supabase project: run `supabase/schema.sql` (SQL editor, or `DATABASE_URL=... node scripts/db-apply.mjs`). Safe to re-run.
2. Server settings (Vercel -> Environment Variables, Production; never prefix with `VITE_`):
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (the **secret** key), `SUPABASE_PUBLISHABLE_KEY`, `CRM_ALLOWED_EMAILS`
   (comma-separated staff e-mails; with this empty nobody can sign in).
3. Create each staff login: `node scripts/crm-add-staff.mjs name@example.com` (prints a password once).
   Signing in needs the Supabase account **and** the e-mail on `CRM_ALLOWED_EMAILS`.

Security notes: tables have row-level security with no public policies, so the browser can only reach data through
`/api/crm`, which checks the staff token's signature (Supabase public keys), expiry and the allow-list on every call.
The session lives in the browser tab only. Rotate the secret key if it is ever pasted somewhere it should not be.

## Motion & accessibility rules

- Animate only `transform`, `opacity` and `clip-path`. No smooth-scroll libraries, no `touch-action`,
  never `overflow-x` on `<html>` — each of these caused real mobile scroll bugs on this site before.
- Everything respects `prefers-reduced-motion` (see `reduceMotion()` in `src/lib/gsap.js`).
- Stamps and other scaled entrances near page edges must not push the page wider than the viewport.

## Deploying (Vercel)

- Framework preset **Vite**, build command `npm run build`, output directory `dist`.
- Add both `protoursandtravelsolutions.com` and `www.protoursandtravelsolutions.com`; **www is primary**
  (`vercel.json` already 308-redirects the bare domain to www).
- A commercial site should be on the **Pro** plan (Hobby is non-commercial only).
- Env vars (only if online payments are switched on again): `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
  (never prefix them with `VITE_`; they must stay server-side). See `.env.example`.

## Note on this machine's setup

Windows Application Control blocks Rollup's native binary (`@rollup/rollup-win32-x64-msvc`), which made
`vite dev` and `vite build` fail, so `package.json` overrides Rollup with its official WebAssembly build:
`"overrides": { "rollup": "npm:@rollup/wasm-node@^4.52.4" }`. Same output; remove it on machines
without that policy if you want the (faster) native binary.

## Launch checklist (needs the owner's accounts)

- [ ] Google Search Console (Domain property via DNS TXT) → submit `/sitemap.xml`, request indexing of key pages
- [ ] Bing Webmaster Tools (import from GSC) → submit sitemap (Bing also feeds ChatGPT search / Copilot)
- [ ] Google Business Profile: primary category "Travel agency", services, real photos, weekly posts, reply to reviews
- [ ] Same name/address/phone (NAP) everywhere: GBP, Bing Places, Apple Business Connect, Justdial, Sulekha, IndiaMART, Facebook, TripAdvisor
- [ ] Add those profile URLs to `sameAs` in `src/seo.js`
- [ ] Analytics (optional): Vercel Web Analytics (cookieless) or GA4 + Microsoft Clarity — GA4/Clarity need a consent banner under the DPDP Act
- [ ] Test link previews (WhatsApp / Facebook Sharing Debugger) and Google's Rich Results Test on `/`
