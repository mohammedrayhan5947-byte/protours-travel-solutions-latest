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

### Testing the CRM on your own computer

`npm run dev` also serves `/api/*` (see `vite.config.js`), so the whole CRM works locally against your real Supabase project.

1. In `.env.local` (never committed) set `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_PUBLISHABLE_KEY` and
   `CRM_ALLOWED_EMAILS=you@example.com`.
2. `node scripts/crm-add-staff.mjs you@example.com` and note the password it prints once.
3. `npm run dev`, open `http://localhost:5173/crm` and sign in.
4. Put something in it: send an enquiry from the Contact page, or make a staging booking at `/book-flights`
   (`TBO_ENV=staging`, `ALLOW_FAKE_PAYMENTS=true` and an empty `RAZORPAY_KEY_ID` book without a card).
5. Check: the Dashboard numbers, open a booking (timeline, travellers, TBO calls), change a status and add a note,
   search and filter, export a CSV, then Settings: wallet balance. Staging data is labelled "Test mode".
6. Negative checks: open `/crm` signed out (login only), sign in with an account that is not on `CRM_ALLOWED_EMAILS` (refused).

### Price markup (CRM, Settings)

Staff set what is added to the airline's fare, separately for **domestic** and **international** flights, as a **percentage**, a **flat rupee amount**, or both:

`customer pays = airline fare + fare x % + flat x (adults + children)`, rounded up to a whole rupee (`api/_lib/markup.js`).

- The flat amount is per adult and per child, per ticket (a domestic return is two tickets). Infants only carry the percentage.
- Limits: 0 to 50 % and 0 to Rs 5,000 per traveller; changing it needs a confirmation and is written to the audit log and a 10-entry history in Settings.
- It is stored in the database and every server instance re-reads it at most once a minute, so a change is live within about a minute. A booking already in checkout keeps the price it was quoted.
- If the database cannot be reached, the last known setting is used; if there never was one, the old `FLIGHT_MARKUP_PERCENT` environment value (default 0) applies. That variable is now only this fallback.
- Every booking stores the airline fare and the markup separately (`fare_inr`, `markup_inr`), so earnings add up exactly: the dashboard shows "Markup earned" for today, 7 and 30 days (ticketed bookings), and each booking shows its split.
- Requires re-running `supabase/schema.sql` (new columns and two settings functions).

### Running it on the free tiers (Vercel Hobby + Supabase Free)

- **One database trip per action.** Dashboard, booking panel, saves, enquiries and the booking path each call a single
  function in `supabase/schema.sql` instead of 2 to 5 queries (Vercel to Supabase crosses a region, so trips cost time).
  TBO logs are written in one bulk insert per request, and big Search replies are stored as a summary.
- **Daily cron (`/api/cron`, set `CRON_SECRET` in Vercel).** The free Vercel plan allows one cron run per day. It keeps the
  free Supabase project awake (Supabase pauses free projects after a week without activity, which would switch off booking
  records and the CRM), deletes TBO logs older than `TBO_LOG_RETENTION_DAYS` (default 60) so the 500 MB database never
  fills, and deletes enquiries older than 12 months that did not become a booking.
- **Dashboard refresh** is every 5 minutes and only while the tab is visible.
- **Function region.** The TBO gateway is in Mumbai. In Vercel, Project Settings, Functions, set the region to Mumbai
  (`bom1`) if your plan offers it: every TBO call then travels a few kilometres instead of across the world.
- **Vercel Hobby is for non-commercial use**, and its limits change: check vercel.com/docs/limits before launch.

### Security checklist for the owner (things only the Supabase dashboard can do)

1. Customers sign up on the same Supabase project (see "Customer accounts" below), so sign-ups stay **on** and "Confirm email" stays **on**.
   Staff access is separate: a login only opens the CRM if its e-mail is on `CRM_ALLOWED_EMAILS` *and* confirmed (checked against Supabase, not the token).
2. Use passwords of 12+ characters for staff (`scripts/crm-add-staff.mjs` generates one) and never reuse them.
3. Keep `CRM_ALLOWED_EMAILS` to the people who need it; remove an e-mail the day someone leaves
   (their current session ends within the hour, and the 30-minute idle sign-out applies).
4. Rotate the Supabase **secret** key and the database password if they were ever shared in chat or e-mail.
5. Tables, functions and sequences are closed to the public key (row-level security plus revoked privileges); if you add
   tables later, enable row-level security on them and revoke `anon` / `authenticated` the same way.

## Customer accounts: sign up, sign in, My trips: `/account`

Customers can book as guests or create an account (Supabase Auth, called from `api/account.js`; the browser never talks to Supabase).
An account shows **My trips**: every booking made while signed in, plus older guest bookings made with the same *confirmed* e-mail,
with status, tickets, a progress timeline and the PDF e-ticket. The customer's token is attached to checkout (`api/flights.js` verifies it
and passes the user id, never trusting the request body). Customers see only customer-safe columns (`acct_bookings`, `acct_booking` in
`supabase/schema.sql`): no staff notes, assignee or TBO error text.

One-time setup (Supabase dashboard + one SQL run):

1. Run `supabase/schema.sql` again (adds `flight_bookings.user_id` and the two `acct_*` functions; safe to re-run).
2. Authentication, Sign In / Providers, Email: **Allow new users to sign up** ON, **Confirm email** ON.
3. Authentication, URL Configuration: Site URL = `https://www.protoursandtravelsolutions.com`; add `https://www.protoursandtravelsolutions.com/account`
   under Redirect URLs (confirmation and password-reset links return there). Optional env `SITE_URL` overrides the host used in those links.
