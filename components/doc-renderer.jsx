'use client'
// Doc renderer — executes the CJS bundle from /api/doc in the browser.
// The bundle keeps react/@mdx-js/react external, so we inject the app's instances via require here
// (global component injection (Stats etc.) and hooks only work with the same React and the same MDXProvider).
import React, { useEffect, useState } from 'react'
import * as ReactNS from 'react'
import * as JSXRuntime from 'react/jsx-runtime'
import * as ReactDOMNS from 'react-dom'
import * as MDXReact from '@mdx-js/react'
import { MDXProvider } from '@mdx-js/react'
import * as shared from './shared.jsx'

// Wrap so esbuild's CJS interop (__toESM) can find both default and named exports
const asModule = (ns, dflt) => ({ ...ns, default: dflt ?? ns.default ?? ns, __esModule: true })
const MODULES = {
  react: asModule(ReactNS, ReactNS.default || ReactNS),
  'react/jsx-runtime': asModule(JSXRuntime),
  'react-dom': asModule(ReactDOMNS, ReactDOMNS.default || ReactDOMNS),
  '@mdx-js/react': asModule(MDXReact),
}
const requireShim = (id) => {
  if (MODULES[id]) return MODULES[id]
  throw new Error('The document bundle requested an unknown module: ' + id)
}

const evalBundle = (code) => {
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', code)(requireShim, mod, mod.exports)
  return mod.exports
}

// Reopening the same doc doesn't refetch — /api/watch change events bump version to invalidate
const cache = new Map() // `${slug}/${doc}@${version}` → { Component } | { error }

export default function DocRenderer({ slug, doc, version = 0 }) {
  const key = `${slug}/${doc}@${version}`
  const [state, setState] = useState(() => cache.get(key) || null)

  useEffect(() => {
    let alive = true
    const hit = cache.get(key)
    if (hit) { setState(hit); return }
    setState(null)
    fetch(`/api/doc?slug=${encodeURIComponent(slug)}&doc=${encodeURIComponent(doc)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (d.error || !d.code) return { error: d.error || `Request failed (${r.status})` }
        try {
          const m = evalBundle(d.code)
          return m.default ? { Component: m.default } : { error: 'The document module has no default export.' }
        } catch (e) { return { error: String(e && e.message || e) } }
      })
      .catch((e) => ({ error: String(e) }))
      .then((next) => {
        if (!next.error) cache.set(key, next)
        if (alive) setState(next)
      })
    return () => { alive = false }
  }, [key])

  if (!state) return <div className="doc-loading">Loading document…</div>
  if (state.error) return (
    <div className="doc-error">
      <div className="doc-error-title">Failed to render this document — {slug}/{doc}.mdx</div>
      <pre>{state.error}</pre>
    </div>
  )
  const Doc = state.Component
  return <MDXProvider components={shared}><Doc /></MDXProvider>
}
