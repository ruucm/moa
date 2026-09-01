// GET /api/watch?slug=… — doc-change SSE (a vite HMR replacement).
// With a slug, watches that project folder (the symlink target if symlinked); without, watches registry.json + projects/.
// On an event, the client reloads the index/doc. Debounced by 300ms.
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, PROJECTS, REGISTRY } from '../../../lib/paths.mjs'
import { j, getAuth } from '../../../lib/api.mjs'
import { canAccessProject } from '../../../lib/users.mjs'

export async function GET(req) {
  const auth = getAuth(req) // members also get live doc refresh — but only for invited projects
  if (!auth) return j({ error: 'Login required.' }, 401)
  const url = new URL(req.url)
  const slug = url.searchParams.get('slug')
  if (slug && auth.role !== 'admin' && !canAccessProject(auth.user, slug))
    return j({ error: 'You do not have access to this project.' }, 403)

  const targets = []
  if (slug && /^[\w.\-가-힣 ]+$/.test(slug)) {
    for (const rootRel of ['projects', 'demo/projects']) {
      try { targets.push(fs.realpathSync(path.join(ROOT, rootRel, slug))) } catch {}
    }
    // Also watch project-local components the doc imports (../src)
    for (const t of [...targets]) {
      const src = path.join(path.dirname(t), 'src')
      try { if (fs.statSync(src).isDirectory()) targets.push(src) } catch {}
    }
  } else {
    targets.push(PROJECTS, REGISTRY)
  }
  if (!targets.length) return j({ error: 'Nothing to watch.' }, 404)

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const send = (s) => { try { controller.enqueue(encoder.encode(s)) } catch {} }
      send('retry: 1000\n\n')
      let timer = null
      const fire = () => {
        clearTimeout(timer)
        timer = setTimeout(() => send('data: change\n\n'), 300)
      }
      const watchers = []
      for (const t of targets) {
        try { watchers.push(fs.watch(t, fire)) } catch {}
      }
      const beat = setInterval(() => send(': ping\n\n'), 30000)
      req.signal.addEventListener('abort', () => {
        clearTimeout(timer)
        clearInterval(beat)
        for (const w of watchers) { try { w.close() } catch {} }
        try { controller.close() } catch {}
      })
    },
  })
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
