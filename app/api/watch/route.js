// GET /api/watch — doc-change SSE (a vite HMR replacement). On an event, the client reloads the index/doc.
//   ?all=1   One stream for a whole browser: the hub plus every project this account may read. Each event is
//            JSON naming its topic — {"topic":"<slug>"}, or {"topic":""} for the hub; {} is the 30 s beat.
//            The SharedWorker (lib/watch-worker.js) holds it and passes the events on to its tabs, so live
//            reload never spends more than one of the browser's six connections per HTTP/1.1 host.
//   ?slug=…  One project folder (the symlink target if symlinked); without a slug, registry.json + projects/.
//            Sends a bare `data: change`. For browsers without SharedWorker — one stream per visible tab.
// Debounced by 300ms.
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, PROJECTS, REGISTRY } from '../../../lib/paths.mjs'
import { j, getAuth } from '../../../lib/api.mjs'
import { canAccessProject } from '../../../lib/users.mjs'

const SLUG = /^[\w.\-가-힣 ]+$/
const ROOTS = ['projects', 'demo/projects']
const HEADERS = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' }
const mayRead = (auth, slug) => auth.role === 'admin' || canAccessProject(auth.user, slug)

// Where a project's changes happen: its folder, and the project-local components its docs import (../src).
const projectDirs = (slug) => {
  const dirs = []
  for (const rootRel of ROOTS) {
    try { dirs.push(fs.realpathSync(path.join(ROOT, rootRel, slug))) } catch {}
  }
  for (const dir of [...dirs]) {
    const src = path.join(path.dirname(dir), 'src')
    try { if (fs.statSync(src).isDirectory()) dirs.push(src) } catch {}
  }
  return dirs
}

// Everything this account may hear about: path → the topics a change there belongs to ('' = the hub).
const allTargets = (auth) => {
  const targets = new Map([[PROJECTS, new Set([''])], [REGISTRY, new Set([''])]])
  const slugs = new Set()
  for (const rootRel of ROOTS) {
    try { for (const name of fs.readdirSync(path.join(ROOT, rootRel))) slugs.add(name) } catch {}
  }
  for (const slug of slugs) {
    if (slug.startsWith('.') || !SLUG.test(slug) || !mayRead(auth, slug)) continue
    for (const dir of projectDirs(slug)) {
      try { if (!fs.statSync(dir).isDirectory()) continue } catch { continue }
      if (!targets.has(dir)) targets.set(dir, new Set())
      targets.get(dir).add(slug)
    }
  }
  return targets
}

function watchAll(req) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const send = (s) => { try { controller.enqueue(encoder.encode(s)) } catch {} }
      const say = (message) => send(`data: ${JSON.stringify(message)}\n\n`)
      const timers = new Map()  // topic → debounce timer
      const watched = new Map() // path → { watcher, ino, topics }
      let beat = null
      const stop = () => {
        clearInterval(beat)
        for (const timer of timers.values()) clearTimeout(timer)
        for (const { watcher } of watched.values()) { try { watcher.close() } catch {} }
        watched.clear()
        try { controller.close() } catch {}
      }
      const fire = (topic) => {
        clearTimeout(timers.get(topic))
        timers.set(topic, setTimeout(() => {
          timers.delete(topic)
          say({ topic })
          if (topic === '') sync() // a project was added, removed or pointed somewhere else
        }, 300))
      }
      // This stream outlives page loads, so who is asking and what to watch are read again — on every hub
      // change and every beat. A project added later, or a folder replaced under the same path, is picked up
      // without a reconnect; an account that was disabled stops hearing.
      const sync = () => {
        const auth = getAuth(req)
        if (!auth) return stop()
        const targets = allTargets(auth)
        for (const [target, entry] of watched) {
          let ino = null
          try { ino = fs.statSync(target).ino } catch {}
          if (targets.has(target) && ino === entry.ino) { entry.topics = targets.get(target); continue }
          try { entry.watcher.close() } catch {}
          watched.delete(target)
        }
        for (const [target, topics] of targets) {
          if (watched.has(target)) continue
          try {
            const entry = { topics, ino: fs.statSync(target).ino }
            entry.watcher = fs.watch(target, () => { for (const topic of entry.topics) fire(topic) })
            entry.watcher.on('error', () => {})
            watched.set(target, entry)
          } catch {}
        }
      }
      send('retry: 1000\n\n')
      sync()
      beat = setInterval(() => { say({}); sync() }, 30000)
      req.signal.addEventListener('abort', stop)
    },
  })
  return new Response(stream, { status: 200, headers: HEADERS })
}

export async function GET(req) {
  const auth = getAuth(req) // members also get live doc refresh — but only for invited projects
  if (!auth) return j({ error: 'Login required.' }, 401)
  const url = new URL(req.url)
  if (url.searchParams.has('all')) return watchAll(req)
  const slug = url.searchParams.get('slug')
  if (slug && !mayRead(auth, slug))
    return j({ error: 'You do not have access to this project.' }, 403)

  const targets = slug && SLUG.test(slug) ? projectDirs(slug) : [PROJECTS, REGISTRY]
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
  return new Response(stream, { status: 200, headers: HEADERS })
}
