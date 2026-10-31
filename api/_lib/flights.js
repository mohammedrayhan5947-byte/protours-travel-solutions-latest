import crypto from 'node:crypto'
import { recordCheckout, recordPaid, recordPaymentFailed, recordOutcome } from './store.js'
import { air, authenticate, seal, unseal, customerPrice, fakePaymentsAllowed, IS_LIVE, TboError } from './tbo.js'
import { AIRPORTS } from './airports.js'

/*
 * The booking flow, one TokenId + TraceId per booking:
 *   search → quote (FareRule, FareQuote, SSR) → checkout (SSR again, payment order)
 *   → ticket (LCC: Ticket | Non-LCC: Book then Ticket) → GetBookingDetails
 * Domestic return comes back as two result lists (OB + IB); each leg is
 * quoted and ticketed separately, giving two PNRs.
 */

export const PAX = { ADULT: 1, CHILD: 2, INFANT: 3 }
const CABIN = { any: 1, economy: 2, premium: 3, business: 4, first: 6 }
const JOURNEY = { oneway: 1, return: 2, multicity: 3, advance: 4, special: 5 }

const isDomesticCode = (code) => AIRPORTS[code]?.country === 'IN'
const iataOk = (c) => /^[A-Z]{3}$/.test(c)
const dateOk = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))

/* ---------------- search ---------------- */

export async function search(input) {
  const journey = JOURNEY[input.journeyType] ? input.journeyType : 'oneway'
  const adults = int(input.adults, 1), children = int(input.children, 0), infants = int(input.infants, 0)
  if (adults < 1 || adults + children + infants > 9) throw bad('Up to 9 travellers in total (including infants), with at least one adult.')
  if (infants > adults) throw bad('Each infant must travel with an adult.')

  let segs = (input.segments || []).map((s) => ({ from: up(s.from), to: up(s.to), date: String(s.date || '') }))
  if (journey === 'return' || journey === 'special') {
    const s = segs[0] || {}
    if (!dateOk(input.returnDate || '')) throw bad('Choose a return date.')
    segs = [s, { from: s.to, to: s.from, date: input.returnDate }]
  }
  if (journey === 'oneway' || journey === 'advance') segs = segs.slice(0, 1)
  if (!segs.length) throw bad('Choose where you are flying.')
  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  segs.forEach((s, i) => {
    if (!iataOk(s.from) || !iataOk(s.to)) throw bad('Pick airports from the list (3-letter codes).')
    if (s.from === s.to) throw bad('Origin and destination must be different.')
    if (!dateOk(s.date)) throw bad('Choose a travel date.')
    if (s.date < todayIso) throw bad('Travel dates cannot be in the past.')
    if (i && s.date < segs[i - 1].date) throw bad('Each flight date must be on or after the one before it.')
  })

  const domestic = segs.every((s) => isDomesticCode(s.from) && isDomesticCode(s.to))
  const cabin = CABIN[input.cabin] || CABIN.economy
  let auth = await authenticate()
  const searchBody = {
    AdultCount: String(adults),
    ChildCount: String(children),
    InfantCount: String(infants),
    DirectFlight: input.directOnly ? 'true' : 'false',
    OneStopFlight: 'false',
    JourneyType: String(JOURNEY[journey]),
    PreferredAirlines: null,
    Segments: segs.map((s) => ({
      Origin: s.from,
      Destination: s.to,
      FlightCabinClass: String(cabin),
      PreferredDepartureTime: `${s.date}T00:00:00`,
      PreferredArrivalTime: `${s.date}T00:00:00`,
    })),
    Sources: Array.isArray(input.sources) && input.sources.length ? input.sources.map(String) : null,
  }
  // TBO: ErrorCode 6 = invalid token (check the code, not the message) → fresh token, retry once.
  const r = await air('Search', { tokenId: auth.tokenId }, searchBody).catch(async (e) => {
    if (e.code !== 6) throw e
    auth = await authenticate({ force: true })
    return air('Search', { tokenId: auth.tokenId }, searchBody)
  })

  const lists = (r.Results || []).map((list) => list.map((x) => ({ ...summarise(x), ...(journey === 'advance' ? { rbd: rbdItem(x) } : {}) })).sort((a, b) => (a.price ?? 1e12) - (b.price ?? 1e12)))
  const session = seal({ tokenId: auth.tokenId, traceId: r.TraceId, journey, domestic, lists: (r.Results || []).length || 1, pax: { adults, children, infants } })
  return {
    session,
    traceId: r.TraceId,
    journey,
    domestic,
    // Domestic return = 2 lists to pick from; everything else = 1.
    lists,
    pax: { adults, children, infants },
    live: IS_LIVE,
  }
}

