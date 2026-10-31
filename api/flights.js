import { search, quote, checkout, ticket, calendar, fareRules } from './_lib/flights.js'
import { TboError, IS_LIVE, flushLogs } from './_lib/tbo.js'

/**
 * Vercel serverless function — the website's only door to the TBO Air API.
 * POST { action: 'search' | 'quote' | 'checkout' | 'ticket', ...payload }
 * TBO credentials and the TokenId stay on the server; the browser only ever
 * holds sealed (encrypted, 15-minute) session tokens.
 */
const ACTIONS = { search, quote, checkout, ticket, calendar, fareRules }

export const config = { maxDuration: 300 } // Book/Ticket can take up to 300 s (TBO guide)

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Lets the page know whether online flight booking is switched on here.
    return res.status(200).json({ enabled: flightsEnabled(), live: IS_LIVE })
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!flightsEnabled()) return res.status(503).json({ error: 'Online flight booking is not switched on yet. Please call or WhatsApp us.' })

  const { action, ...payload } = req.body || {}
  const fn = ACTIONS[action]
  if (!fn) return res.status(400).json({ error: 'Unknown action.' })

  try {
    const data = await fn(payload)
    await flushLogs()
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json(data)
  } catch (e) {
    const status = e instanceof TboError ? e.status || 502 : 500
    await flushLogs()
    if (!(e instanceof TboError)) console.error('[flights]', action, e)
    return res.status(status).json({ error: e instanceof TboError ? e.message : 'Something went wrong. Please try again or call us.', code: e.code ?? null })
  }
}

/** On by default wherever TBO login is set, unless FLIGHTS_ENABLED=false. */
function flightsEnabled() {
  if (String(process.env.FLIGHTS_ENABLED).toLowerCase() === 'false') return false
  return Boolean(process.env.TBO_USERNAME && process.env.TBO_PASSWORD)
}
