'use client'
// Project doc view (sidebar + body + Claude chat) — ported from the old src/main.jsx.
// The doc body is rendered by DocRenderer (the /api/doc bundle). Guests (share links) get a
// trimmed index so only the shared doc is visible — chat, settings, and other-project nav never render.
import React, { useEffect, useRef, useState } from 'react'
import { useIndex, useWatch, copyText } from '../lib/client-store.js'
import DocRenderer from './doc-renderer.jsx'

function useClaudeInfo(enabled) {
  const [info, setInfo] = useState(null)
  useEffect(() => {
    if (!enabled) return
    fetch('/api/claude').then((r) => r.json()).then(setInfo).catch(() => {})
  }, [enabled])
  return info || {}
}

// .claude skill/agent entry — click to run headless in the chat panel, ⧉ opens it in a terminal
function ClaudeItem({ slug, kind, item, onRun }) {
  const [state, setState] = useState(null) // null | 'busy' | 'ok' | error message
  const openTerminal = async (e) => {
    e.stopPropagation()
    setState('busy')
    let next = 'Run failed'
    try {
      const r = await fetch('/api/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, kind, name: item.name }),
      })
      const d = await r.json()
      next = r.ok ? 'ok' : d.error || next
    } catch {}
    setState(next)
    setTimeout(() => setState(null), 3000)
  }
  return (
    <div className="claude-item" title={item.description} role="button" tabIndex={0}
      onClick={() => onRun(kind, item)}
      onKeyDown={(e) => { if (e.key === 'Enter') onRun(kind, item) }}>
      <span className="claude-kind">{kind}</span>
      <span className="claude-name">{item.name}</span>
      {state === 'busy' ? <span className="claude-run">Opening…</span>
        : state === 'ok' ? <span className="claude-run">▸ Terminal</span>
        : state ? <span className="claude-run err">{state}</span>
        : <button className="claude-term" onClick={openTerminal} title="Open in terminal">⧉</button>}
    </div>
  )
}

// ── Claude chat panel — reads the /api/chat stream (NDJSON) and renders text, tool use, and results ──
const textOf = (content) => {
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content.map((b) => (typeof b === 'string' ? b : (b && b.text) || '')).join('')
  return ''
}
const toolLabel = (input) => {
  if (!input || typeof input !== 'object') return ''
  const v = input.command || input.pattern || input.file_path || input.path || input.url
    || input.description || input.skill || input.prompt || JSON.stringify(input)
  const s = String(v)
  return s.length > 90 ? s.slice(0, 90) + '…' : s
}

// Persist the chat per project in localStorage so it survives reloads (session_id + rendered items).
const chatKey = (slug) => `hub.chat.${slug}`
const loadChat = (slug) => {
  try { return JSON.parse(localStorage.getItem(chatKey(slug)) || 'null') || null } catch { return null }
}
const saveChat = (slug, sessionId, items) => {
  try {
    const trimmed = items.slice(-200).map((it) =>
      it.output && it.output.length > 4000 ? { ...it, output: it.output.slice(0, 4000) } : it)
    localStorage.setItem(chatKey(slug), JSON.stringify({ sessionId, items: trimmed }))
  } catch {} // ignore quota errors etc. — persistence is just a convenience
}

const sessionAge = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

