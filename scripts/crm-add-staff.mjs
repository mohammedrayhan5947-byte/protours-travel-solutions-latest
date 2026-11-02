/* Creates (or resets the password of) a CRM staff login in Supabase Auth.

     node scripts/crm-add-staff.mjs someone@example.com                (a strong password is generated and shown once)
     CRM_STAFF_PASSWORD='...' node scripts/crm-add-staff.mjs someone@example.com

   Needs SUPABASE_URL and SUPABASE_SERVICE_KEY (read from .env.local / .env when not already set).
   A Supabase account alone does NOT give access: the e-mail must also be listed in CRM_ALLOWED_EMAILS
   on the server (Vercel -> Environment Variables), comma separated. */
import crypto from 'node:crypto'
import fs from 'node:fs'

for (const f of ['.env.local', '.env']) {
  if (!fs.existsSync(f)) continue
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m && m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const email = (process.argv[2] || '').trim().toLowerCase()
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY
if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { console.error('Usage: node scripts/crm-add-staff.mjs someone@example.com'); process.exit(1) }
if (!url || !key) { console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are not set.'); process.exit(1) }

const password = process.env.CRM_STAFF_PASSWORD || crypto.randomBytes(12).toString('base64url') + 'aA1!'
if (password.length < 12) { console.error('Use a password of at least 12 characters.'); process.exit(1) }

const admin = (path, method = 'GET', body) =>
  fetch(`${url}/auth/v1/admin/${path}`, { method, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }))

const list = await admin('users?per_page=1000')
const existing = (list.json.users || []).find((u) => (u.email || '').toLowerCase() === email)
const r = existing
  ? await admin(`users/${existing.id}`, 'PUT', { password, email_confirm: true })
  : await admin('users', 'POST', { email, password, email_confirm: true })
if (r.status >= 300) { console.error('Supabase refused:', r.json.msg || r.json.message || r.status); process.exit(1) }

console.log(`${existing ? 'Password reset for' : 'Created'} ${email}`)
if (!process.env.CRM_STAFF_PASSWORD) console.log(`Password (shown once, change it after the first sign-in): ${password}`)
console.log('Reminder: add this e-mail to CRM_ALLOWED_EMAILS on the server, or the CRM will refuse it.')
