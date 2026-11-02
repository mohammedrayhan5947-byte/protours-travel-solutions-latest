/* Switches THIS computer between the test and the live settings, in one command.

     npm run env:status     which one is active (nothing secret is printed)
     npm run env:test       back to TBO's test system, simulated or Razorpay test payments
     npm run env:live -- --yes   TBO live + live Razorpay: bookings made here are REAL and charge real cards

   It only rewrites .env.local (git-ignored). Your test settings are kept in .env.local.test and the live ones are built from
   .env.local.test plus .env.vercel-live (the live TBO login and Razorpay keys), also git-ignored, so nothing is typed twice.
   Live uses the gateway's separate /tbo-live route; the website's own gateway route (/tbo) stays on TBO's test system. */
import fs from 'node:fs'
import path from 'node:path'

const dir = process.env.ENV_DIR || process.cwd()
const file = (n) => path.join(dir, n)
const mode = process.argv[2]
const yes = process.argv.includes('--yes')

const read = (n) => (fs.existsSync(file(n)) ? fs.readFileSync(file(n), 'utf8') : null)
const parse = (text) => Object.fromEntries((text || '').split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]))

/** Values with # or $ must be quoted, or the .env reader cuts them short. */
const q = (v) => (/[#$\s]/.test(v) ? `'${v}'` : v)

/** Same file, same order and comments, with the given keys replaced (or added at the end). */
function withValues(text, values) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const seen = new Set()
  const out = lines.map((l) => {
    const m = /^([A-Z0-9_]+)=/.exec(l)
    if (m && m[1] in values) { seen.add(m[1]); return `${m[1]}=${q(values[m[1]])}` }
    return l
  })
  while (out.length && out.at(-1).trim() === '') out.pop()
  for (const [k, v] of Object.entries(values)) if (!seen.has(k)) out.push(`${k}=${q(v)}`)
  return out.join(nl) + nl
}

function status() {
  const e = parse(read('.env.local'))
  const live = String(e.TBO_ENV).toLowerCase() === 'live'
  console.log(`Active settings (.env.local): ${live ? 'LIVE: real tickets, real card payments' : 'TEST: TBO test system, no real money'}`)
  console.log(`  TBO_ENV=${e.TBO_ENV || '(not set)'}  gateway=${e.TBO_RELAY_URL || '(direct)'}`)
  console.log(`  Razorpay key: ${e.RAZORPAY_KEY_ID ? e.RAZORPAY_KEY_ID.replace(/^(rzp_(live|test)_).*/, '$1…') : '(none: payment is simulated)'}`)
}

if (mode === 'status') status()
else if (mode === 'test') {
  const t = read('.env.local.test')
  if (!t) { console.log('Nothing to switch back to: .env.local.test does not exist, so .env.local is already the test file.'); process.exit(0) }
  fs.writeFileSync(file('.env.local'), t)
  console.log('Switched to TEST settings.'); status()
} else if (mode === 'live') {
  if (!yes) {
    console.log('This switches this computer to LIVE: TBO production and live Razorpay.\nEvery booking you complete here buys a real ticket and charges a real card.\nRun it again with --yes to continue:  npm run env:live -- --yes')
    process.exit(1)
  }
  const current = read('.env.local')
  if (!current) { console.error('.env.local not found.'); process.exit(1) }
  if (!fs.existsSync(file('.env.local.test')) && String(parse(current).TBO_ENV).toLowerCase() !== 'live') fs.writeFileSync(file('.env.local.test'), current) // keep the test file safe first
  const base = read('.env.local.test') || current
  const lv = parse(read('.env.vercel-live'))
  for (const k of ['TBO_USERNAME', 'TBO_PASSWORD', 'TBO_CLIENT_ID', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET']) if (!lv[k]) { console.error(`.env.vercel-live has no ${k}.`); process.exit(1) }
  const b = parse(base)
  const toLive = (u) => (u ? u.replace(/\/tbo(?=\/|$)/, '/tbo-live') : u)
  const values = {
    TBO_ENV: 'live', TBO_CLIENT_ID: lv.TBO_CLIENT_ID, TBO_USERNAME: lv.TBO_USERNAME, TBO_PASSWORD: lv.TBO_PASSWORD,
    RAZORPAY_KEY_ID: lv.RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET: lv.RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: lv.RAZORPAY_WEBHOOK_SECRET || b.RAZORPAY_WEBHOOK_SECRET || '',
    ALLOW_FAKE_PAYMENTS: 'false',
  }
  for (const k of ['TBO_RELAY_URL', 'TBO_SHARED_URL', 'TBO_AIR_URL', 'TBO_AIR_BOOK_URL']) if (b[k]) values[k] = toLive(b[k])
  if (!values.TBO_RELAY_URL) { console.error('No TBO_RELAY_URL in your settings: live calls must go through the gateway (the whitelisted IP).'); process.exit(1) }
  fs.writeFileSync(file('.env.local'), withValues(base, values))
  console.log('Switched to LIVE settings. Real tickets, real card payments.\nTo go back:  npm run env:test'); status()
} else {
  console.log('Usage: node scripts/use-env.mjs status | test | live --yes')
  process.exit(1)
}
