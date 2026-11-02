import { rpc, dbConfigured } from './db.js'

/**
 * The price markup: what we add on top of the airline's fare, set by staff in the CRM (Settings), separately for domestic
 * and international flights.
 *
 *   customer pays = airline fare + airline fare x percent / 100 + flat rupees x (adults + children)
 *
 * The flat amount is per adult and per child, for each ticket (a domestic return is two tickets). Infants only carry the
 * percentage: a flat amount on a small infant fare would be out of proportion. The result is always rounded UP to a whole rupee.
 *
 * Stored in the database (site_content, key "markup"). Each server instance keeps what it read for a minute, so a change is
 * live everywhere within about a minute; a booking that is already in checkout keeps the price it was quoted. If the database
 * cannot be reached the last known setting is used, and failing that FLIGHT_MARKUP_PERCENT (the old environment setting).
 */
export const LIMITS = { percent: { min: 0, max: 50 }, flat: { min: 0, max: 5000 } }
const KEY = 'markup'
const TTL = 60_000

const envDefault = () => {
  const percent = Math.min(LIMITS.percent.max, Math.max(0, Number(process.env.FLIGHT_MARKUP_PERCENT) || 0))
  return { domestic: { percent, flat: 0 }, international: { percent, flat: 0 }, source: 'environment' }
}

const num = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN)
const round2 = (n) => Math.round(n * 100) / 100

/** One side ({percent, flat}) checked against the limits; throws a sentence staff can read. */
function side(input, label) {
  const percent = num(input?.percent), flat = num(input?.flat)
  if (!Number.isFinite(percent) || percent < LIMITS.percent.min || percent > LIMITS.percent.max) throw Object.assign(new Error(`${label}: the percentage must be between ${LIMITS.percent.min} and ${LIMITS.percent.max}.`), { status: 400 })
  if (!Number.isFinite(flat) || flat < LIMITS.flat.min || flat > LIMITS.flat.max) throw Object.assign(new Error(`${label}: the flat amount must be between ₹${LIMITS.flat.min} and ₹${LIMITS.flat.max} per traveller.`), { status: 400 })
  return { percent: round2(percent), flat: round2(flat) }
}

export const validate = (input) => ({ domestic: side(input?.domestic, 'Domestic'), international: side(input?.international, 'International') })

let cache = { at: 0, value: null }

/** The current markup ({ domestic, international, source, updatedAt, updatedBy, history }). Never throws. */
export async function getMarkup({ fresh = false } = {}) {
  if (!fresh && cache.value && Date.now() - cache.at < TTL) return cache.value
  if (!dbConfigured()) return (cache = { at: Date.now(), value: envDefault() }).value
  try {
    const row = await rpc('crm_get_setting', { p_key: KEY })
    let value
    if (row?.value) {
      const v = validate(row.value)
      value = { ...v, source: 'crm', updatedAt: row.updated_at, updatedBy: row.value.updatedBy || null, history: Array.isArray(row.value.history) ? row.value.history.slice(0, 10) : [] }
    } else value = envDefault()
    cache = { at: Date.now(), value }
    return value
  } catch (e) {
    console.error('[markup] could not read the setting, using the last known one:', e.message)
    return cache.value || envDefault()
  }
}

/** Saves a new markup (already staff-checked), keeps the last 10 changes, and makes this instance use it straight away. */
export async function saveMarkup(input, actor) {
  const v = validate(input)
  const before = await getMarkup({ fresh: true })
  const history = [{ at: new Date().toISOString(), by: actor, domestic: v.domestic, international: v.international }, ...(before.history || [])].slice(0, 10)
  await rpc('crm_set_setting', { p_key: KEY, p_value: { ...v, updatedBy: actor, history } })
  cache = { at: 0, value: null } // next read comes from the database, so what staff see is what was saved
  return getMarkup({ fresh: true })
}

/**
 * The customer's price for an airline fare. `pax` = { adults, children, infants } (what the fare covers).
 * Rounded up to a whole rupee; the percentage applies to the whole fare, the flat amount to adults and children.
 */
export function priceWith(published, rule, pax = { adults: 1 }) {
  const fare = Number(published)
  if (!Number.isFinite(fare) || fare < 0) return null
  const payers = Math.max(0, (Number(pax.adults) || 0) + (Number(pax.children) || 0))
  return Math.ceil(fare * (1 + rule.percent / 100) + rule.flat * payers - 1e-9)
}

export const ruleFor = (m, domestic) => (domestic ? m.domestic : m.international)
