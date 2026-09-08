'use client'

import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Brand, Icon, Input, StatusBadge } from '../../components/ui/index.jsx'
import { InviteButton } from './DocumentActions.jsx'
import styles from './reader.module.css'

export default function DocumentNavigation({ project, projects, doc, authed, owner, collapsed, onToggle, onNavigate, mobile = false }) {
  const [query, setQuery] = useState('')
  const navRef = useRef(null)
  const id = useId()
  const groups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    const result = []
    for (const entry of project.docs) {
      if (normalized && !`${entry.title} ${entry.group || ''}`.toLocaleLowerCase().includes(normalized)) continue
      const name = entry.group || ''
      let group = result.find((item) => item.name === name)
      if (!group) result.push((group = { name, items: [] }))
      group.items.push(entry)
    }
    return result
  }, [project.docs, query])

  useEffect(() => {
    const nav = navRef.current
    const active = nav?.querySelector('[aria-current="page"]')
    if (!nav || !active || nav.scrollHeight <= nav.clientHeight) return
    const itemRect = active.getBoundingClientRect()
    const navRect = nav.getBoundingClientRect()
    if (itemRect.top < navRect.top + 24) nav.scrollTop -= navRect.top + 24 - itemRect.top
    else if (itemRect.bottom > navRect.bottom - 24) nav.scrollTop += itemRect.bottom - navRect.bottom + 24
  }, [doc?.slug, collapsed, query])

  const documentLink = (entry) => (
    <a key={entry.slug} href={`/p/${encodeURIComponent(project.slug)}/${encodeURIComponent(entry.slug)}`}
      className={`${styles.documentLink} ${entry.slug === doc?.slug ? styles.currentDocument : ''}`}
      aria-current={entry.slug === doc?.slug ? 'page' : undefined} onClick={onNavigate}>
      <Icon name="file" size={16} />
      <span>{entry.title}</span>
    </a>
  )

  return (
    <div className={`${styles.navigation} ${mobile ? styles.mobileNavigation : ''}`}>
      {!mobile && <div className={styles.brandRow}>
        {authed ? <a href="/" className={styles.brandLink} aria-label="MOA project home"><Brand /></a> : <Brand />}
      </div>}
      <div className={styles.projectBlock}>
        <div className={styles.projectEyebrow}>{authed ? 'Current project' : 'Shared document'}</div>
        {authed ? <div className={styles.projectSelectWrap}>
          <label className={styles.visuallyHidden} htmlFor={`${id}-project`}>Switch project</label>
          <select id={`${id}-project`} value={project.slug} className={styles.projectSelect}
            onChange={(event) => { window.location.assign(`/p/${encodeURIComponent(event.target.value)}`) }}>
            {projects.map((entry) => <option key={entry.slug} value={entry.slug}>{entry.title}</option>)}
          </select>
          <Icon name="chevronDown" size={16} />
        </div> : <div className={styles.guestProjectTitle}>{project.title}</div>}
        <div className={styles.projectMeta}>
          <span>{project.docs.length} documents</span>
          {project.demo && <StatusBadge tone="neutral">Demo</StatusBadge>}
        </div>
        {owner && <details className={styles.projectMenu}>
          <summary><Icon name="settings" size={14} />Manage project<Icon name="chevronDown" size={14} /></summary>
          <div className={styles.projectMenuBody}>
            <InviteButton slug={project.slug} />
            <p>Invited team members can view this project.</p>
            <a href="/">Manage projects in the hub<Icon name="openExternal" size={14} /></a>
          </div>
        </details>}
      </div>
      {(project.docs.length > 5 || query) && <div className={styles.navigationSearch}>
        <Icon name="search" size={16} />
        <Input aria-label="Search documents" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search documents" />
        {query && <button className={styles.clearSearch} aria-label="Clear document search" onClick={() => setQuery('')}><Icon name="x" size={14} /></button>}
      </div>}
      <nav className={styles.documentNavigation} ref={navRef} aria-label="Project documents">
        <div className={styles.navigationLabel}>Documents</div>
        {groups.length === 0 && <p className={styles.navigationEmpty}>{query ? 'No matching documents.' : 'No documents yet.'}</p>}
        {groups.map((group, index) => group.name === '' ? group.items.map(documentLink) : (
          <div className={styles.documentGroup} key={group.name}>
            <button className={styles.groupToggle} onClick={() => onToggle(group.name)}
              aria-expanded={query ? true : !collapsed.has(group.name)} aria-controls={`${id}-group-${index}`}>
              <span className={`${styles.groupCaret} ${query || !collapsed.has(group.name) ? styles.groupExpanded : ''}`}><Icon name="chevronRight" size={14} /></span>
              <span className={styles.groupName}>{group.name}</span>
              <span className={styles.groupCount}>{group.items.length}</span>
            </button>
            {(query || !collapsed.has(group.name)) && <div id={`${id}-group-${index}`} className={styles.groupItems}>
              {group.items.map(documentLink)}
            </div>}
          </div>
        ))}
      </nav>
      <div className={styles.navigationFooter}>
        {authed ? <a href="/"><Icon name="arrowLeft" size={16} />All projects</a> : <span><Icon name="lock" size={14} />Only this document is shared</span>}
      </div>
    </div>
  )
}