function ChatPanel({ project, seed, onClose }) {
  const saved = React.useMemo(() => loadChat(project.slug), [project.slug])
  const [items, setItems] = useState(() => (saved && saved.items) || [])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [dangerous, setDangerous] = useState(false)
  const [sessionId, setSessionId] = useState(() => (saved && saved.sessionId) || null)
  const [showSessions, setShowSessions] = useState(false)
  const [sessions, setSessions] = useState(null) // null = loading
  const sessionRef = React.useRef(sessionId)
  const runRef = React.useRef(null)
  const listRef = React.useRef(null)
  const push = (it) => setItems((prev) => [...prev, it])
  const setSession = (id) => { sessionRef.current = id; setSessionId(id) }

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [items, busy])

  useEffect(() => { saveChat(project.slug, sessionId, items) }, [items, sessionId, project.slug])

  useEffect(() => {
    if (!showSessions) return
    setSessions(null)
    fetch(`/api/sessions?slug=${encodeURIComponent(project.slug)}`)
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions || []))
      .catch(() => setSessions([]))
  }, [showSessions, project.slug])

  // Load a session picked from the list into the panel — later messages attach to it via --resume
  const openSession = async (id) => {
    setShowSessions(false)
    try {
      const r = await fetch(`/api/session?slug=${encodeURIComponent(project.slug)}&id=${encodeURIComponent(id)}`)
      const d = await r.json()
      if (!r.ok) return push({ kind: 'error', text: d.error || `Couldn't read the session (${r.status})` })
      setSession(id)
      setItems(d.skipped
        ? [{ kind: 'note', text: `Skipped ${d.skipped} earlier items — showing recent messages only` }, ...(d.items || [])]
        : (d.items || []))
    } catch (e) {
      push({ kind: 'error', text: String(e) })
    }
  }

  const handleEvent = (ev) => {
    if (ev.type === 'moa-run') runRef.current = ev.runId
    else if (ev.type === 'system' && ev.subtype === 'init') setSession(ev.session_id)
    else if (ev.type === 'assistant') {
      for (const b of (ev.message && ev.message.content) || []) {
        if (!b || typeof b !== 'object') continue
        if (b.type === 'text' && b.text && b.text.trim()) push({ kind: 'text', text: b.text })
        if (b.type === 'tool_use') push({ kind: 'tool', id: b.id, name: b.name, label: toolLabel(b.input) })
      }
    } else if (ev.type === 'user') {
      for (const b of (ev.message && ev.message.content) || []) {
        if (!b || typeof b !== 'object' || b.type !== 'tool_result') continue
        setItems((prev) => prev.map((it) =>
          it.kind === 'tool' && it.id === b.tool_use_id
            ? { ...it, output: textOf(b.content), isError: !!b.is_error }
            : it))
      }
    } else if (ev.type === 'result') {
      if (ev.session_id) setSession(ev.session_id)
      push({
        kind: 'result', isError: !!ev.is_error, cost: ev.total_cost_usd, ms: ev.duration_ms,
        text: ev.subtype !== 'success' ? (textOf(ev.result) || ev.subtype) : null,
      })
    } else if (ev.type === 'moa-error') push({ kind: 'error', text: ev.error })
  }

  const send = async (prompt) => {
    const p = String(prompt || '').trim()
    if (!p || busy) return
    setBusy(true)
    push({ kind: 'user', text: p })
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: project.slug, prompt: p, sessionId: sessionRef.current, dangerous }),
      })
      if (!r.ok || !r.body) {
        const d = await r.json().catch(() => ({}))
        push({ kind: 'error', text: d.error || `Request failed (${r.status})` })
      } else {
        const reader = r.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let i
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim()
            buf = buf.slice(i + 1)
            if (!line) continue
            try { handleEvent(JSON.parse(line)) } catch {}
          }
        }
      }
    } catch (e) {
      push({ kind: 'error', text: String(e) })
    }
    runRef.current = null
    setBusy(false)
  }

  const stop = () => {
    if (!runRef.current) return
    fetch('/api/chat/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: runRef.current }),
    }).catch(() => {})
  }

  // Clicking a skill/agent in the sidebar refreshes the seed, which runs it right away
  useEffect(() => {
    if (seed && seed.prompt) send(seed.prompt)
  }, [seed && seed.nonce])

  return (
    <aside className="chat-panel">
      <div className="chat-head">
        <div className="chat-title">
          <span className="chat-title-name">Claude · {project.title}</span>
          {sessionId && <span className="chat-sid num" title={`session ${sessionId}`}>{sessionId.slice(0, 8)}</span>}
        </div>
        <div className="chat-head-actions">
          <button className="chip num" onClick={() => setShowSessions((v) => !v)}>History</button>
          <button className="chip num" disabled={busy}
            onClick={() => { setSession(null); setItems([]) }}>New session</button>
          <button className="chip num" onClick={onClose}>Close</button>
        </div>
      </div>
      {showSessions && (
        <div className="chat-sessions">
          {sessions === null && <div className="chat-sessions-empty">Loading…</div>}
          {sessions && sessions.length === 0 && (
            <div className="chat-sessions-empty">No claude sessions have run in this project yet.</div>
          )}
          {(sessions || []).map((s) => (
            <button key={s.id} className={'chat-session' + (s.id === sessionId ? ' on' : '')}
              onClick={() => openSession(s.id)} title={s.id}>
              <span className="chat-session-title">{s.title || '(untitled)'}</span>
              <span className="chat-session-meta num">{sessionAge(s.mtime)} · {Math.round(s.size / 1024)}KB</span>
            </button>
          ))}
        </div>
      )}
      <div className="chat-list" ref={listRef}>
        {items.length === 0 && !busy && (
          <div className="chat-empty">
            Type a skill (<code>/name</code>) or an instruction and <code>claude</code> runs
            headless from this project root — tool use and results stream in here.
          </div>
        )}
        {items.map((it, i) => {
          if (it.kind === 'note') return <div key={i} className="chat-note num">{it.text}</div>
          if (it.kind === 'user') return <div key={i} className="chat-msg user num">{it.text}</div>
          if (it.kind === 'text') return <div key={i} className="chat-msg assistant">{it.text}</div>
          if (it.kind === 'tool') return (
            <details key={i} className={'chat-tool' + (it.isError ? ' err' : '')}>
              <summary>
                <span className="chat-tool-name">{it.name}</span>
                <span className="chat-tool-label num">{it.label}</span>
                {it.output == null && <span className="chat-tool-wait">…</span>}
              </summary>
              {it.output != null && <pre className="num">{it.output.slice(0, 4000) || '(no output)'}</pre>}
            </details>
          )
          if (it.kind === 'result') return (
            <div key={i} className={'chat-result num' + (it.isError ? ' err' : '')}>
              {it.isError ? '✕ ' + (it.text || 'Failed') : '✓ Done'}
              {it.ms != null && ` · ${(it.ms / 1000).toFixed(1)}s`}
              {typeof it.cost === 'number' && ` · $${it.cost.toFixed(4)}`}
            </div>
          )
          return <div key={i} className="chat-result err">{it.text}</div>
        })}
        {busy && <div className="chat-busy">claude is working…</div>}
      </div>
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); const v = input; setInput(''); send(v) }}>
        <input value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="/skill-name or an instruction…" spellCheck={false} />
        {busy
          ? <button type="button" className="btn" onClick={stop}>Stop</button>
          : <button className="btn accent" disabled={!input.trim()}>Run</button>}
        <label className="chat-danger num" title="Auto-approve every tool — claude --permission-mode bypassPermissions">
          <input type="checkbox" checked={dangerous} onChange={(e) => setDangerous(e.target.checked)} />
          auto-approve
        </label>
      </form>
    </aside>
  )
}

