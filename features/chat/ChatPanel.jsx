'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Button, EmptyState, Icon, IconButton, StatusBadge, Textarea } from '../../components/ui/index.jsx'
import styles from './chat.module.css'

const textOf = (content) => typeof content === 'string' ? content : Array.isArray(content)
  ? content.map((block) => typeof block === 'string' ? block : block?.text || '').join('') : ''
const toolLabel = (input) => {
  if (!input || typeof input !== 'object') return ''
  const value = input.command || input.pattern || input.file_path || input.path || input.url
    || input.description || input.skill || input.prompt || JSON.stringify(input)
  const label = String(value)
  return label.length > 90 ? `${label.slice(0, 90)}…` : label
}
const chatKey = (slug) => `hub.chat.${slug}`
const loadChat = (slug) => {
  try { return JSON.parse(localStorage.getItem(chatKey(slug)) || 'null') } catch { return null }
}
const saveChat = (slug, sessionId, items) => {
  try {
    const trimmed = items.slice(-200).map((item) => item.output?.length > 4000 ? { ...item, output: item.output.slice(0, 4000) } : item)
    localStorage.setItem(chatKey(slug), JSON.stringify({ sessionId, items: trimmed }))
  } catch {}
}
const sessionAge = (timestamp) => {
  const minutes = Math.round((Date.now() - timestamp) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}

function ProjectTool({ project, kind, item, onRun, disabled }) {
  const [state, setState] = useState(null)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const openTerminal = async () => {
    clearTimeout(timer.current)
    setState('busy')
    try {
      const response = await fetch('/api/trigger', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: project.slug, kind, name: item.name }),
      })
      const data = await response.json()
      setState(response.ok ? 'Terminal opened' : data.error || 'Could not open Terminal')
    } catch { setState('Could not open Terminal') }
    timer.current = setTimeout(() => setState(null), 4000)
  }
  return <div className={styles.projectTool}>
    <button className={styles.projectToolRun} onClick={() => onRun(kind, item)} disabled={disabled} title={item.description}>
      <Icon name={kind === 'agent' ? 'users' : 'sparkles'} size={15} />
      <span><strong>{item.name}</strong><small>{kind === 'agent' ? 'Agent' : 'Skill'}</small></span>
      <Icon name="arrowRight" size={14} />
    </button>
    <IconButton icon="terminal" label={`${item.name} open in Terminal`} disabled={state === 'busy'} onClick={openTerminal} />
    {state && state !== 'busy' && <span role="status" className={styles.toolNotice}>{state}</span>}
  </div>
}

function Message({ item }) {
  if (item.kind === 'note') return <div className={styles.note}>{item.text}</div>
  if (item.kind === 'user') return <div className={styles.userMessage}><span className={styles.messageLabel}>You</span><div>{item.text}</div></div>
  if (item.kind === 'text') return <div className={styles.assistantMessage}><span className={styles.messageLabel}><Icon name="sparkles" size={14} />Claude</span><div>{item.text}</div></div>
  if (item.kind === 'tool') return <details className={`${styles.toolResult} ${item.isError ? styles.error : ''}`}>
    <summary><Icon name="terminal" size={14} /><span><strong>{item.name}</strong><small>{item.label}</small></span><Icon name="chevronDown" size={14} /></summary>
    {item.output != null ? <pre tabIndex={0} aria-label={`${item.name} output`}>{item.output.slice(0, 4000) || 'No output'}</pre> : <p>Waiting for a result.</p>}
  </details>
  if (item.kind === 'result') return <div className={`${styles.result} ${item.isError ? styles.error : ''}`}>
    <Icon name={item.isError ? 'alertCircle' : 'check'} size={14} />
    <span>{item.isError ? item.text || 'The task did not complete' : 'Done'}
      {item.ms != null && ` · ${(item.ms / 1000).toFixed(1)}s`}
      {typeof item.cost === 'number' && ` · $${item.cost.toFixed(4)}`}</span>
  </div>
  return <div className={styles.messageError} role="alert"><Icon name="alertCircle" size={16} /><span>{item.text}</span></div>
}