/** Minimal AirSearchResult entry PriceRBD needs (TBO sample shape). */
function rbdItem(x) {
  return {
    ResultIndex: x.ResultIndex, Source: x.Source, IsLCC: x.IsLCC, IsRefundable: x.IsRefundable, AirlineRemark: x.AirlineRemark ?? null,
    Segments: (x.Segments || []).map((legs) => legs.map((g) => ({ TripIndicator: g.TripIndicator, SegmentIndicator: g.SegmentIndicator, Airline: { ...g.Airline, FareClass: g.Airline.FareClass || pickClass(g.Availability) } }))),
  }
}

/** Advance search leaves FareClass empty; choose a bookable RBD (Y first, else the first with seats). */
function pickClass(av = []) {
  const open = av.filter((a) => Number(a.Seats) > 0)
  return (open.find((a) => a.Class === 'Y') || open[0] || {}).Class || ''
}

/** 'BLR-DEL' (or 'BLR-DEL DEL-BLR' for a result holding both directions), for the CRM. */
const routeOf = (segments) => (segments || []).map((j) => `${j?.[0]?.Origin?.Airport?.AirportCode}-${j?.at(-1)?.Destination?.Airport?.AirportCode}`).join(' ')

/** GetCalendarFare: lowest fare per day for a one-way month view. */
export async function calendar(input) {
  const from = up(input.from), to = up(input.to), date = String(input.date || '')
  if (!iataOk(from) || !iataOk(to) || !dateOk(date)) throw bad('Choose airports and a month.')
  const auth = await authenticate()
  const r = await air('GetCalendarFare', { tokenId: auth.tokenId }, {
    JourneyType: '1',
    PreferredAirlines: null,
    Segments: [{ Origin: from, Destination: to, FlightCabinClass: '1', PreferredDepartureTime: `${date}T00:00:00` }],
    Sources: null,
  })
  return {
    traceId: r.TraceId,
    days: (r.SearchResults || []).map((d) => ({
      date: d.DepartureDate, airline: d.AirlineName, code: d.AirlineCode, lowest: !!d.IsLowestFare,
      price: customerPrice((d.BaseFare || 0) + (d.Tax || 0) + (d.OtherCharges || 0) + (d.FuelSurcharge || 0)),
    })),
  }
}

function summarise(x) {
  const journeys = (x.Segments || []).map((legs) => {
    const first = legs[0], last = legs[legs.length - 1]
    return {
      from: first.Origin.Airport.AirportCode,
      fromCity: first.Origin.Airport.CityName,
      to: last.Destination.Airport.AirportCode,
      toCity: last.Destination.Airport.CityName,
      dep: first.Origin.DepTime,
      arr: last.Destination.ArrTime,
      stops: legs.length - 1,
      minutes: legs.reduce((m, g) => m + (g.Duration || 0) + (g.GroundTime || 0), 0),
      flights: legs.map((g) => ({
        airline: g.Airline.AirlineName,
        code: g.Airline.AirlineCode,
        number: g.Airline.FlightNumber,
        from: g.Origin.Airport.AirportCode,
        fromTerminal: g.Origin.Airport.Terminal,
        to: g.Destination.Airport.AirportCode,
        toTerminal: g.Destination.Airport.Terminal,
        dep: g.Origin.DepTime,
        arr: g.Destination.ArrTime,
        minutes: g.Duration,
        craft: g.Craft,
        baggage: g.Baggage,
        cabinBaggage: g.CabinBaggage,
      })),
    }
  })
  const seg0 = x.Segments?.[0]?.[0]
  return {
    resultIndex: x.ResultIndex,
    isLCC: x.IsLCC,
    airline: seg0?.Airline?.AirlineName,
    airlineCode: x.AirlineCode,
    refundable: x.IsRefundable,
    seats: seg0?.NoOfSeatAvailable ?? null,
    fareType: x.ResultFareType || seg0?.SupplierFareClass || '',
    baggage: seg0?.Baggage || '',
    cabinBaggage: seg0?.CabinBaggage || '',
    // Advance search results are unpriced until PriceRBD.
    price: x.Fare ? customerPrice(x.Fare.PublishedFare) : null,
    currency: x.Fare?.Currency || 'INR',
    journeys,
  }
}

/* ---------------- quote: FareRule + FareQuote + SSR ---------------- */

