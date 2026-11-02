/* Applies supabase/schema.sql to your Supabase database (idempotent: safe to run again).

   DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres" node scripts/db-apply.mjs

   Needs the `pg` package, which is NOT a dependency of the site (run `npx -y -p pg node scripts/db-apply.mjs`
   or `npm i --no-save pg` first). The URL is in Supabase -> Project Settings -> Database -> Connection string. */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const url = process.env.DATABASE_URL
if (!url) { console.error('Set DATABASE_URL (see the comment at the top of this file).'); process.exit(1) }
const require = createRequire(import.meta.url)
let pg
try { pg = require('pg') } catch { console.error('Install pg first: npm i --no-save pg'); process.exit(1) }

const sql = fs.readFileSync(path.resolve(process.cwd(), 'supabase', 'schema.sql'), 'utf8')
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 })
await c.connect()
try {
  await c.query(sql)
  const t = await c.query("select table_name from information_schema.tables where table_schema = 'public' order by 1")
  console.log('schema applied. tables:', t.rows.map((r) => r.table_name).join(', '))
} finally {
  await c.end()
}
