/* The downloadable e-ticket: an A4 PDF, one page per ticket, with the agency's logo and address on top.
   Built in the browser with jsPDF (loaded only when the customer taps Download), so nothing is stored or sent anywhere. */

export const TICKET_AGENCY = {
  name: 'PRO TOURS AND TRAVEL SOLUTIONS',
  lines: ['# 21/1 G-2 Plain Street, A.M. Plaza, Hospital Road,', 'Bangalore - 560 001.', 'Mob: +91-9900517604', 'Email: luckysaj@gmail.com', 'Website: www.protoursandtravelsolutions.com'],
}
const LOGO_RATIO = 209 / 1200 // public/logo.png is 1200 x 209

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const part = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || '')); return m ? { y: +m[1], mo: +m[2], d: +m[3], h: m[4], mi: m[5] } : null }
const dayText = (s) => { const p = part(s); return p ? `${DAYS[new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay()]}, ${p.d} ${MONTHS[p.mo - 1]} ${p.y}` : '' }
const timeText = (s) => { const p = part(s); return p ? `${p.h}:${p.mi}` : '' }
// Standard PDF fonts have no rupee sign or accented letters; keep everything plain.
const plain = (v) => String(v ?? '').replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim()

const NAVY = [8, 28, 52], GREY = [90, 100, 112], LINE = [210, 214, 220], BLUE = [15, 94, 158]