export async function quote({ session: token, resultIndexes, rbd }) {
  const s = unseal(token)
  const idx = [].concat(resultIndexes || []).filter(Boolean)
  // One pick per result list: 2 for domestic return / LCC special return, else 1.
  const want = s.lists || ((s.journey === 'return' && s.domestic) || s.journey === 'special' ? 2 : 1)
  if (idx.length !== want) throw bad(want === 2 ? 'Choose both an outbound and a return flight.' : 'Choose a flight.')

  // LCC special return: both indexes go into ONE FareQuote, comma separated.
  let legsIdx = s.journey === 'special' ? [idx.join(',')] : idx
  // Advance search: the chosen itinerary is priced by PriceRBD first; its ResultIndex goes on.
  if (s.journey === 'advance') {
    if (!rbd) throw bad('Choose a flight.')
    const pr = await air('PriceRBD', s, {
      AdultCount: String(s.pax.adults), ChildCount: String(s.pax.children), InfantCount: String(s.pax.infants),
      AirSearchResult: [].concat(rbd),
    })
    const priced = pr.Results?.[0]?.[0]
    if (!priced?.ResultIndex) throw new TboError('This fare could not be priced. Please choose another.', { status: 422 })
    legsIdx = [priced.ResultIndex]
  }
  const legs = []
  for (const resultIndex of legsIdx) {
    const rule = await air('FareRule', s, { ResultIndex: resultIndex }, { allowError: true })
    const fq = await air('FareQuote', s, { ResultIndex: resultIndex })
    const R = fq.Results
    // SSR is optional for Non-LCC; a slow supplier must not block the booking.
    const ssr = await air('SSR', s, { ResultIndex: R.ResultIndex }, { allowError: true }).catch(() => null)
    legs.push({
      resultIndex: R.ResultIndex,
      isLCC: R.IsLCC,
      source: R.Source,
      isGSTMandatory: !!R.IsGSTMandatory,
      gstAllowed: !!R.GSTAllowed,
      passportAtBook: !!(R.IsPassportRequiredAtBook || R.IsPassportFullDetailRequiredAtBook),
      passportAtTicket: !!R.IsPassportRequiredAtTicket,
      panRequired: !!(R.IsPanRequiredAtBook || R.IsPanRequiredAtTicket),
      passportFull: !!R.IsPassportFullDetailRequiredAtBook,
      detailChange: fq.FlightDetailChangeInfo || null,
      airlineCode: R.AirlineCode || R.Segments?.[0]?.[0]?.Airline?.AirlineCode || '',
      priceChanged: !!fq.IsPriceChanged,
      // Super 6E / SpiceMax style fares: a (free) meal and seat must be sent in Ticket.
      mealRequired: !!(R.RequiredFieldValidators?.IsMealRequired || R.IsMealMandatory || R.ismealmandatory),
      seatRequired: !!(R.RequiredFieldValidators?.IsSeatRequired || R.IsSeatMandatory || R.isseatmandatory),
      fare: R.Fare,
      breakdown: R.FareBreakdown,
      segments: R.Segments,
      firstNameFormat: R.FirstNameFormat || '',
      lastNameFormat: R.LastNameFormat || '',
      rules: (rule?.FareRules || []).map((f) => ({ airline: f.Airline, origin: f.Origin, destination: f.Destination, fareBasis: f.FareBasisCode, text: f.FareRuleDetail, mini: f.MiniFareRules })),
      ssr: ssrOptions(ssr, R.IsLCC),
    })
  }

  const international = !s.domestic
  const priced = legs.map((l) => ({ ...l, price: customerPrice(l.fare.PublishedFare) }))
  const quoteToken = seal({
    session: { tokenId: s.tokenId, traceId: s.traceId },
    journey: s.journey,
    international,
    pax: s.pax,
    legs: priced.map(({ resultIndex, isLCC, isGSTMandatory, passportAtBook, passportAtTicket, fare, breakdown, price, segments, mealRequired, seatRequired, panRequired, passportFull, airlineCode, source }) => ({
      resultIndex, isLCC, isGSTMandatory, passportAtBook, passportAtTicket, fare, breakdown, price, mealRequired, seatRequired, panRequired, passportFull, airlineCode, source,
      route: routeOf(segments),
      depDate: segments?.[0]?.[0]?.Origin?.DepTime,
      lastDepDate: segments?.at(-1)?.at(-1)?.Origin?.DepTime,
    })),
  })

  return {
    quote: quoteToken,
    traceId: s.traceId,
    international,
    pax: s.pax,
    total: priced.reduce((t, l) => t + l.price, 0),
    legs: priced.map((l) => ({
      isLCC: l.isLCC,
      price: l.price,
      priceChanged: l.priceChanged,
      isGSTMandatory: l.isGSTMandatory,
      mealRequired: l.mealRequired,
      gstAllowed: l.gstAllowed,
      passportRequired: international || l.passportAtBook || l.passportAtTicket,
      panRequired: l.panRequired,
      passportFull: l.passportFull,
      detailChange: l.detailChange,
      firstNameFormat: l.firstNameFormat,
      lastNameFormat: l.lastNameFormat,
      journeys: summarise({ ...l, Segments: l.segments, Fare: l.fare, ResultIndex: l.resultIndex, IsLCC: l.isLCC, AirlineCode: l.segments?.[0]?.[0]?.Airline?.AirlineCode }).journeys,
      paxFares: (l.breakdown || []).map((b) => ({ type: b.PassengerType, count: b.PassengerCount, base: b.BaseFare, tax: b.Tax })),
      rules: l.rules,
      ssr: l.ssr,
    })),
  }
}

