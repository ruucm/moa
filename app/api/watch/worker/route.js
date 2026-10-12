// GET /api/watch/worker — the SharedWorker script every tab of a browser shares for live reload (lib/watch-worker.js).
// Served from one fixed URL so all tabs get the same worker — a bundled chunk would change its URL with every build.
import fs from 'node:fs'
import path from 'node:path'
import { j, getAuth } from '../../../../lib/api.mjs'

export async function GET(req) {
  if (!getAuth(req)) return j({ error: 'Login required.' }, 401)
  const source = fs.readFileSync(path.join(process.cwd(), 'lib/watch-worker.js'), 'utf8')
  return new Response(source, {
    status: 200,
    headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' },
  })
}