/** doc: a jsPDF instance. tickets: done.results that were issued. logo: PNG data URL (or null). */
export function drawTickets(doc, { orderRef, amount, tickets, logo, issuedOn = new Date() }) {
  const W = 210, M = 14
  tickets.forEach((r, ti) => {
    if (ti) doc.addPage()
    let y = 12

    // letterhead: logo left, address right
    if (logo) doc.addImage(logo, 'PNG', M, y, 66, 66 * LOGO_RATIO)
    doc.setTextColor(...NAVY).setFont('helvetica', 'bold').setFontSize(8.5)
    doc.text(TICKET_AGENCY.name, W - M, y + 2, { align: 'right' })
    doc.setFont('helvetica', 'normal').setFontSize(7.8).setTextColor(...GREY)
    TICKET_AGENCY.lines.forEach((l, i) => doc.text(l, W - M, y + 6.5 + i * 3.7, { align: 'right' }))
    y = 36
    doc.setDrawColor(...BLUE).setLineWidth(0.6).line(M, y, W - M, y)

    // title row
    y += 9
    doc.setTextColor(...NAVY).setFont('helvetica', 'bold').setFontSize(15).text('E-TICKET / ITINERARY', M, y)
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...GREY)
    doc.text(`Booking reference: ${plain(orderRef)}`, W - M, y - 4, { align: 'right' })
    doc.text(`Issued: ${dayText(issuedOn.toISOString().slice(0, 19))}${tickets.length > 1 ? `   |   Ticket ${ti + 1} of ${tickets.length}` : ''}`, W - M, y + 1, { align: 'right' })

    // PNR panel
    y += 8
    doc.setFillColor(238, 243, 249).roundedRect(M, y, W - 2 * M, 17, 2, 2, 'F')
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GREY).text('AIRLINE PNR', M + 5, y + 6)
    doc.setFont('courier', 'bold').setFontSize(20).setTextColor(...NAVY).text(plain(r.pnr) || 'PENDING', M + 5, y + 14)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GREY).text('BOOKING ID', 80, y + 6)
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...NAVY).text(plain(r.bookingId) || '-', 80, y + 13)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GREY).text('AMOUNT PAID (ALL TICKETS)', W - M - 5, y + 6, { align: 'right' })
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...NAVY).text(`INR ${Math.round(Number(amount) || 0).toLocaleString('en-IN')}`, W - M - 5, y + 13, { align: 'right' })

    // flights
    y += 25
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...BLUE).text('FLIGHT DETAILS', M, y)
    y += 3
    ;(r.details?.segments || []).forEach((s) => {
      y += 3
      doc.setDrawColor(...LINE).setLineWidth(0.3).roundedRect(M, y, W - 2 * M, 26, 2, 2)
      doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...NAVY).text(plain(s.airline) ? `${plain(s.airline)}  ${plain(s.flight)}` : plain(s.flight), M + 5, y + 6)
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GREY).text(dayText(s.dep), W - M - 5, y + 6, { align: 'right' })
      doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(...NAVY)
      doc.text(plain(s.from), M + 5, y + 17)
      doc.text(plain(s.to), 118, y + 17)
      doc.setFontSize(12).text(timeText(s.dep), M + 30, y + 17)
      if (s.arr) doc.text(timeText(s.arr), 118 + 25, y + 17)
      doc.setDrawColor(...BLUE).setLineWidth(0.5).line(M + 52, y + 15, 108, y + 15)
      doc.setFont('helvetica', 'normal').setFontSize(7.8).setTextColor(...GREY)
      doc.text([s.fromTerminal && `Terminal ${plain(s.fromTerminal)}`, s.baggage && `Check-in ${plain(s.baggage)}`].filter(Boolean).join('   '), M + 5, y + 22.5)
      doc.text([s.toTerminal && `Terminal ${plain(s.toTerminal)}`, s.cabinBaggage && `Cabin ${plain(s.cabinBaggage)}`].filter(Boolean).join('   '), 118, y + 22.5)
      y += 26
    })

    // passengers
    y += 12
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...BLUE).text('TRAVELLERS', M, y)
    y += 4
    doc.setFillColor(238, 243, 249).rect(M, y, W - 2 * M, 7, 'F')
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...GREY).text('NAME', M + 3, y + 4.8).text('TICKET NUMBER', 120, y + 4.8)
    y += 7
    ;(r.details?.passengers || []).forEach((p) => {
      doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(...NAVY).text(plain(p.name).toUpperCase(), M + 3, y + 6)
      doc.setFont('courier', 'normal').setFontSize(9.5).text(plain(p.ticket) || 'being issued', 120, y + 6)
      doc.setDrawColor(...LINE).setLineWidth(0.2).line(M, y + 9, W - M, y + 9)
      y += 9
    })

    // notes
    y += 10
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...NAVY).text('Before you travel', M, y)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GREY)
    const notes = [
      'Carry a valid government photo ID (a passport for international travel). The name must match the ticket.',
      "All times are local to the airport. Web check-in opens on the airline's own website.",
      'Cancellation and date-change fees are set by the airline. For any change, call or WhatsApp us on +91 99005 17604.',
    ]
    notes.forEach((n, i) => doc.text(doc.splitTextToSize(`${i + 1}. ${n}`, W - 2 * M - 4), M + 2, y + 5.5 + i * 8))

    // footer
    doc.setDrawColor(...LINE).setLineWidth(0.3).line(M, 282, W - M, 282)
    doc.setFontSize(7.5).setTextColor(...GREY)
    doc.text('Computer-generated e-ticket issued by Pro Tours & Travel Solutions, Bengaluru. No signature required.', M, 287)
    doc.text(`Page ${ti + 1} of ${tickets.length}`, W - M, 287, { align: 'right' })
  })
  return doc
}

async function logoDataUrl() {
  try {
    const blob = await (await fetch('/logo.png')).blob()
    return await new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(blob) })
  } catch { return null } // the ticket is still valid without the logo
}

export async function downloadTicket(done) {
  const tickets = (done.results || []).filter((r) => r.bookingId && !r.error)
  if (!tickets.length) throw new Error('The ticket is not issued yet.')
  const [{ jsPDF }, logo] = await Promise.all([import('jspdf'), logoDataUrl()])
  const doc = drawTickets(new jsPDF({ unit: 'mm', format: 'a4' }), { orderRef: done.orderRef, amount: done.amount, tickets, logo })
  doc.save(`E-ticket-${plain(tickets[0].pnr) || plain(done.orderRef)}.pdf`)
}
