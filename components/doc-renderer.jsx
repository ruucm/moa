'use client'
// 문서 렌더러 — /api/doc 이 준 CJS 번들을 브라우저에서 실행한다.
// 번들은 react/@mdx-js/react 를 external 로 남겨 두므로 여기서 앱 인스턴스를 require 로 주입한다
// (같은 React·같은 MDXProvider 라야 전역 컴포넌트(Stats 등) 주입과 훅이 동작한다).
import React, { useEffect, useState } from 'react'
import * as ReactNS from 'react'
import * as JSXRuntime from 'react/jsx-runtime'
import * as ReactDOMNS from 'react-dom'
import * as MDXReact from '@mdx-js/react'
import { MDXProvider } from '@mdx-js/react'
import * as shared from './shared.jsx'
import DesignSystemCatalog from './design-system-catalog.jsx'
import { Button, Icon, InlineAlert, Skeleton } from './ui/index.jsx'
import styles from './doc-renderer.module.css'

const documentComponents = {
  ...shared, DesignSystemCatalog,
  pre: props => <pre tabIndex={0} aria-label="Code block" {...props}/>,
}

// esbuild CJS interop(__toESM)이 default/named 를 모두 찾을 수 있는 형태로 감싼다
const asModule = (ns, dflt) => ({ ...ns, default: dflt ?? ns.default ?? ns, __esModule: true })
const MODULES = {
  react: asModule(ReactNS, ReactNS.default || ReactNS),
  'react/jsx-runtime': asModule(JSXRuntime),
  'react-dom': asModule(ReactDOMNS, ReactDOMNS.default || ReactDOMNS),
  '@mdx-js/react': asModule(MDXReact),
}
const requireShim = (id) => {
  if (MODULES[id]) return MODULES[id]
  throw new Error('Unknown module requested by document: ' + id)
}

const evalBundle = (code) => {
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', code)(requireShim, mod, mod.exports)
  return mod.exports
}

// 같은 문서를 다시 열 때 재요청하지 않는다 — /api/watch 변경 이벤트가 version 을 올려 무효화
const cache = new Map() // `${slug}/${doc}@${version}` → { Component } | { error }

function DocumentError({ error, onRetry }) {
  return <div className={styles.error}><InlineAlert tone="danger" title="Could not load this document.">Try again in a moment. You can still open other documents.</InlineAlert><div className={styles.errorActions}><Button onClick={onRetry}><Icon name="refresh" size={16}/> Try again</Button><details className={styles.details}><summary>View error details</summary><pre tabIndex={0} aria-label="Error details">{error}</pre></details></div></div>
}

class DocumentBoundary extends React.Component {
  state = { error: null, resetKey: null }
  static getDerivedStateFromProps(props, state) {
    return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey }
  }
  static getDerivedStateFromError(error) { return { error: String(error?.message || error) } }
  render() { return this.state.error ? <DocumentError error={this.state.error} onRetry={this.props.onRetry}/> : this.props.children }
}

export default function DocRenderer({ slug, doc, version = 0 }) {
  const key = `${slug}/${doc}@${version}`
  const identity = `${slug}/${doc}`
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState(() => ({ identity, result: cache.get(key) || null }))

  useEffect(() => {
    let alive = true
    const hit = cache.get(key)
    if (hit) { setState({ identity, result: hit }); return }
    setState(previous => previous.identity === identity && previous.result?.Component ? previous : { identity, result: null })
    fetch(`/api/doc?slug=${encodeURIComponent(slug)}&doc=${encodeURIComponent(doc)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (d.error || !d.code) return { error: d.error || `Request failed (${r.status})` }
        try {
          const m = evalBundle(d.code)
          return m.default ? { Component: m.default } : { error: 'The document has no default export.' }
        } catch (e) { return { error: String(e && e.message || e) } }
      })
      .catch((e) => ({ error: String(e) }))
      .then((next) => {
        if (!next.error) cache.set(key, next)
        if (alive) setState({ identity, result: next })
      })
    return () => { alive = false }
  }, [key, attempt])

  const retry = () => {
    cache.delete(key)
    // Do not remount a known failing component while its replacement loads.
    setState({ identity, result: null })
    setAttempt(value => value + 1)
  }
  const result = state.identity === identity ? state.result : null
  if (!result) return <div className={styles.loading} role="status" aria-label="Loading document"><Skeleton className={styles.titleSkeleton}/><Skeleton/><Skeleton/><Skeleton className={styles.shortSkeleton}/><span className="sr-only">Loading your document.</span></div>
  if (result.error) return <DocumentError error={result.error} onRetry={retry}/>
  const Doc = result.Component
  return <DocumentBoundary key={`${key}:${attempt}`} resetKey={Doc} onRetry={retry}><MDXProvider components={documentComponents}><Doc /></MDXProvider></DocumentBoundary>
}