/** Trim SSR to what the booking form needs. LCC = priced dynamic lists; Non-LCC = preference strings. */
function ssrOptions(r, isLCC) {
  if (!r || (r.Error?.ErrorCode && r.Error.ErrorCode !== 0)) return { available: false }
  const flat = (groups) => (groups || []).flat()
  if (isLCC) {
    const pack = (x, label) => ({ key: ssrKey(x), code: x.Code, origin: x.Origin, destination: x.Destination, label, price: x.Price, wayType: x.WayType })
    return {
      available: true,
      isLCC: true,
      baggage: flat(r.Baggage).map((x) => pack(x, x.Code === 'NoBaggage' ? 'No extra baggage' : `${x.Weight} kg extra`)),
      meals: flat(r.MealDynamic).map((x) => pack(x, x.Code === 'NoMeal' ? 'No meal' : x.AirlineDescription || x.Code)),
    }
  }
  return {
    available: true,
    isLCC: false,
    meals: (r.Meal || []).map((m) => ({ key: m.Code, code: m.Code, label: m.Description, price: 0 })),
    seats: (r.SeatPreference || []).map((m) => ({ key: m.Code, code: m.Code, label: m.Description, price: 0 })),
  }
}

const ssrKey = (x) => [x.Origin, x.Destination, x.WayType, x.Code, x.FlightNumber].join('|')

/* ---------------- checkout: validate passengers, SSR (last call), payment order ---------------- */

export async function checkout({ quote: token, passengers, contact, gst, choices }) {
  const q = unseal(token, 'fare quote')
  const paxList = validatePassengers(passengers, q, contact)
  if (q.legs.some((l) => l.isGSTMandatory) && !gst?.number) throw bad('This fare needs your company GST details.')
  if (gst?.number) validateGst(gst)

  const payloads = []
  let ssrTotal = 0
  for (const [li, leg] of q.legs.entries()) {
    // TBO: the most recent call before ticketing must be SSR, or selections are ignored.
    // Non-LCC SSR is optional: only call it when the traveller picked a meal/seat.
    const legChoice0 = (choices && choices[li]) || []
    const wantsSsr = leg.isLCC || legChoice0.some((c) => c && (c.meal || c.seat))
    const ssr = wantsSsr ? await air('SSR', q.session, { ResultIndex: leg.resultIndex }, { allowError: true }).catch((e) => { if (leg.isLCC) throw e; return null }) : null
    const opts = ssr ? ssrOptions(ssr, leg.isLCC) : { available: false }
    const legChoice = (choices && choices[li]) || []
    const usedSeats = new Set()
    const passengersReq = paxList.map((p, pi) => {
      const extra = buildSsr(ssr, opts, leg.isLCC, p.paxType, legChoice[pi] || {}, leg, usedSeats)
      ssrTotal += extra.cost
      return toTboPassenger(p, leg, pi === 0, gst, paxList.contact, extra.fields)
    })
    payloads.push({ isLCC: leg.isLCC, resultIndex: leg.resultIndex, passengers: passengersReq, quotedFare: Number(leg.fare.PublishedFare) || 0 })
  }

  const fareTotal = q.legs.reduce((t, l) => t + l.price, 0)
  const amount = fareTotal + Math.ceil(ssrTotal)
  const orderRef = 'PT' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase()

  let payment
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    payment = { mode: 'razorpay', ...(await razorpayOrder(amount, orderRef, contact)) }
  } else if (fakePaymentsAllowed()) {
    payment = { mode: 'test', orderId: 'test_' + orderRef }
  } else {
    throw new TboError('Online payment is not switched on yet. Please call or WhatsApp us to book this fare.', { status: 503 })
  }

  const checkoutToken = seal({ session: q.session, payloads, amount, orderId: payment.orderId, orderRef, contact: paxList.contact }, 15 * 60 * 1000)
  await recordCheckout({
    orderRef, traceId: q.session.traceId, amount, orderId: payment.orderId, contact: paxList.contact, pax: paxList, journey: q.journey,
    route: q.legs.map((l) => l.route).filter(Boolean).join(' | '),
    travelDate: q.legs.map((l) => l.depDate).filter(Boolean).sort()[0],
    returnDate: q.legs.length > 1 ? q.legs.at(-1).depDate : q.legs[0]?.lastDepDate !== q.legs[0]?.depDate ? q.legs[0]?.lastDepDate : null,
  })
  return { checkout: checkoutToken, amount, fareTotal, ssrTotal: Math.ceil(ssrTotal), orderRef, payment }
}

