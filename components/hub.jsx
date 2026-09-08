'use client'
import React, { useEffect, useState } from 'react'
import { useIndex, useWatch } from '../lib/client-store.js'
import { Button, EmptyState, Icon, IconButton, InlineAlert } from './ui/index.jsx'
import HubIdentity from '../features/hub/hub-identity.jsx'
import ProjectCard from '../features/hub/project-card.jsx'
import ProjectToolbar from '../features/hub/project-toolbar.jsx'
import useProjectOrder from '../features/hub/use-project-order.js'
import SettingsPanel from '../features/settings/settings-panel.jsx'
import AddProjectModal from '../features/settings/add-project-modal.jsx'
import styles from '../features/hub/hub.module.css'

export default function Hub() {
  const { data: index, error, reload } = useIndex()
  const owner = !!index?.owner
  const authed = owner || !!index?.member
  useWatch(null, authed, reload)
  const [user, setUser] = useState(null)
  const [projectTools, setProjectTools] = useState({})
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false)
  const [showDemos, setShowDemos] = useState(false)
  const workspaceMenuRef = React.useRef(null)
  const workspaceTriggerRef = React.useRef(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [feedback, setFeedback] = useState(null)
  const [loggingOut, setLoggingOut] = useState(false)
  useEffect(() => {
    if (!authed) return
    const controller = new AbortController()
    fetch('/api/me', { signal: controller.signal }).then((r) => r.ok ? r.json() : null).then((data) => {
      if (!controller.signal.aborted) setUser(data)
    }).catch(() => {})
    return () => controller.abort()
  }, [authed])
  useEffect(() => {
    if (!owner) return
    const controller = new AbortController()
    fetch('/api/claude', { signal: controller.signal }).then((r) => r.ok ? r.json() : {}).then((data) => {
      if (!controller.signal.aborted) setProjectTools(data)
    }).catch(() => {})
    return () => controller.abort()
  }, [owner])
  useEffect(() => {
    document.title = 'Projects · MOA'
    const go = () => { const m = location.hash.match(/^#\/([^/]+)(?:\/([^/]+))?/); if (m) location.replace(`/p/${m[1]}${m[2] ? '/' + m[2] : ''}`) }
    go(); window.addEventListener('hashchange', go)
    return () => window.removeEventListener('hashchange', go)
  }, [])
  useEffect(() => {
    if (!showWorkspaceMenu) return
    workspaceMenuRef.current?.querySelector('button')?.focus()
    const dismiss = event => {
      if (event.type === 'keydown' && event.key !== 'Escape') return
      if (event.type === 'pointerdown' && (workspaceMenuRef.current?.contains(event.target) || workspaceTriggerRef.current?.contains(event.target))) return
      setShowWorkspaceMenu(false)
      if (event.type === 'keydown') workspaceTriggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismiss)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', dismiss) }
  }, [showWorkspaceMenu])
  const hidden = new Set(index?.hidden || [])
  const all = (index?.projects || []).filter((p) => !hidden.has(p.slug))
  const order = useProjectOrder(all.filter((p) => !p.demo), index, (text) => setFeedback({ tone: 'danger', text }), reload)
  const filtered = query.trim() !== '' || status !== 'all'
  const matches = (p) => (status === 'all' || (p.status || 'active') === status) && `${p.title} ${p.description || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  const projects = order.list.filter(matches)
  const demos = all.filter((p) => p.demo).filter(matches)
  const resultCount = projects.length + demos.length
  const demosExpanded = filtered || showDemos
  const clearFilters = () => { setQuery(''); setStatus('all') }
  const logout = async () => {
    setLoggingOut(true)
    try { const r = await fetch('/api/logout', { method: 'POST' }); if (!r.ok) throw new Error('Could not log out. Please try again.'); location.href = '/login' }
    catch (e) { setFeedback({ tone: 'danger', text: e.message }); setLoggingOut(false) }
  }
  return <div className={styles.hubShell}>
    <a href="#project-content" className={styles.skipLink}>Skip to projects</a>
    <header className={styles.topbar}>
      <div className={styles.topbarInner}>
        <HubIdentity />
        <nav className={styles.topbarActions} aria-label="Workspace management">
          {owner && <Button className={styles.addButton} onClick={() => setShowAdd(true)}><Icon name="plus" size={17} />New project</Button>}
          {authed && <div className={styles.workspaceMenuWrap}>
            <IconButton ref={workspaceTriggerRef} icon="more" label="Workspace menu" aria-expanded={showWorkspaceMenu} onClick={() => setShowWorkspaceMenu(value => !value)} />
            {showWorkspaceMenu && <div className={styles.workspaceMenu} ref={workspaceMenuRef}>
              {(user?.name || index.user?.name) && <div className={styles.workspaceUser}><span>Signed in as</span><strong>{user?.name || index.user.name}</strong></div>}
              {owner && <button onClick={() => { workspaceTriggerRef.current?.focus(); setShowWorkspaceMenu(false); setShowSettings(true) }}><Icon name="settings" size={17}/>Settings</button>}
              <button disabled={loggingOut} onClick={logout}><Icon name="logOut" size={17}/>Log out</button>
            </div>}
          </div>}
        </nav>
      </div>
    </header>
    <main className={styles.main} id="project-content">
      <section className={styles.hero} aria-labelledby="hub-title">
        <h1 id="hub-title">Gather your thoughts.<br/><span>Keep work moving.</span></h1>
      </section>
      {feedback && <div className={styles.feedback}><InlineAlert tone={feedback.tone}>{feedback.text}</InlineAlert><IconButton icon="close" label="Dismiss notification" onClick={() => setFeedback(null)} /></div>}
      {!index ? error ? <EmptyState icon="folder" title="Could not load projects" description="Check your connection and try again." action={<Button onClick={() => location.reload()}><Icon name="refresh" size={17} />Try again</Button>} /> : <div className={styles.loading} role="status" aria-label="Loading projects"><span className={styles.loadingLabel}>Loading projects…</span><div className={styles.grid}>{[0, 1, 2].map((i) => <div key={i} className={styles.skeletonCard}><span /><span /><span /></div>)}</div></div> : <>
        <h2 className="sr-only">Projects</h2>
        <ProjectToolbar query={query} onQueryChange={setQuery} status={status} onStatusChange={setStatus} />
        <div className={styles.resultsMeta} role="status">{filtered ? `${resultCount} ${resultCount === 1 ? 'project' : 'projects'}` : order.saving ? 'Saving project order…' : ''}</div>
        {projects.length > 0 ? <div className={styles.grid} role="list" aria-label="Project list">{projects.map((p) => <ProjectCard key={p.slug} project={p} tools={projectTools[p.slug]} owner={owner} position={order.list.findIndex((item) => item.slug === p.slug)} total={order.list.length} onMove={order.move} reload={reload} onFeedback={setFeedback} reorderEnabled={!filtered && !order.saving} orderSaving={order.saving} dragProps={owner && !filtered ? order.dragProps(p) : {}} dragging={order.drag === p.slug} dropTarget={order.over === p.slug && order.drag !== p.slug} />)}</div> : (!filtered || resultCount === 0) && <div className={styles.empty}><EmptyState icon={filtered ? 'search' : 'folder'} title={filtered ? 'No matching projects' : 'Start a new chapter'} description={filtered ? 'Try a different search or clear the status filter.' : owner ? 'Connect a folder of reports to bring your projects together.' : 'You do not have access to any projects yet. Ask an admin for an invitation.'} action={filtered ? <Button variant="secondary" onClick={clearFilters}>Clear search and filters</Button> : owner ? <Button variant="primary" onClick={() => setShowAdd(true)}><Icon name="plus" size={17} />Add project</Button> : null} /></div>}
        {demos.length > 0 && <section className={styles.demoSection} aria-labelledby="demo-title">
          {filtered ? <h2 id="demo-title" className={styles.demoToggle}>Demo projects</h2> : <button id="demo-title" className={styles.demoToggle} aria-expanded={demosExpanded} onClick={() => setShowDemos(value => !value)}>Demo projects<Icon name={demosExpanded ? 'chevronUp' : 'chevronDown'} size={16}/></button>}
          {demosExpanded && <><p className={styles.sectionDescription}>Sample projects to help you explore MOA.</p><div className={styles.grid} role="list" aria-label="Demo project list">{demos.map((p, position) => <ProjectCard key={p.slug} project={p} tools={projectTools[p.slug]} position={position} />)}</div></>}
        </section>}
      </>}
    </main>
    {owner && showSettings && <SettingsPanel index={index} reload={reload} onClose={() => setShowSettings(false)} />}
    {owner && showAdd && <AddProjectModal reload={reload} onClose={() => setShowAdd(false)} />}
  </div>
}