4. Authentication, SMTP Settings: set a real SMTP provider (Resend, Brevo, Amazon SES...). Supabase's built-in mail sender allows only a few
   e-mails per hour, which is fine for testing and not for customers. Edit the e-mail templates (Confirm signup, Reset password) to carry your name.

**Continue with Google** (Firebase Authentication is only the doorway to Google): the button opens Google's sign-in window and returns a
signed ID token; `api/account.js` (`action: google`, `api/_lib/google.js`) verifies it against Google's certificates (signature, our
Firebase project, issuer, expiry, provider = google.com, e-mail verified) and turns the e-mail into an ordinary Supabase session, so My trips,
bookings and the CRM rules are identical to password accounts. The same e-mail used both ways is one account. If someone had registered an
address with a password before its owner confirmed it, that password is cleared when the owner signs in with Google. The Firebase web config
in `src/pages/account/google.js` is public by design. Firebase is not kept in the browser after sign-in, and no Firebase Analytics is used.
In the Firebase console (project `sajjad-9c9d7`): Authentication, Sign-in method, Google = enabled; Settings, Authorized domains must include
`www.protoursandtravelsolutions.com`, `protoursandtravelsolutions.com` and `localhost` (Vercel preview URLs too, if you test on them).
The Content-Security-Policy in `vercel.json` allows exactly the Google/Firebase hosts this needs. `FIREBASE_PROJECT_ID` overrides the project id.

Limits and notes: customer sessions are kept in the browser (localStorage) so they stay signed in; sign-in guesses are throttled per IP and per
e-mail; password resets and sign-ups are rate-limited; an account is deleted from Authentication, Users in the dashboard.

## Card payments (Razorpay): how the money is kept safe

Flow: the server prices the booking and creates a Razorpay **order** for exactly that amount (`api/_lib/flights.js` checkout, `api/_lib/pay.js`) -> the
customer pays on Razorpay's own Checkout (card details never touch this site or server) -> the server confirms the payment with Razorpay, and only then
buys the ticket from TBO.

What each protection does:

- **Amount decided by the server**, from the sealed fare quote. The browser can send nothing that changes what is charged.
- **A payment only counts after Razorpay's own API says so**: right order, right amount, INR, captured. A payment that is merely *authorized* is captured by us first
  (works with either capture setting). The browser's signature is also checked (constant-time) but is never the only proof.
- **One payment, one ticket.** The booking is claimed by exactly one caller in a single database statement (`crm_claim_ticketing`), so a double click, a retry, a reload,
  or the webhook racing the browser can never buy two tickets, and one Razorpay payment id can never pay for two bookings (unique index).
- **Webhook** (`api/razorpay-webhook.js`): if the customer pays and closes the browser, Razorpay tells us and the ticket is issued anyway. Signature over the raw body,
  each delivery processed once, answered at once and worked on afterwards. It waits 20 s first so the customer's own browser normally finishes the booking.
- **Fare hold**: TBO holds a search 15 minutes. Payment is refused when under 4 minutes remain, and the Checkout window closes itself before the hold ends.
  If someone still pays late, the booking is flagged **needs attention** (never silently lost) so staff refund or complete it.
- **Daily payment check** (`api/cron.js`): any booking still "awaiting payment" after 20 minutes is compared with Razorpay; money found with no ticket is flagged.
- **Refunds** (CRM, booking panel): staff only, reason required, full or partial, can never exceed what was paid, idempotent (a double click refunds once), written to the
  timeline and the audit log. A refund returns the money to the card; cancelling the airline ticket is a separate step with TBO.
- **Live and test cannot be mixed**: live Razorpay keys are refused while TBO is in test mode and the reverse, because either mix charges real money for no ticket or
  issues real tickets for no money. Fake (no-card) payments are impossible on live. Order/ticket requests are rate-limited per address.
- Secrets (`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) exist only in server environment variables. The sealed checkout data kept for the webhook is encrypted, never shown in the CRM
  or to customers, and cleared the moment ticketing finishes (and after a day regardless).

Set up in the Razorpay dashboard: API Keys (live key id + secret), Settings -> Webhooks (URL, secret, events as listed in `.env.vercel-live`), and under Payments,
leave capture on **automatic** (manual capture also works because the server captures, but automatic is simpler). Test the webhook with Razorpay's "Send test webhook"
button, then one real small booking.

## Going live (real tickets, real money)

Test and live must switch together; the site refuses to take card payments when they disagree (`paymentModeProblem` in `api/_lib/flights.js`).

1. **Relay first.** TBO's live host list is different (search/fare calls on `tboapi.travelboutiqueonline.com`, Book/Ticket/GetBookingDetails on
   `booking.travelboutiqueonline.com`, login on `api.travelboutiqueonline.com/SharedAPI`). When `TBO_RELAY_URL` is set, the Lightsail relay decides which
   TBO it calls (its `TBO_*_UPSTREAM` settings), so point those at the live hosts and restart the relay. The relay's IP is the one TBO whitelisted.
2. **Vercel Production variables:** copy from `.env.vercel-live` (git-ignored): `TBO_ENV=live`, `TBO_CLIENT_ID=tboprod`, the live `TBO_USERNAME` / `TBO_PASSWORD`,
   the live `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET`, `ALLOW_FAKE_PAYMENTS=false`. Keep the existing relay and Supabase variables. Redeploy.
3. **Keep local on test:** `.env` / `.env.local` stay on `TBO_ENV=staging` with no Razorpay key, so local testing never spends money.
4. **First live booking:** make one real, cheap booking with your own card, check the e-ticket, the CRM row (env = live), and the Razorpay payment.
   Live bookings spend the real TBO wallet and the airline e-mails the passenger's address.
5. **Rotate** the Razorpay key secret and the TBO password if they were ever pasted into chat or e-mail.

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