function buildSsr(raw, opts, isLCC, paxType, pick, leg = {}, usedSeats = new Set()) {
  const fields = {}
  let cost = 0
  if (!opts.available) return { fields, cost }
  if (isLCC) {
    const all = (g) => (g || []).flat()
    // One item per sector. Choose the customer's pick, else the free "no" item.
    // Included (Price 0) items must be sent to be availed: intl LCC baggage, I5 baggage+meal (TBO checklist).
    const perSector = (groups, picks, freeCode, required, preferIncluded) => {
      const bySector = new Map()
      for (const x of all(groups)) {
        const k = [x.Origin, x.Destination, x.WayType].join('|')
        if (!bySector.has(k)) bySector.set(k, [])
        bySector.get(k).push(x)
      }
      const out = []
      for (const [, items] of bySector) {
        const real = items.filter((x) => x.Code !== freeCode)
        const chosen = items.find((x) => picks.includes(ssrKey(x))) ||
          (required
            ? real.find((x) => !x.Price) || [...real].sort((a, b) => a.Price - b.Price)[0]
            : (preferIncluded && real.find((x) => !x.Price)) || items.find((x) => x.Code === freeCode) || items.find((x) => !x.Price))
        if (chosen) {
          out.push(chosen)
          cost += Number(chosen.Price) || 0
        }
      }
      return out
    }
    // Infants: no baggage, no seat (TBO rule). Arrays are never sent as null.
    if (paxType !== PAX.INFANT && raw.Baggage?.length) fields.Baggage = perSector(raw.Baggage, pick.baggage || [], 'NoBaggage', false, true)
    if (raw.MealDynamic?.length) fields.MealDynamic = perSector(raw.MealDynamic, pick.meals || [], 'NoMeal', leg.mealRequired, String(leg.airlineCode) === 'I5')
    // Seat-mandatory fares: one free, open seat per segment for each non-infant.
    if (leg.seatRequired && paxType !== PAX.INFANT && raw.SeatDynamic?.length) {
      const seats = []
      for (const seg of raw.SeatDynamic.flatMap((g) => g.SegmentSeat || [])) {
        const all = (seg.RowSeats || []).flatMap((r) => r.Seats || []).filter((x) => x.Code && x.Code !== 'NoSeat')
        const k = (x) => [x.Origin, x.Destination, x.FlightNumber, x.Code].join('|')
        const seat = all.find((x) => x.AvailablityType === 1 && !x.Price && !usedSeats.has(k(x))) ||
          all.filter((x) => x.AvailablityType === 1 && !usedSeats.has(k(x))).sort((a, b) => a.Price - b.Price)[0]
        if (seat) {
          usedSeats.add(k(seat))
          seats.push(seat)
          cost += Number(seat.Price) || 0
        }
      }
      if (seats.length) fields.SeatDynamic = seats
    }
  } else {
    // Non-LCC meal/seat are free preferences, passed as objects with Code/Description.
    const meal = (raw.Meal || []).find((m) => m.Code === pick.meal)
    const seat = (raw.SeatPreference || []).find((m) => m.Code === pick.seat)
    if (meal) fields.Meal = meal
    if (seat && paxType !== PAX.INFANT) fields.Seat = seat
  }
  return { fields, cost }
}

/* ---------------- passengers ---------------- */

const NAME = /^[A-Za-z]+(?: [A-Za-z]+)*$/
const TITLES = { [PAX.ADULT]: ['Mr', 'Mrs', 'Ms'], [PAX.CHILD]: ['Mstr', 'Miss'], [PAX.INFANT]: ['Mstr', 'Miss'] }

function ageOn(dob, on) {
  const b = new Date(dob), d = new Date(on)
  let a = d.getFullYear() - b.getFullYear()
  if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) a--
  return a
}

