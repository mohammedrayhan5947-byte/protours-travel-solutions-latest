import { db, dbConfigured, addEvent } from './_lib/db.js'

/**
 * Public endpoint: saves a website enquiry for the CRM. The sender must tick the consent box on the form
 * (see the Privacy Policy). Spam: a hidden "website" field that people leave empty, plus a small per-IP
 * limit (best effort: serverless instances do not share memory).
 */
const hits = new Map()
const tooMany = (ip) => {
  const now = Date.now()
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3_600_000)
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 5000) hits.clear()
  return recent.length > 6
}

const txt = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max)

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }) }
  if (!dbConfigured()) return res.status(503).json({ error: 'Not available right now.' })

  const b = req.body && typeof req.body === 'object' ? req.body : {}
  if (b.website) return res.status(200).json({ ok: true }) // a bot filled the hidden field: pretend it worked
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown'
  if (tooMany(ip)) return res.status(429).json({ error: 'Too many messages. Please call or WhatsApp us.' })

  const name = txt(b.name, 80) || 'Website visitor', phone = txt(b.phone, 20).replace(/[^\d+ ]/g, ''), email = txt(b.email, 120)
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 15) return res.status(400).json({ error: 'Please enter a valid phone number.' })
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Please check your email address.' })
  if (b.consent !== true) return res.status(400).json({ error: 'Please tick the box to let us save your enquiry.' })

  const row = { name, phone, email: email || null, topic: txt(b.topic, 80) || null, message: txt(b.message, 1500) || null, page: txt(b.page, 120) || null, consent: true }
  try {
    // the same person double-clicking "send" should not create two enquiries
    const since = new Date(Date.now() - 10 * 60_000).toISOString()
    const dup = await db(`enquiries?phone=eq.${encodeURIComponent(phone)}&created_at=gte.${since}&select=id&limit=1`)
    if (dup.rows?.length) return res.status(200).json({ ok: true })
    const { rows } = await db('enquiries', { method: 'POST', body: row, prefer: 'return=representation' })
    if (rows?.[0]?.id) await addEvent('enquiry', rows[0].id, 'created', 'customer', { page: row.page, topic: row.topic })
    return res.status(200).json({ ok: true })
  } catch (e) {
    console.error('[enquiry]', e.message)
    return res.status(502).json({ error: 'Could not save your message. Please call or WhatsApp us.' })
  }
}
