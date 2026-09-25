'use client'

import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Brand, Icon, IconButton, Input, StatusBadge } from '../../components/ui/index.jsx'
import { InviteButton } from './DocumentActions.jsx'
import styles from './reader.module.css'

export const sortOptions = [
  { value: 'order', label: 'Default order' },
  { value: 'name', label: 'By name' },
  { value: 'recent', label: 'Last updated' },
]

const REVEAL_MARGIN = 24

// Scrolls the document list the shortest distance that brings `element` into view, keeping a small
// margin from the edges. A block taller than the list is aligned to the top so its start is visible.
function revealInList(nav, element, smooth = false) {
  if (!nav || !element || nav.scrollHeight <= nav.clientHeight) return
  const list = nav.getBoundingClientRect()
  const rect = element.getBoundingClientRect()
  const above = rect.top - (list.top + REVEAL_MARGIN)
  const below = rect.bottom - (list.bottom - REVEAL_MARGIN)
  const delta = above < 0 ? above : below > 0 ? Math.min(below, above) : 0
  if (!delta) return
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  nav.scrollTo({ top: nav.scrollTop + delta, behavior: smooth && !reduceMotion ? 'smooth' : 'auto' })
}

const leadingNumbers = (name) => {
  const match = /^\s*(\d+(?:[.-]\d+)*)/.exec(name)
  return match ? match[1].split(/[.-]/).map(Number) : null
}

// Numbered names sort by their numbers ("106" before "106-1", both before "110") and come first;
// the rest follow alphabetically.
function compareNames(a, b) {
  const x = leadingNumbers(a)
  const y = leadingNumbers(b)
  if (x && y) {
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const difference = (x[i] ?? -1) - (y[i] ?? -1)
      if (difference) return difference
    }
  } else if (x || y) return x ? -1 : 1
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

const updatedAt = (group) => Math.max(...group.items.map((entry) => entry.mtime || Date.parse(entry.date || '') || 0))

// Documents outside any group stay on top; only the groups themselves are reordered.
function sortGroups(groups, sort) {
  if (sort !== 'name' && sort !== 'recent') return groups
  const loose = groups.filter((group) => group.name === '')
  const named = groups.filter((group) => group.name !== '')
  named.sort(sort === 'name' ? (a, b) => compareNames(a.name, b.name) : (a, b) => updatedAt(b) - updatedAt(a))
  return [...loose, ...named]
}

export default function DocumentNavigation({ project, projects, doc, authed, owner, collapsed, onToggle, sort = 'order', onSort, onNavigate, onCollapse, collapseButtonRef, mobile = false }) {
  const [query, setQuery] = useState('')
  const navRef = useRef(null)
  const openedGroup = useRef(null)
  const appliedSort = useRef(sort)
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
    return sortGroups(result, sort)
  }, [project.docs, query, sort])
  const sortable = useMemo(() => new Set(project.docs.map((entry) => entry.group).filter(Boolean)).size > 1, [project.docs])

  // Bring the current document into view when the reader lands on it or clears a search. This must
  // not re-run when a group is toggled: the reader opened that group to look at its pages, and
  // pulling the list back to the current document (often the first entry) would throw that away.
  useEffect(() => {
    const nav = navRef.current
    revealInList(nav, nav?.querySelector('[aria-current="page"]'))
  }, [doc?.slug, query])

  // A group that just opened scrolls only as far as needed for its pages to show. Without this, a
  // group near the end of the list unfolds below the fold and looks as if nothing happened.
  useEffect(() => {
    const element = openedGroup.current
    openedGroup.current = null
    if (element?.isConnected) revealInList(navRef.current, element, true)
  }, [collapsed])

  // A new order is read from the top, so the list starts there (not on first render).
  useEffect(() => {
    if (appliedSort.current === sort) return
    appliedSort.current = sort
    navRef.current?.scrollTo({ top: 0 })
  }, [sort])

  const toggleGroup = (event, name) => {
    if (!query && collapsed.has(name)) openedGroup.current = event.currentTarget.parentElement
    onToggle(name)
  }

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
        {onCollapse && <IconButton ref={collapseButtonRef} icon="panelLeftClose" label="Hide sidebar" onClick={onCollapse} />}
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
      <div className={styles.navigationHead}>
        <span className={styles.navigationLabel}>Documents</span>
        {sortable && <div className={styles.sortControl}>
          <select aria-label="Sort document groups" value={sort} onChange={(event) => onSort?.(event.target.value)}>
            {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <Icon name="chevronDown" size={14} />
        </div>}
      </div>
      <nav className={styles.documentNavigation} ref={navRef} aria-label="Project documents">
        {groups.length === 0 && <p className={styles.navigationEmpty}>{query ? 'No matching documents.' : 'No documents yet.'}</p>}
        {groups.map((group, index) => group.name === '' ? group.items.map(documentLink) : (
          <div className={styles.documentGroup} key={group.name}>
            <button className={styles.groupToggle} onClick={(event) => toggleGroup(event, group.name)}
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