export default function ChatPanel({ project, tools, seed, onClose, compactHeader = false, visible = true, renderPanel }) {
  const [items, setItems] = useState([])
  const [restored, setRestored] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [dangerous, setDangerous] = useState(false)
  const [sessionId, setSessionId] = useState(null)
  const [showSessions, setShowSessions] = useState(false)
  const [sessions, setSessions] = useState(null)
  const [sessionsError, setSessionsError] = useState(null)
  const [loadingSession, setLoadingSession] = useState(false)
  const sessionRef = useRef(null)
  const runRef = useRef(null)
  const busyRef = useRef(false)
  const abortRef = useRef(null)
  const listRef = useRef(null)
  const seedRef = useRef(null)
  const formRef = useRef(null)
  const inputRef = useRef(null)
  const historyButtonRef = useRef(null)
  const push = (item) => setItems((previous) => [...previous, item])
  const setSession = (id) => { sessionRef.current = id; setSessionId(id) }

  useEffect(() => {
    const saved = loadChat(project.slug)
    if (saved) {
      setSession(saved.sessionId || null)
      setItems(Array.isArray(saved.items) ? saved.items : [])
    }
    setRestored(true)
    // Closing the panel only hides its presentation. Leaving the project or
    // losing access unmounts the controller and releases the running stream.
    return () => { abortRef.current?.abort() }
  }, [project.slug])

  useEffect(() => {
    if (restored) saveChat(project.slug, sessionId, items)
  }, [items, sessionId, restored, project.slug])
  useEffect(() => {
    if (restored && visible && !compactHeader) inputRef.current?.focus({ preventScroll: true })
  }, [restored, visible, compactHeader])
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [items, busy, compactHeader, visible])

  useEffect(() => {
    if (!showSessions) return
    let alive = true
    setSessions(null)
    setSessionsError(null)
    fetch(`/api/sessions?slug=${encodeURIComponent(project.slug)}`)
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Could not load conversation history')
        return data.sessions || []
      })
      .then((result) => { if (alive) setSessions(result) })
      .catch((error) => { if (alive) { setSessions([]); setSessionsError(error.message) } })
    return () => { alive = false }
  }, [showSessions, project.slug])

  const openSession = async (id) => {
    if (busyRef.current || loadingSession) return
    setLoadingSession(true)
    let loaded = false
    try {
      const response = await fetch(`/api/session?slug=${encodeURIComponent(project.slug)}&id=${encodeURIComponent(id)}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || `Could not load the conversation (${response.status})`)
      setSession(id)
      setItems(data.skipped ? [{ kind: 'note', text: `Showing recent messages; ${data.skipped} earlier items omitted.` }, ...(data.items || [])] : data.items || [])
      setShowSessions(false)
      loaded = true
    } catch (error) { setSessionsError(error.message) }
    finally {
      setLoadingSession(false)
      requestAnimationFrame(() => (loaded ? inputRef : historyButtonRef).current?.focus({ preventScroll: true }))
    }
  }

  const handleEvent = (event) => {
    if (event.type === 'moa-run') runRef.current = event.runId
    else if (event.type === 'system' && event.subtype === 'init') setSession(event.session_id)
    else if (event.type === 'assistant') {
      for (const block of event.message?.content || []) {
        if (!block || typeof block !== 'object') continue
        if (block.type === 'text' && block.text?.trim()) push({ kind: 'text', text: block.text })
        if (block.type === 'tool_use') push({ kind: 'tool', id: block.id, name: block.name, label: toolLabel(block.input) })
      }
    } else if (event.type === 'user') {
      for (const block of event.message?.content || []) {
        if (!block || typeof block !== 'object' || block.type !== 'tool_result') continue
        setItems((previous) => previous.map((item) => item.kind === 'tool' && item.id === block.tool_use_id
          ? { ...item, output: textOf(block.content), isError: !!block.is_error } : item))
      }
    } else if (event.type === 'result') {
      if (event.session_id) setSession(event.session_id)
      push({ kind: 'result', isError: !!event.is_error, cost: event.total_cost_usd, ms: event.duration_ms,
        text: event.subtype !== 'success' ? textOf(event.result) || event.subtype : null })
    } else if (event.type === 'moa-error') push({ kind: 'error', text: event.error })
  }

  const send = async (prompt) => {
    const value = String(prompt || '').trim()
    if (!value || busyRef.current || loadingSession) return
    busyRef.current = true
    setBusy(true)
    setShowSessions(false)
    push({ kind: 'user', text: value })
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ slug: project.slug, prompt: value, sessionId: sessionRef.current, dangerous }),
      })
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || `Could not send the request (${response.status})`)
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const consume = (line) => { if (line.trim()) { try { handleEvent(JSON.parse(line)) } catch {} } }
      for (;;) {
        const { done, value: chunk } = await reader.read()
        if (done) break
        buffer += decoder.decode(chunk, { stream: true })
        let position
        while ((position = buffer.indexOf('\n')) >= 0) {
          consume(buffer.slice(0, position))
          buffer = buffer.slice(position + 1)
        }
      }
      consume(buffer + decoder.decode())
    } catch (error) {
      if (error.name !== 'AbortError') push({ kind: 'error', text: error.message || String(error) })
    } finally {
      runRef.current = null
      abortRef.current = null
      busyRef.current = false
      setBusy(false)
    }
  }

  const stop = async () => {
    // Own the controller for this run. Awaiting the stop endpoint first could
    // let a completed run's late response abort a newly started conversation.
    const controller = abortRef.current
    const runId = runRef.current
    if (!controller || controller.signal.aborted) return
    controller.abort()
    push({ kind: 'note', text: 'Task stopped.' })
    if (runId) {
      try {
        const response = await fetch('/api/chat/stop', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId }),
        })
        // Disconnecting the stream also stops the server process, so a 404
        // here simply means that this run has already ended.
        if (!response.ok && response.status !== 404) throw new Error('The connection is closed, but stopping the task could not be confirmed.')
      } catch (error) { push({ kind: 'error', text: error.message || 'The connection is closed, but stopping the task could not be confirmed.' }) }
    }
  }

  useEffect(() => {
    if (restored && seed?.prompt && seedRef.current !== seed.nonce) {
      seedRef.current = seed.nonce
      send(seed.prompt)
    }
  }, [restored, seed?.nonce])

  const runTool = (kind, item) => send(kind === 'agent' ? `Use the ${item.name} subagent.` : `/${item.name}`)
  const hasTools = (tools?.skills?.length || 0) + (tools?.agents?.length || 0) > 0
  const submit = (event) => {
    event.preventDefault()
    if (busy || loadingSession || !input.trim()) return
    const prompt = input
    setInput('')
    send(prompt)
  }

  // The controller stays mounted when the responsive wrapper changes. Drafts,
  // stream ownership and session state survive a window resize or rotation.
  const panel = <section className={styles.panel} aria-label="Project AI conversation">
    {!compactHeader && <header className={styles.header}>
      <div className={styles.heading}><span className={styles.assistantIcon}><Icon name="sparkles" size={18} /></span><div><strong>AI assistant</strong><span>Claude · {project.title}</span></div></div>
      <IconButton icon="x" label="Close AI assistant" onClick={onClose} />
    </header>}
    <div className={styles.toolbar}>
      <Button ref={historyButtonRef} variant={showSessions ? 'secondary' : 'ghost'} size="sm" disabled={busy || loadingSession} aria-expanded={showSessions} onClick={() => setShowSessions((value) => !value)}><Icon name="history" size={15} />History</Button>
      <Button variant="ghost" size="sm" disabled={busy || loadingSession} onClick={() => { setSession(null); setItems([]); setShowSessions(false); inputRef.current?.focus({ preventScroll: true }) }}><Icon name="plus" size={15} />New session</Button>
      {sessionId && <span className={styles.sessionMarker} title={`Session ${sessionId}`}>Resuming session</span>}
    </div>
    {showSessions ? <div className={styles.sessions} aria-label="History">
      {sessions === null && <p role="status" className={styles.note}>Loading conversation history.</p>}
      {sessionsError && <p className={styles.messageError} role="alert">{sessionsError}</p>}
      {sessions?.length === 0 && !sessionsError && <EmptyState icon="history" title="No conversations yet" description="Continue conversations started in this project." />}
      {(sessions || []).map((session) => <button key={session.id} className={`${styles.session} ${session.id === sessionId ? styles.selectedSession : ''}`}
        onClick={() => openSession(session.id)} disabled={loadingSession} title={session.id}>
        <span>{session.title || 'Untitled conversation'}</span><small>{sessionAge(session.mtime)} · {Math.round(session.size / 1024)}KB</small>
      </button>)}
    </div> : <div className={styles.messageList} ref={listRef} tabIndex={0} role="log" aria-label="AI conversation" aria-live="polite" aria-relevant="additions text">
      {items.length === 0 && !busy && <div className={styles.welcome}>
        <span className={styles.welcomeIcon}><Icon name="sparkles" size={24} /></span>
        <h2>From notes to next steps</h2><p>Explore your project, organize reports,<br />and keep the work moving.</p>
        <div className={styles.suggestions}>
          {['Summarize the current state of this project', 'Suggest what to work on next'].map((prompt) => <button key={prompt} onClick={() => { setInput(prompt); inputRef.current?.focus({ preventScroll: true }) }}><span>{prompt}</span><Icon name="arrowUp" size={15} /></button>)}
        </div>
      </div>}
      {items.map((item, index) => <Message key={index} item={item} />)}
      {busy && <div className={styles.busy} role="status"><span />Claude is working</div>}
    </div>}
    {hasTools && <details className={styles.projectTools}>
      <summary><Icon name="sparkles" size={15} />Project tools<span>{(tools.skills?.length || 0) + (tools.agents?.length || 0)}</span><Icon name="chevronDown" size={14} /></summary>
      <div className={styles.projectToolsList}>
        {(tools.skills || []).map((item) => <ProjectTool key={`skill-${item.name}`} project={project} item={item} kind="skill" onRun={runTool} disabled={busy || loadingSession} />)}
        {(tools.agents || []).map((item) => <ProjectTool key={`agent-${item.name}`} project={project} item={item} kind="agent" onRun={runTool} disabled={busy || loadingSession} />)}
      </div>
    </details>}
    <form ref={formRef} className={styles.composer} onSubmit={submit}>
      <div className={styles.inputBox}>
        <Textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} rows={3} aria-label="Message to AI" placeholder="What would you like to work on?" spellCheck={false}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !busy) { event.preventDefault(); formRef.current?.requestSubmit() } }} />
        <div className={styles.composerActions}>
          <span>Shift + Enter for a new line</span>
          {busy ? <Button type="button" variant="secondary" size="sm" onClick={stop}><Icon name="stop" size={14} />Stop</Button>
            : <Button type="submit" variant="primary" size="sm" disabled={!input.trim() || loadingSession}><Icon name="arrowUp" size={15} />Send</Button>}
        </div>
      </div>
      <label className={styles.approvalOption}>
        <input type="checkbox" checked={dangerous} disabled={busy} onChange={(event) => setDangerous(event.target.checked)} />
        <span>Auto-approve tools</span>{dangerous && <StatusBadge tone="warning">On</StatusBadge>}
      </label>
      {dangerous && <p className={styles.approvalHint}>File edits and commands run without confirmation.</p>}
    </form>
  </section>
  return renderPanel ? renderPanel(panel) : panel
}