export function validatePassengers(list, q, contact) {
  if (!Array.isArray(list)) throw bad('Passenger details are missing.')
  const need = { [PAX.ADULT]: q.pax.adults, [PAX.CHILD]: q.pax.children, [PAX.INFANT]: q.pax.infants }
  const have = { 1: 0, 2: 0, 3: 0 }
  const lastDep = q.legs.map((l) => l.lastDepDate).filter(Boolean).sort().at(-1) || new Date().toISOString()
  const firstDep = q.legs.map((l) => l.depDate).filter(Boolean).sort()[0] || new Date().toISOString()
  const names = new Set()

  if (!/^[6-9]\d{9}$/.test(String(contact?.phone || '').replace(/\D/g, '').slice(-10))) throw bad('Enter a valid 10-digit mobile number.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact?.email || '')) throw bad('Enter a valid email address.')

  const out = list.map((p, i) => {
    const n = `Passenger ${i + 1}`
    const paxType = Number(p.paxType)
    if (!need[paxType] && need[paxType] !== 0) throw bad(`${n}: unknown passenger type.`)
    have[paxType]++
    const first = clean(p.firstName), last = clean(p.lastName)
    if (!TITLES[paxType].includes(p.title)) throw bad(`${n}: choose a title.`)
    if (!NAME.test(first) || first.length < 1) throw bad(`${n}: first name may contain letters and single spaces only.`)
    if (!NAME.test(last) || last.length < 2) throw bad(`${n}: last name must be at least 2 letters (letters and spaces only).`)
    if (first.length > 32 || last.length > 32) throw bad(`${n}: first and last name can be at most 32 letters each.`)
    if (first.toLowerCase() === last.toLowerCase() && first.length < 2) throw bad(`${n}: first and last name look wrong.`)
    const key = `${first}|${last}`.toLowerCase()
    if (names.has(key)) throw bad(`${n}: two passengers have the same name.`)
    names.add(key)

    const dob = String(p.dob || '')
    const needDob = paxType !== PAX.ADULT || q.international
    if (needDob || dob) {
      if (!dateOk(dob)) throw bad(`${n}: date of birth is required.`)
      const age = ageOn(dob, lastDep), ageStart = ageOn(dob, firstDep)
      if (paxType === PAX.ADULT && ageStart < 12) throw bad(`${n}: adults must be 12 or older on the travel date.`)
      if (paxType === PAX.CHILD && (ageStart < 2 || age >= 12)) throw bad(`${n}: children must be 2–11 years old for the whole trip.`)
      if (paxType === PAX.INFANT && (age >= 2 || new Date(dob) > new Date())) throw bad(`${n}: infants must be under 2 for the whole trip.`)
    }
    const gender = ['Mr', 'Mstr'].includes(p.title) ? 1 : 2

    // PAN: adults their own; child/infant pass parent/guardian PAN + name (TBO PAN validation).
    const panNeeded = q.legs.some((l) => l.panRequired)
    const PANRE = /^[A-Z]{5}[0-9]{4}[A-Z]$/
    let pan = String(p.pan || '').toUpperCase().trim()
    let guardian = null
    if (pan && !PANRE.test(pan)) throw bad(`${n}: PAN format is not valid.`)
    if (panNeeded && paxType === PAX.ADULT && !pan) throw bad(`${n}: PAN is required for this fare.`)
    if (panNeeded && paxType !== PAX.ADULT && !pan) {
      const g = p.guardian || {}
      const gp = String(g.pan || '').toUpperCase().trim()
      if (!PANRE.test(gp) || !NAME.test(clean(g.firstName)) || !NAME.test(clean(g.lastName))) throw bad(`${n}: enter the parent/guardian name and PAN exactly as on the PAN card.`)
      guardian = { Title: ['Mr', 'Mrs', 'Ms'].includes(g.title) ? g.title : 'Mr', FirstName: clean(g.firstName), LastName: clean(g.lastName), PAN: gp }
    }
    // TruJet / Zoom Air: no space allowed in last name.
    if (q.legs.some((l) => ['2T', 'ZO'].includes(l.airlineCode)) && last.includes(' ')) throw bad(`${n}: this airline does not allow spaces in the last name.`)
    const passportNeeded = q.international || q.legs.some((l) => l.passportAtBook || l.passportAtTicket)
    const passportFull = q.legs.some((l) => l.passportFull)
    let passport = null
    if (passportNeeded) {
      const no = String(p.passportNo || '').toUpperCase().replace(/\s/g, '')
      if (!/^[A-Z0-9]{6,15}$/.test(no)) throw bad(`${n}: enter the passport number.`)
      if (!dateOk(p.passportExpiry || '')) throw bad(`${n}: enter the passport expiry date.`)
      if (new Date(p.passportExpiry) <= new Date(lastDep)) throw bad(`${n}: passport expires before travel.`)
      if (p.passportIssue && (!dateOk(p.passportIssue) || p.passportIssue < dob || new Date(p.passportIssue) > new Date())) throw bad(`${n}: passport issue date must be after the date of birth and not in the future.`)
      if (passportFull && (!dateOk(p.passportIssue || '') || !/^[A-Za-z]{2}$/.test(p.passportCountry || ''))) throw bad(`${n}: this fare needs the passport issue date and issuing country.`)
      passport = { no, expiry: p.passportExpiry, issueCountry: up(p.passportCountry || 'IN').slice(0, 2), issueDate: p.passportIssue || '' }
    }
    return { paxType, title: p.title, first, last, gender, dob, passport, pan, guardian, nationality: up(p.nationality || 'IN').slice(0, 2) }
  })
  for (const t of [1, 2, 3]) if (have[t] !== need[t]) throw bad('Passenger count does not match your search.')
  out.contact = { phone: String(contact.phone).replace(/\D/g, '').slice(-10), email: contact.email.trim(), address: clean(contact.address || '') || 'Bengaluru', city: clean(contact.city || '') || 'Bengaluru' }
  return out
}

function validateGst(g) {
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(String(g.number).toUpperCase())) throw bad('GST number format is not valid.')
  if (!clean(g.company)) throw bad('Enter the company name on the GST certificate.')
}

