// MOA live-reload hub — a SharedWorker. /api/watch/worker serves this file as it is (not bundled, no imports).
//
// A browser opens at most six connections to one plain-HTTP/1.1 server. When every visible MOA tab held its
// own /api/watch stream, six open windows used all six, and every further page load, API call and image
// waited forever. All MOA tabs of a browser share this worker instead, and it holds the one stream they all
// read (/api/watch?all=1) — so live reload costs one connection, however many tabs are open.
//
//   tab → worker   { topics, ask? }           what this tab wants right now: its whole list, every time, and
//                                             again every 10 s as a heartbeat. `ask` requests a 'ready' back.
//   worker → tab   { type: 'change', topic }  something under that topic was saved
//                  { type: 'ready' }          the stream is live — a tab that was hidden can catch up now
//
// A topic is a project slug, or '' for the hub's project list.

const ports = new Map() // port → { topics: Set, seen: ms }
let stream = null       // the EventSource, while any tab wants a topic
let live = false        // the stream is open
let heard = 0           // when the stream last said anything — the server beats every 30 s
let fails = 0
let backoff = null      // timer while a refused stream waits to be tried again
let idle = null         // timer while an unused stream waits to be let go

const wanted = () => {
  for (const tab of ports.values()) if (tab.topics.size) return true
  return false
}
const tell = (message, topic) => {
  for (const [port, tab] of ports) if (topic === undefined || tab.topics.has(topic)) port.postMessage(message)
}

function open() {
  if (stream || backoff) return
  const es = stream = new EventSource('/api/watch?all=1')
  heard = Date.now()
  es.onopen = () => { live = true; fails = 0; heard = Date.now(); tell({ type: 'ready' }) }
  es.onmessage = (event) => {
    heard = Date.now()
    let topic
    try { topic = JSON.parse(event.data).topic } catch {}
    if (typeof topic === 'string') tell({ type: 'change', topic }, topic)
  }
  es.onerror = () => {
    live = false
    // A dropped connection reconnects by itself. A refused one (logged out, server error) is closed for good,
    // and with it live reload in every tab — so try again, a little later each time.
    if (es.readyState !== EventSource.CLOSED || stream !== es) return
    stream = null
    backoff = setTimeout(() => { backoff = null; settle() }, Math.min(30000, 2000 * ++fails))
  }
}

function close() {
  clearTimeout(backoff)
  backoff = null
  if (stream) stream.close()
  stream = null
  live = false
}

// Keep the stream open while a tab wants something. Once none does (every tab hidden or gone), hold it a few
// seconds — switching from one tab to another must not reconnect — then let it go.
function settle() {
  clearTimeout(idle)
  if (wanted()) open()
  else idle = setTimeout(() => { if (!wanted()) close() }, 5000)
}

onconnect = (event) => {
  const port = event.ports[0]
  port.onmessage = ({ data }) => {
    const topics = Array.isArray(data && data.topics) ? data.topics.filter((topic) => typeof topic === 'string') : []
    if (topics.length) ports.set(port, { topics: new Set(topics), seen: Date.now() })
    else ports.delete(port)
    settle()
    if (data && data.ask && live) port.postMessage({ type: 'ready' })
  }
}

// Housekeeping. A tab that closed without saying so stops beating and is dropped. A stream that went quiet is
// dead without knowing it (a laptop that slept, a router that forgot the connection) and is opened again.
let ticked = Date.now()
setInterval(() => {
  const now = Date.now()
  const slept = now - ticked > 45000 // the machine was suspended — the tabs are not late, every clock here is
  ticked = now
  for (const [port, tab] of ports) {
    if (slept) tab.seen = now
    else if (now - tab.seen > 35000) ports.delete(port)
  }
  if (stream && (slept || now - heard > 75000)) close()
  settle()
}, 15000)
