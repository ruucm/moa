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
const SCROLL_EDGE = 40

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

// Numbered titles sort by their numbers ("106" before "106-1", both before "110") and come first;
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

const updatedAt = (entry) => entry.mtime || Date.parse(entry.date || '') || 0

// Groups follow the order an admin dragged into place (`saved`): saved groups first, as saved, then
// the rest by their order meta, with documents outside any group on top. The sort menu never moves them.
function arrangeGroups(groups, saved = []) {
  if (!saved.length) return groups
  const rank = (group) => { const index = saved.indexOf(group.name); return index < 0 ? saved.length : index }
  const loose = groups.filter((group) => group.name === '')
  const named = groups.filter((group) => group.name !== '')
  named.sort((a, b) => rank(a) - rank(b))
  return [...loose, ...named]
}

// The sort menu orders the pages inside each group: by order meta, by title, or newest first.
function sortPages(items, sort) {
  if (sort === 'name') return [...items].sort((a, b) => compareNames(a.title, b.title))
  if (sort === 'recent') return [...items].sort((a, b) => updatedAt(b) - updatedAt(a))
  return items
}

export default function DocumentNavigation({ project, projects, doc, authed, owner, collapsed, onToggle, sort = 'order', onSort, onReorder, onNavigate, onCollapse, collapseButtonRef, mobile = false }) {
  const [query, setQuery] = useState('')
  const [dragging, setDragging] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [pendingOrder, setPendingOrder] = useState(null)
  const [orderError, setOrderError] = useState('')
  const navRef = useRef(null)
  const openedGroup = useRef(null)
  const appliedSort = useRef(sort)
  const movedGroup = useRef(null)
  const id = useId()
  const savedOrder = project.groupOrder
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
    // A moved group shows in its new place at once, while the order is being saved.
    const order = pendingOrder || (Array.isArray(savedOrder) ? savedOrder : [])
    return arrangeGroups(result, order).map((group) => ({ ...group, items: sortPages(group.items, sort) }))
  }, [project.docs, savedOrder, pendingOrder, query, sort])
  // The page sort only shows where some group (or the ungrouped list) has more than one page.
  const sortable = useMemo(() => {
    const counts = new Map()
    for (const entry of project.docs) counts.set(entry.group || '', (counts.get(entry.group || '') || 0) + 1)
    return [...counts.values()].some((count) => count > 1)
  }, [project.docs])
  const named = groups.filter((group) => group.name !== '')
  const reorderable = owner && !query && named.length > 1

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

  // A group moved from the keyboard keeps focus: moving its element in the list can drop focus.
  useEffect(() => {
    const name = movedGroup.current
    movedGroup.current = null
    if (!name) return
    const group = [...(navRef.current?.querySelectorAll('[data-group]') || [])].find((element) => element.dataset.group === name)
    const toggle = group?.querySelector('button')
    if (toggle && document.activeElement !== toggle) toggle.focus()
  }, [groups])

  // While a group is dragged, holding the pointer near the top or bottom edge of the list scrolls it,
  // so a group can travel the whole list in one drag.
  useEffect(() => {
    if (!dragging) return
    let pointer = null
    let frame = 0
    const track = (event) => { pointer = event.clientY }
    const step = () => {
      const nav = navRef.current
      if (nav && pointer !== null) {
        const { top, bottom } = nav.getBoundingClientRect()
        if (Math.abs(pointer - top) < SCROLL_EDGE) nav.scrollTop -= Math.ceil((top + SCROLL_EDGE - pointer) / 4)
        else if (Math.abs(pointer - bottom) < SCROLL_EDGE) nav.scrollTop += Math.ceil((pointer - bottom + SCROLL_EDGE) / 4)
      }
      frame = requestAnimationFrame(step)
    }
    window.addEventListener('dragenter', track)
    window.addEventListener('dragover', track)
    frame = requestAnimationFrame(step)
    return () => {
      window.removeEventListener('dragenter', track)
      window.removeEventListener('dragover', track)
      cancelAnimationFrame(frame)
    }
  }, [dragging])

  const toggleGroup = (event, name) => {
    if (!query && collapsed.has(name)) openedGroup.current = event.currentTarget.parentElement
    onToggle(name)
  }

  // Saves the groups in their on-screen order with `name` moved to `target`, as the project's group
  // order for everyone. The move shows at once and is undone if the save fails.
  const moveGroup = async (name, target) => {
    const names = named.map((group) => group.name)
    const from = names.indexOf(name)
    if (pendingOrder || from < 0 || target < 0 || target >= names.length || from === target) return
    names.splice(target, 0, names.splice(from, 1)[0])
    setOrderError('')
    setPendingOrder(names)
    try {
      const response = await fetch('/api/order/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: project.slug, groups: names }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.error) throw new Error(data.error || 'Could not save the group order.')
      await onReorder?.()
    } catch (error) {
      setOrderError(error.message || 'Could not save the group order. Please try again.')
    } finally {
      setPendingOrder(null)
    }
  }

  const endDrag = () => { setDragging(null); setDropTarget(null) }
  const groupAt = (event) => event.target.closest?.('[data-group]')?.dataset.group
  // The whole list takes the drop, gaps between groups included: the dragged group lands in the place
  // of the group under the pointer, or of the last one it crossed.
  const dragOverList = (event) => {
    if (!dragging) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const name = groupAt(event)
    if (name) setDropTarget(name)
  }
  const listDragHandlers = {
    onDragEnter: dragOverList,
    onDragOver: dragOverList,
    onDrop: (event) => {
      if (!dragging) return
      event.preventDefault()
      const name = groupAt(event) || dropTarget
      if (name) moveGroup(dragging, named.findIndex((group) => group.name === name))
      endDrag()
    },
  }
  const toggleHandlers = (name) => reorderable ? {
    draggable: !pendingOrder,
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', name)
      setDragging(name)
    },
    onDragEnd: endDrag,
    onKeyDown: (event) => {
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
      event.preventDefault()
      const target = named.findIndex((group) => group.name === name) + (event.key === 'ArrowUp' ? -1 : 1)
      if (pendingOrder || target < 0 || target >= named.length) return
      movedGroup.current = name
      moveGroup(name, target)
    },
    'aria-keyshortcuts': 'Alt+ArrowUp Alt+ArrowDown',
    'aria-describedby': `${id}-reorder`,
  } : {}
  // The line shows where the dragged group lands: it takes the place of the group under the pointer.
  const dropMarker = (name) => {
    if (!dragging || dragging === name || dropTarget !== name) return ''
    const index = (group) => named.findIndex((entry) => entry.name === group)
    return index(name) < index(dragging) ? styles.dropBefore : styles.dropAfter
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
          <select aria-label="Sort pages in each group" value={sort} onChange={(event) => onSort?.(event.target.value)}>
            {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <Icon name="chevronDown" size={14} />
        </div>}
      </div>
      {reorderable && <p id={`${id}-reorder`} className={styles.visuallyHidden}>Drag a group, or press Alt with the up or down arrow, to change the group order for everyone.</p>}
      {orderError && <p className={styles.navigationError} role="alert">{orderError}</p>}
      <nav className={styles.documentNavigation} ref={navRef} aria-label="Project documents" {...listDragHandlers}>
        {groups.length === 0 && <p className={styles.navigationEmpty}>{query ? 'No matching documents.' : 'No documents yet.'}</p>}
        {groups.map((group, index) => group.name === '' ? group.items.map(documentLink) : (
          <div className={`${styles.documentGroup} ${dragging === group.name ? styles.draggingGroup : ''} ${dropMarker(group.name)}`} key={group.name} data-group={group.name}>
            <button className={styles.groupToggle} onClick={(event) => toggleGroup(event, group.name)} {...toggleHandlers(group.name)}
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