// 🔗 Create/copy a share link for this doc (owner only)
function ShareButton({ slug, doc }) {
  const [state, setState] = useState(null) // null | 'busy' | 'copied' | error
  const share = async () => {
    setState('busy')
    try {
      const r = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, doc }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `Failed (${r.status})`)
      const url = `${location.origin}/s/${d.share.token}`
      setState((await copyText(url)) ? 'Link copied ✓' : 'Copy failed — copy the URL manually')
    } catch (e) { setState(String(e.message || e)) }
    setTimeout(() => setState(null), 2500)
  }
  return (
    <button className="chip num" onClick={share} disabled={state === 'busy'}
      title="Create and copy an external share link that shows only this doc (revoke in the hub's ⚙ Settings)">
      {state && state !== 'busy' ? state : '🔗 Share'}
    </button>
  )
}

// 👥 Create/copy a member invite link scoped to this project only (admin only)
function InviteButton({ slug }) {
  const [state, setState] = useState(null)
  const invite = async () => {
    setState('busy')
    try {
      const r = await fetch('/api/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'member', projects: [slug] }),
      })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d.error || `Failed (${r.status})`)
      const url = `${location.origin}/join/${d.token}`
      setState((await copyText(url)) ? 'Invite link copied ✓' : 'Copy failed — copy the URL manually')
    } catch (e) { setState(String(e.message || e)) }
    setTimeout(() => setState(null), 2500)
  }
  return (
    <button className="chip num" onClick={invite} disabled={state === 'busy'}
      title="Create and copy a teammate invite link scoped to this project (7 days, single-use — manage in the hub's ⚙ Settings)">
      {state && state !== 'busy' ? state : '👥 Invite teammate'}
    </button>
  )
}