function toTboPassenger(p, leg, isLead, gst, contact, ssrFields) {
  // Fare per passenger = that pax type's FareBreakdown ÷ PassengerCount (TBO rule).
  const fb = (leg.breakdown || []).find((b) => b.PassengerType === p.paxType) || leg.breakdown[0]
  const n = fb.PassengerCount || 1
  const per = (k) => round2((Number(fb[k]) || 0) / n)
  const F = leg.fare
  // Navitaire 4X (SpiceJet) titles: child MR/MS, infant MSTR/MR/MS.
  const sgTitle = leg.airlineCode === 'SG' && p.paxType === PAX.CHILD ? (p.title === 'Mstr' ? 'Mr' : 'Ms') : p.title
  const pax = {
    Title: sgTitle,
    ...(p.pan ? { PAN: p.pan } : {}),
    ...(p.guardian ? { GuardianDetails: p.guardian } : {}),
    FirstName: p.first,
    LastName: p.last,
    PaxType: p.paxType,
    DateOfBirth: p.dob ? `${p.dob}T00:00:00` : '',
    Gender: p.gender,
    PassportNo: p.passport?.no || '',
    PassportExpiry: p.passport ? `${p.passport.expiry}T00:00:00` : '',
    ...(p.passport?.issueDate ? { PassportIssueDate: `${p.passport.issueDate}T00:00:00` } : {}),
    ...(p.passport ? { PassportIssueCountryCode: p.passport.issueCountry } : {}),
    AddressLine1: contact.address.slice(0, 60),
    AddressLine2: '',
    City: contact.city.slice(0, 40),
    CountryCode: 'IN',
    CountryName: 'India',
    Nationality: p.nationality,
    ContactNo: contact.phone,
    Email: contact.email,
    IsLeadPax: isLead,
    FFAirlineCode: null,
    FFNumber: '',
    Fare: {
      Currency: F.Currency,
      BaseFare: per('BaseFare'),
      Tax: per('Tax'),
      YQTax: per('YQTax'),
      // TBO Book/Ticket spec lists these as mandatory per passenger.
      TransactionFee: per('TransactionFee'),
      AirTransFee: per('AirTransFee'),
      AdditionalTxnFeePub: per('AdditionalTxnFeePub'),
      AdditionalTxnFeeOfrd: per('AdditionalTxnFeeOfrd'),
      OtherCharges: round2((F.OtherCharges || 0) / paxTotal(leg)),
      Discount: round2((F.Discount || 0) / paxTotal(leg)),
      PublishedFare: round2(F.PublishedFare / paxTotal(leg)),
      OfferedFare: round2(F.OfferedFare / paxTotal(leg)),
      TdsOnCommission: round2((F.TdsOnCommission || 0) / paxTotal(leg)),
      TdsOnPLB: round2((F.TdsOnPLB || 0) / paxTotal(leg)),
      TdsOnIncentive: round2((F.TdsOnIncentive || 0) / paxTotal(leg)),
      ServiceFee: round2((F.ServiceFee || 0) / paxTotal(leg)),
    },
    ...ssrFields,
  }
  if (isLead && gst?.number) {
    Object.assign(pax, {
      GSTCompanyAddress: clean(gst.address || 'Bengaluru'),
      GSTCompanyContactNumber: String(gst.phone || '').replace(/\D/g, ''),
      GSTCompanyName: clean(gst.company),
      GSTNumber: String(gst.number).toUpperCase(),
      GSTCompanyEmail: String(gst.email || '').trim(),
    })
  }
  return pax
}

const paxTotal = (leg) => (leg.breakdown || []).reduce((t, b) => t + (b.PassengerCount || 0), 0) || 1

/* ---------------- ticket ---------------- */

export async function ticket({ checkout: token, payment }) {
  const c = unseal(token, 'checkout')
  try {
    await confirmPayment(c, payment)
  } catch (e) {
    await recordPaymentFailed(c.orderRef, e.message)
    throw e
  }
  await recordPaid(c.orderRef, payment?.paymentId || c.orderId)

  const results = []
  for (const leg of c.payloads) {
    const passengers = leg.passengers
    let bookingId, pnr, status, error
    try {
      if (leg.isLCC) {
        // SSR must be the last call before each leg's Ticket (matters for the 2nd PNR of a domestic return).
        await air('SSR', c.session, { ResultIndex: leg.resultIndex }, { allowError: true }).catch(() => null)
        const lccReq = { ResultIndex: leg.resultIndex, Passengers: passengers, PreferredCurrency: null, IsBaseCurrencyRequired: false }
        let t = await air('Ticket', c.session, lccReq)
        let b = t.Response
        // Price changed at ticketing: TBO says call Ticket again with IsPriceChangeAccepted.
        // The customer paid a fixed amount, so accept only if the new fare is not higher.
        if (t.IsPriceChanged || b?.IsPriceChanged || b?.TicketStatus === 8) {
          if (!fareNotHigher(b, leg)) throw new TboError('The airline raised the fare at ticketing. Nothing was ticketed; our team will call you to refund or rebook.', { status: 409 })
          t = await air('Ticket', c.session, { ...lccReq, IsPriceChangeAccepted: true })
          b = t.Response
        }
        bookingId = b?.BookingId
        pnr = b?.PNR
        status = b?.TicketStatus
      } else {
        const bk = await air('Book', c.session, { ResultIndex: leg.resultIndex, Passengers: passengers })
        const priceChanged = !!bk.Response?.IsPriceChanged
        if (bk.Response?.IsTimeChanged) {
          throw new TboError('The airline changed the flight timing at booking. Nothing was ticketed; please search again or call us.', { status: 409 })
        }
        if (priceChanged && !fareNotHigher(bk.Response, leg)) {
          throw new TboError('The airline raised the fare at booking. Nothing was ticketed; please search again or call us.', { status: 409 })
        }
        bookingId = bk.Response?.BookingId
        pnr = bk.Response?.PNR
        // Book reported a price change we can absorb → Ticket with IsPriceChangeAccepted (TBO rule).
        let t = await air('Ticket', c.session, { PNR: pnr, BookingId: bookingId, ...(priceChanged ? { IsPriceChangeAccepted: true } : {}) })
        if (t.Response?.IsPriceChanged && fareNotHigher(t.Response, leg)) {
          t = await air('Ticket', c.session, { PNR: pnr, BookingId: bookingId, IsPriceChangeAccepted: true })
        }
        status = t.Response?.TicketStatus
      }
    } catch (e) {
      error = e.message
    }
    // Always call GetBookingDetails (certification requirement). Without a
    // BookingId (timeout / error) look it up by TraceId and poll, never re-book.
    let details = null
    // TBO: on timeout poll GetBookingDetails every 10–15 s ("booking under process") instead of re-booking.
    for (let attempt = 0; attempt < (bookingId ? 1 : 10); attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 12000))
      try {
        const d = await air('GetBookingDetails', c.session, bookingId ? { BookingId: bookingId, PNR: pnr } : {}, { allowError: true })
        details = bookingSummary(d)
        if (details?.bookingId) {
          bookingId ||= details.bookingId
          pnr ||= details.pnr
          break
        }
      } catch {
        /* keep polling; staff can look it up by TraceId */
      }
    }
    results.push({ bookingId, pnr, ticketStatus: status, error, details })
  }
  const out = { orderRef: c.orderRef, amount: c.amount, results }
  await recordOutcome({ ...out, paymentId: payment?.paymentId || c.orderId })
  return out
}

