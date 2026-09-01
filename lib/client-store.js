'use client'
// Shared client helpers — project index (/api/projects) cache + change-watch (SSE) hooks.
import { useEffect, useRef, useState, useCallback } from 'react'

let indexPromise = null
export const fetchIndex = (force) => {
  if (force || !indexPromise)
    indexPromise = fetch('/api/projects').then(async (r) => {
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
      return d
    })
  return indexPromise
}

export function useIndex() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const reload = useCallback(() => {
    fetchIndex(true).then(setData).catch((e) => setError(String(e.message || e)))
  }, [])
  useEffect(() => {
    fetchIndex().then(setData).catch((e) => setError(String(e.message || e)))
  }, [])
  return { data, error, reload }
}

// Clipboard copy — navigator.clipboard only exists on HTTPS/localhost.
// On plain-http access over a public IP (insecure context), fall back to textarea+execCommand,
// and if even that fails, show the URL in a prompt for manual copying.
export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true } catch {}
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    if (ok) return true
  } catch {}
  window.prompt('Automatic copy is not available here — copy manually:', text)
  return false
}

// Run a callback when a doc save is detected — a vite HMR replacement. Disabled for guests (non-owners), who lack endpoint access.
// Only the visible tab keeps an SSE connection — HTTP/1.1 caps concurrent connections at 6 per server, so background MOA tabs
// holding them all leaves every new navigation/API request stuck pending. Hidden tabs drop the connection,
// and on becoming visible again they reconnect + refresh immediately to pick up missed changes.
export function useWatch(slug, enabled, onChange) {
  const ref = useRef(onChange)
  ref.current = onChange
  useEffect(() => {
    if (!enabled) return
    let es = null
    const open = () => {
      if (es) return
      es = new EventSource(slug ? `/api/watch?slug=${encodeURIComponent(slug)}` : '/api/watch')
      es.onmessage = () => ref.current()
    }
    const close = () => { if (es) { es.close(); es = null } }
    const onVis = () => {
      if (document.hidden) close()
      else if (!es) { open(); ref.current() }
    }
    if (!document.hidden) open()
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); close() }
  }, [slug, enabled])
}