export default function ProjectView({ slug, docSlug }) {
  const { data: index, error, reload } = useIndex()
  const owner = !!(index && index.owner) // admin — gates management features like share/chat
  const authed = owner || !!(index && index.member) // includes team members — gates viewing and live refresh
  const [docVersion, setDocVersion] = useState(0)
  useWatch(slug, authed, () => { reload(); setDocVersion((v) => v + 1) })
  const claude = useClaudeInfo(owner)

  const project = index && (index.projects || []).find((p) => p.slug === slug)
  // If a doc was specified but doesn't exist, don't silently fall back to another one —
  // we used to do || docs[0], which made deleted links look fine to the owner.
  // Only open the first doc when arriving at /p/<project> with no doc specified.
  const doc = project && (docSlug ? project.docs.find((d) => d.slug === docSlug) : project.docs[0])
  const cinfo = owner ? claude[slug] : null

  // Claude chat panel — null | { seed: null | { prompt, nonce } }
  const [chat, setChat] = useState(null)
  const runInChat = (kind, item) =>
    setChat({ seed: { prompt: kind === 'agent' ? `Use the ${item.name} subagent.` : `/${item.name}`, nonce: Date.now() } })

  const [collapsed, setCollapsed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(`hub.collapsed.${slug}`) || '[]')) } catch { return new Set() }
  })
  const toggle = (name) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      localStorage.setItem(`hub.collapsed.${slug}`, JSON.stringify([...next]))
      return next
    })

  useEffect(() => { window.scrollTo(0, 0) }, [doc && doc.slug])

  // Tab title = group tag · doc · project · MOA.
  // Only the start of a tab is visible, so shorten the group to its short tag
  // ("12: Episode name (…)" → "12") and put it first.
  useEffect(() => {
    if (!project) return
    const g = (doc && doc.group) || ''
    const tag = g && (g.match(/^\s*([^:]{1,12}):/) || [])[1]
    const short = (tag || g).trim().slice(0, 20)
    document.title = [short, doc && doc.title, project.title, 'MOA'].filter(Boolean).join(' · ')
  }, [project, doc])

  // If the sidebar is long and the current doc is off-screen, scroll just the sidebar to reveal it.
  const navRef = useRef(null)
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const el = nav.querySelector('a.active')
    if (!el || nav.scrollHeight <= nav.clientHeight) return
    const pad = 60
    const top = el.offsetTop - nav.offsetTop
    const bottom = top + el.offsetHeight
    if (top < nav.scrollTop + pad) nav.scrollTop = Math.max(0, top - pad)
    else if (bottom > nav.scrollTop + nav.clientHeight - pad) nav.scrollTop = bottom - nav.clientHeight + pad
  }, [doc && doc.slug, collapsed])

  if (error) return <div className="hub"><div className="doc-error"><pre>{error}</pre></div></div>
  if (!index) return <div className="hub"><div className="doc-loading">Loading…</div></div>
  if (!project) return (
    <div className="hub">
      <div className="doc-error"><div className="doc-error-title">Project not found: {slug}</div></div>
    </div>
  )
  // Only when docSlug was specified but missing — an empty project with 0 docs falls through to the "no docs yet" screen below
  if (docSlug && !doc) return (
    <div className="hub">
      <div className="doc-error">
        <div className="doc-error-title">Doc not found: {slug}/{docSlug}</div>
        <p>It may have been deleted or renamed.</p>
      </div>
    </div>
  )

  // Groups keep first-appearance order (= lowest order). Docs without a group are listed flat, no group header.
  const groups = []
  for (const d of project.docs) {
    const name = d.group || ''
    let g = groups.find((x) => x.name === name)
    if (!g) groups.push((g = { name, items: [] }))
    g.items.push(d)
  }
  const projectList = (index.projects || []).filter((p) => !new Set(index.hidden || []).has(p.slug))
  const docHref = (d) => `/p/${encodeURIComponent(slug)}/${encodeURIComponent(d.slug)}`

  return (
    <div className="layout">
      <nav className="sidebar" ref={navRef}>
        {authed ? <a className="brand" href="/">← MOA</a> : <span className="brand">MOA</span>}
        <div className="project-name">{project.title}</div>
        {groups.map((g) =>
          g.name === '' ? (
            g.items.map((d) => (
              <a key={d.slug} href={docHref(d)} className={doc && d.slug === doc.slug ? 'active' : ''}>{d.title}</a>
            ))
          ) : (
            <div key={g.name} className={'nav-group' + (collapsed.has(g.name) ? '' : ' open') + (g.items.some((d) => doc && d.slug === doc.slug) ? ' has-active' : '')}>
              <button className="nav-group-head" onClick={() => toggle(g.name)}>
                <span className="caret">▶</span>
                <span className="nav-group-name">{g.name}</span>
                <span className="nav-group-count num">{g.items.length}</span>
              </button>
              {!collapsed.has(g.name) && (
                <div className="nav-group-items">
                  {g.items.map((d) => (
                    <a key={d.slug} href={docHref(d)} className={doc && d.slug === doc.slug ? 'active' : ''}>{d.title}</a>
                  ))}
                </div>
              )}
            </div>
          )
        )}
        {owner && (
          <div className="sidebar-projects">
            <div className="klabel">Share · Invite</div>
            {doc && <ShareButton slug={slug} doc={doc.slug} />}
            <InviteButton slug={slug} />
          </div>
        )}
        {cinfo && (
          <div className="sidebar-projects">
            <div className="klabel">.claude skills · agents</div>
            <button className="chat-open" onClick={() => setChat((c) => c || { seed: null })}>💬 Open Claude chat</button>
            {cinfo.skills.map((s) => (
              <ClaudeItem key={s.name} slug={slug} kind="skill" item={s} onRun={runInChat} />
            ))}
            {cinfo.agents.map((a) => (
              <ClaudeItem key={a.name} slug={slug} kind="agent" item={a} onRun={runInChat} />
            ))}
          </div>
        )}
        {authed && (
          <div className="sidebar-projects">
            <div className="klabel">Other projects</div>
            {projectList.filter((p) => p.slug !== slug).map((p) => (
              <a key={p.slug} href={`/p/${encodeURIComponent(p.slug)}`}>{p.title}</a>
            ))}
          </div>
        )}
      </nav>
      <main className="content">
        <article className="page">
          {doc ? <DocRenderer slug={slug} doc={doc.slug} version={docVersion} /> : (
            <>
              <h1>{project.title}</h1>
              <p>No docs yet. {project.path
                ? <>Once an agent writes an <code>.mdx</code> report to <code>{project.path}</code>, it shows up here.</>
                : <>Add an <code>.mdx</code> report to this project folder and it shows up here.</>}</p>
            </>
          )}
        </article>
      </main>
      {chat && project && <ChatPanel key={slug} project={project} seed={chat.seed} onClose={() => setChat(null)} />}
    </div>
  )
}
