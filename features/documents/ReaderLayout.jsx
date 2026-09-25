'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useIndex, useWatch } from '../../lib/client-store.js'
import { Brand, Button, Drawer, EmptyState, Icon, IconButton, InlineAlert, StatusBadge } from '../../components/ui/index.jsx'
import DocRenderer from '../../components/doc-renderer.jsx'
import ChatPanel from '../chat/ChatPanel.jsx'
import DocumentNavigation, { sortOptions } from './DocumentNavigation.jsx'
import DocumentOutline from './DocumentOutline.jsx'
import ViewMenu from './ViewMenu.jsx'
import { ShareButton } from './DocumentActions.jsx'
import { useReaderView } from './use-reader-view.js'
import styles from './reader.module.css'

function useClaudeInfo(enabled) {
  const [info, setInfo] = useState(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    fetch('/api/claude').then((response) => response.json()).then((data) => { if (alive) setInfo(data) }).catch(() => {})
    return () => { alive = false }
  }, [enabled])
  return info || {}
}

function useWideChat() {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1280px)')
    const update = () => setWide(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return wide
}

export default function ReaderLayout({ slug, docSlug }) {
  const { data: index, error, reload } = useIndex()
  const owner = !!index?.owner
  const authed = owner || !!index?.member
  const [docVersion, setDocVersion] = useState(0)
  useWatch(slug, authed, () => { reload(); setDocVersion((version) => version + 1) })
  const claude = useClaudeInfo(owner)
  const project = index?.projects?.find((entry) => entry.slug === slug)
  const doc = project && (docSlug ? project.docs.find((entry) => entry.slug === docSlug) : project.docs[0])
  const cinfo = owner ? claude[slug] : null
  const [chat, setChat] = useState(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(new Set())
  const [sort, setSort] = useState('order')
  const [view, toggleView] = useReaderView()
  const articleRef = useRef(null)
  const chatTriggerRef = useRef(null)
  const hideSidebarRef = useRef(null)
  const showSidebarRef = useRef(null)
  const hideOutlineRef = useRef(null)
  const showOutlineRef = useRef(null)
  const wideChat = useWideChat()

  useEffect(() => {
    try { setCollapsed(new Set(JSON.parse(localStorage.getItem(`hub.collapsed.${slug}`) || '[]'))) }
    catch { setCollapsed(new Set()) }
    let stored = null
    try { stored = localStorage.getItem(`hub.sort.${slug}`) } catch {}
    setSort(sortOptions.some((option) => option.value === stored) ? stored : 'order')
  }, [slug])

  const toggleGroup = (name) => setCollapsed((previous) => {
    const next = new Set(previous)
    next.has(name) ? next.delete(name) : next.add(name)
    try { localStorage.setItem(`hub.collapsed.${slug}`, JSON.stringify([...next])) } catch {}
    return next
  })

  const changeSort = (next) => {
    setSort(next)
    try { localStorage.setItem(`hub.sort.${slug}`, next) } catch {}
  }

  // Collapsing a panel removes the button that did it, so focus moves to the control that brings it back.
  const togglePanel = (key, counterpart) => {
    toggleView(key)
    requestAnimationFrame(() => counterpart.current?.focus({ preventScroll: true }))
  }

  useEffect(() => {
    // A refresh of the current document does not reset reading position.
    if (!window.location.hash) window.scrollTo(0, 0)
    setNavigationOpen(false)
  }, [slug, doc?.slug])

  useEffect(() => {
    if (!project) return
    const group = doc?.group || ''
    const tag = group && (group.match(/^\s*([^:]{1,12}):/) || [])[1]
    const short = (tag || group).trim().slice(0, 20)
    document.title = [short, doc?.title, project.title, 'MOA'].filter(Boolean).join(' · ')
  }, [project, doc])

  if (error && !index) return <div className={styles.statusPage}>
    <Brand /><InlineAlert tone="danger" title="Could not load projects">{error}</InlineAlert>
    <Button onClick={reload} variant="secondary"><Icon name="refresh" size={16} />Reload</Button>
  </div>
  if (!index) return <div className={styles.loadingPage} aria-busy="true" aria-label="Loading projects">
    <Brand /><div className={styles.skeletonTitle} /><div className={styles.skeletonLine} /><div className={styles.skeletonLine} />
    <p role="status">Loading your projects.</p>
  </div>
  if (!project) return <div className={styles.statusPage}>
    <Brand /><EmptyState icon="folder" title="Project not found" description="The address may have changed, or you may not have access."
      action={authed ? <a className={styles.returnLink} href="/">Back to projects<Icon name="arrowRight" size={16} /></a> : undefined} />
  </div>

  const hidden = new Set(index.hidden || [])
  const projects = (index.projects || []).filter((entry) => entry.slug === slug || !hidden.has(entry.slug))
  const navigationProps = { project, projects, doc, authed, owner, collapsed, onToggle: toggleGroup, sort, onSort: changeSort }
  const chatEnabled = !!(chat && cinfo && owner)
  const chatVisible = chatEnabled && chatOpen
  const closeChat = () => {
    setChatOpen(false)
    if (wideChat) requestAnimationFrame(() => chatTriggerRef.current?.focus({ preventScroll: true }))
  }
  const sidebarShown = authed && view.sidebar

  return <div className={`${styles.shell} ${authed ? '' : styles.guestShell} ${authed && !view.sidebar ? styles.sidebarHidden : ''} ${chatVisible && wideChat ? styles.withChat : ''}`}>
    <a href="#document-content" className={styles.skipLink}>Skip to content</a>
    {sidebarShown && <aside className={styles.sidebar}>
      <DocumentNavigation {...navigationProps} onCollapse={() => togglePanel('sidebar', showSidebarRef)} collapseButtonRef={hideSidebarRef} />
    </aside>}
    <div className={styles.readingArea}>
      <header className={styles.readerHeader}>
        <div className={styles.headerContext}>
          {authed ? <>
            <div className={styles.mobileMenu}><IconButton icon="menu" label="Open document navigation" onClick={() => setNavigationOpen(true)} /></div>
            {!view.sidebar && <div className={styles.sidebarExpand}>
              <IconButton ref={showSidebarRef} icon="panelLeft" label="Show sidebar" onClick={() => togglePanel('sidebar', hideSidebarRef)} />
              <a href="/" className={styles.headerBrand} aria-label="MOA project home"><Brand compact /></a>
            </div>}
          </> : <Brand compact />}
          <nav className={styles.breadcrumb} aria-label="Breadcrumb">
            <span>{project.title}</span>
            {doc && <><Icon name="chevronRight" size={14} /><span className={styles.breadcrumbCurrent}>{doc.title}</span></>}
          </nav>
        </div>
        <div className={styles.headerActions}>
          {!authed && <StatusBadge tone="neutral">Shared document</StatusBadge>}
          {doc && !view.outline && <div className={styles.outlineShow}>
            <IconButton ref={showOutlineRef} icon="panelRight" label="Show outline" size="sm" onClick={() => togglePanel('outline', hideOutlineRef)} />
          </div>}
          {owner && doc && <ShareButton slug={slug} doc={doc.slug} />}
          {cinfo && <Button ref={chatTriggerRef} variant={chatVisible ? 'secondary' : 'ghost'} size="sm" aria-expanded={chatVisible} aria-label={chatVisible ? 'Close AI assistant' : 'Open AI assistant'}
            onClick={() => { setChat((current) => current || { seed: null }); setChatOpen((current) => !current) }}>
            <Icon name="sparkles" size={16} /><span className={styles.aiLabel}>AI assistant</span>
          </Button>}
          <ViewMenu view={view} onToggle={toggleView} />
        </div>
      </header>
      {error && <div className={styles.refreshError}><InlineAlert tone="warning" title="Could not refresh this document">
        You can continue reading the current version. <button onClick={reload}>Check again</button>
      </InlineAlert></div>}
      <div className={`${styles.documentLayout} ${chatVisible || !view.outline ? styles.outlineHidden : ''} ${view.fullWidth ? styles.fullWidth : ''}`}>
        <main className={styles.documentMain} id="document-content" tabIndex={-1}>
          {doc ? <>
            <div className={styles.documentMeta}>
              {doc.group && <span>{doc.group}</span>}
              {doc.date && <time dateTime={doc.date}>{doc.date.replaceAll('-', '. ')}</time>}
              {project.demo && <StatusBadge tone="neutral">Sample document</StatusBadge>}
            </div>
            <article ref={articleRef} className={`page moa-prose ${styles.article} ${view.smallText ? styles.smallText : ''}`}>
              <DocRenderer slug={slug} doc={doc.slug} version={docVersion} />
            </article>
            <footer className={styles.documentFooter}>
              <span><Brand compact />All your work, in one place</span>
              <a href="#document-content">Back to top<Icon name="arrowUp" size={14} /></a>
            </footer>
          </> : docSlug ? <EmptyState icon="file" title="Document not found"
            description="This document may have moved. Choose another from the document list." />
            : <EmptyState icon="file" title="Ready for your first document"
              description="Add a report to this project to read it here." />}
        </main>
        {doc && <DocumentOutline articleRef={articleRef} documentKey={`${slug}/${doc.slug}`} version={docVersion}
          onHide={() => togglePanel('outline', showOutlineRef)} hideButtonRef={hideOutlineRef} />}
      </div>
    </div>
    {authed && <Drawer open={navigationOpen} onClose={() => setNavigationOpen(false)} title="Document navigation" side="left" className={styles.navigationDrawer}>
      <DocumentNavigation {...navigationProps} mobile onNavigate={() => setNavigationOpen(false)} />
    </Drawer>}
    {chatEnabled && <ChatPanel key={slug} project={project} tools={cinfo} seed={chat.seed} onClose={closeChat} compactHeader={!wideChat} visible={chatVisible}
      renderPanel={(content) => wideChat ? <div className={styles.chatColumn} hidden={!chatVisible}>{content}</div>
        : <Drawer open={chatVisible} onClose={closeChat} title="AI assistant" description={project.title} side="right" className={styles.chatDrawer}>{content}</Drawer>} />}
  </div>
}