/** New published fare from a Book/Ticket response is not above what the customer was quoted. */
function fareNotHigher(r, leg) {
  const now = Number(r?.FlightItinerary?.Fare?.PublishedFare)
  return Number.isFinite(now) && now > 0 && now <= leg.quotedFare + 0.5
}

function bookingSummary(d) {
  const it = d?.FlightItinerary
  if (!it) return null
  return {
    pnr: it.PNR,
    bookingId: it.BookingId,
    status: it.Status,
    airline: it.AirlineCode,
    passengers: (it.Passenger || []).map((p) => ({ name: `${p.Title} ${p.FirstName} ${p.LastName}`, ticket: p.Ticket?.TicketNumber || '' })),
    segments: (it.Segments || []).map((g) => ({ flight: `${g.Airline.AirlineCode} ${g.Airline.FlightNumber}`, from: g.Origin.Airport.AirportCode, to: g.Destination.Airport.AirportCode, dep: g.Origin.DepTime })),
  }
}

/* ---------------- payment ---------------- */

async function razorpayOrder(amount, receipt, contact) {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')
  const r = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify({ amount: Math.round(amount * 100), currency: 'INR', receipt, notes: { purpose: 'flight', phone: contact?.phone || '' } }),
  })
  const data = await r.json()
  if (!r.ok) throw new TboError(data?.error?.description || 'Could not start payment.', { status: 502 })
  return { orderId: data.id, keyId: process.env.RAZORPAY_KEY_ID, amountPaise: data.amount }
}

async function confirmPayment(c, p) {
  if (String(c.orderId).startsWith('test_')) {
    if (!fakePaymentsAllowed()) throw new TboError('Test payments are not allowed.', { status: 402 })
    return
  }
  const secret = process.env.RAZORPAY_KEY_SECRET
  if (!secret || !p?.paymentId || !p?.signature || p.orderId !== c.orderId) throw new TboError('Payment could not be verified.', { status: 402 })
  const expected = crypto.createHmac('sha256', secret).update(`${c.orderId}|${p.paymentId}`).digest('hex')
  if (expected.length !== p.signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(p.signature))) {
    throw new TboError('Payment signature mismatch.', { status: 402 })
  }
  // Payment must be captured for the full amount before we spend the TBO wallet.
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${secret}`).toString('base64')
  const r = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(p.paymentId)}`, { headers: { Authorization: `Basic ${auth}` } })
  const pay = await r.json()
  if (!r.ok || pay.order_id !== c.orderId || pay.amount !== Math.round(c.amount * 100) || !['captured', 'authorized'].includes(pay.status)) {
    throw new TboError('Payment is not complete for this booking.', { status: 402 })
  }
}

/* ---------------- helpers ---------------- */

function int(v, d) {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) && n >= 0 ? n : d
}
const up = (s) => String(s || '').trim().toUpperCase()
const clean = (s) => String(s || '').trim().replace(/\s+/g, ' ')
const round2 = (n) => Math.round(n * 100) / 100
const bad = (msg) => new TboError(msg, { status: 400 })
