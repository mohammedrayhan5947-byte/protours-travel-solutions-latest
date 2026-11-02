import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Runs the /api/*.js serverless functions inside the Vite dev server, so
 * `npm run dev` behaves like Vercel without needing the Vercel CLI.
 * Production builds are untouched — this only patches configureServer.
 */
function razorpayDevApi() {
  const mount = (server, route, file) => {
    server.middlewares.use(route, async (req, res) => {
      if (req.method !== 'POST' && req.method !== 'GET') {
        res.statusCode = 405
        return res.end('Method not allowed')
      }
      res.status = (code) => { res.statusCode = code; return res }
      res.json = (obj) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(obj))
      }
      if (req.method === 'GET') {
        const mod = await server.ssrLoadModule(file)
        return mod.default(req, res)
      }
      let raw = ''
      req.on('data', (c) => { raw += c })
      req.on('end', async () => {
        try {
          req.body = raw ? JSON.parse(raw) : {}
          res.status = (code) => { res.statusCode = code; return res }
          res.json = (obj) => {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(obj))
          }
          const mod = await server.ssrLoadModule(file)
          await mod.default(req, res)
        } catch (e) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Dev API error: ' + e.message }))
        }
      })
    })
  }

  return {
    name: 'razorpay-dev-api',
    configureServer(server) {
      mount(server, '/api/flights', '/api/flights.js')
      mount(server, '/api/crm', '/api/crm.js')
      mount(server, '/api/account', '/api/account.js')
      mount(server, '/api/enquiry', '/api/enquiry.js')
    },
  }
}

export default defineConfig(({ mode, isSsrBuild }) => {
  // Vite only auto-injects VITE_-prefixed vars into client code; loadEnv with
  // an empty prefix pulls in RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET from
  // .env.local too, so the dev API middleware above can read them.
  const env = loadEnv(mode, process.cwd(), '')
  // Server-only settings for the dev API (Razorpay, TBO, markup…). Never VITE_-prefixed.
  // Values typed in the terminal / the system win. Values that came from the .env files are remembered, so when you edit a .env
  // file and Vite restarts itself inside the same process (it does that automatically), the NEW values replace the old ones
  // instead of being skipped because "something is already set". (Skipping them mixed old test values with new live ones.)
  const fromFiles = (globalThis.__envFromFiles ||= new Set())
  for (const [k, v] of Object.entries(env)) {
    if (/^(RAZORPAY_|TBO_|FLIGHT|ALLOW_FAKE|SIGNING_SECRET|CRON_SECRET|STAFF_|CRM_|SUPABASE_)/.test(k) && (process.env[k] === undefined || fromFiles.has(k))) { process.env[k] = v; fromFiles.add(k) }
  }

  // Second build pass used only by scripts/prerender.mjs (see package.json).
  // gsap ships its plugins as ESM inside a CommonJS package, which Node can't
  // import directly, so it's bundled into the server build instead.
  if (isSsrBuild) {
    return {
      plugins: [react(), tailwindcss()],
      ssr: { noExternal: ['gsap', '@gsap/react'] },
      build: { outDir: 'dist-ssr', sourcemap: false, emptyOutDir: true },
    }
  }

  return {
    plugins: [react(), tailwindcss(), razorpayDevApi()],
    server: { port: 5173, open: true },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          // Keep the big, rarely-changing libraries in their own cacheable chunks.
          // Matched by path so sub-entries (react-dom/client, where React's
          // renderer actually lives) land in the vendor chunk too — the old
          // name list only caught the package root, leaving ~180 KB of React
          // in the app chunk that changes on every content edit.
          manualChunks(id) {
            if (!id.includes('node_modules')) return
            if (/node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'react'
            if (/node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return 'motion'
            if (/node_modules[\\/](gsap|@gsap)[\\/]/.test(id)) return 'gsap'
            if (/node_modules[\\/]lucide-react[\\/]/.test(id)) return 'icons'
          },
        },
      },
    },
  }
})
