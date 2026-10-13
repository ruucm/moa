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

// Pinned groups (`pins`, the latest pin first) leave that order and lead the list, above the documents
// outside any group. `named` keeps every group in its own place, where an unpinned group goes back to.
function splitPinned(groups, pins = []) {
  const named = groups.filter((group) => group.name !== '')
  return {
    named,
    pinned: [...new Set(pins)].map((name) => named.find((group) => group.name === name)).filter(Boolean),
    loose: groups.find((group) => group.name === '')?.items || [],
    rest: named.filter((group) => !pins.includes(group.name)),
  }
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
  const [pending, setPending] = useState(null)
  const [orderError, setOrderError] = useState('')
  const navRef = useRef(null)
  const openedGroup = useRef(null)
  const appliedSort = useRef(sort)
  const movedGroup = useRef(null)
  const unsent = useRef(null)
  const id = useId()
  const savedOrder = project.groupOrder
  const savedPins = project.groupPins
  const list = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    const result = []
    for (const entry of project.docs) {
      if (normalized && !`${entry.title} ${entry.group || ''}`.toLocaleLowerCase().includes(normalized)) continue
      const name = entry.group || ''
      let group = result.find((item) => item.name === name)
      if (!group) result.push((group = { name, items: [] }))
      group.items.push(entry)
    }
    // A moved or pinned group shows in its new place at once, while the change is being saved.
    const order = pending?.groups || (Array.isArray(savedOrder) ? savedOrder : [])
    const pins = pending?.pins || (Array.isArray(savedPins) ? savedPins : [])
    return splitPinned(arrangeGroups(result, order).map((group) => ({ ...group, items: sortPages(group.items, sort) })), pins)
  }, [project.docs, savedOrder, savedPins, pending, query, sort])
  // The page sort only shows where some group (or the ungrouped list) has more than one page.
  const sortable = useMemo(() => {
    const counts = new Map()
    for (const entry of project.docs) counts.set(entry.group || '', (counts.get(entry.group || '') || 0) + 1)
    return [...counts.values()].some((count) => count > 1)
  }, [project.docs])
  // A group moves among the groups of its own section: the pinned ones, or the rest.
  const pinnedNames = list.pinned.map((group) => group.name)
  const restNames = list.rest.map((group) => group.name)
  const sectionOf = (name) => pinnedNames.includes(name) ? pinnedNames : restNames
  const reorderable = (name) => owner && !query && sectionOf(name).length > 1

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

  // A group moved or pinned from the keyboard keeps focus, on the control that did it: moving its
  // element in the list can drop focus.
  useEffect(() => {
    const moved = movedGroup.current
    movedGroup.current = null
    if (!moved) return
    const group = [...(navRef.current?.querySelectorAll('[data-group]') || [])].find((element) => element.dataset.group === moved.name)
    const control = group?.querySelector(`.${moved.pin ? styles.groupPin : styles.groupToggle}`)
    if (control && document.activeElement !== control) control.focus()
  }, [list])

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
    if (!query && collapsed.has(name)) openedGroup.current = event.currentTarget.closest('[data-group]')
    onToggle(name)
  }

  // Saves the project's group order (`groups`) or its pinned groups (`pins`) for everyone. The change
  // shows at once and is undone if the save fails. A change made while another is being saved is sent
  // after it; a list is sent whole, so only its latest state goes out. `focus` names the group whose
  // control keeps focus.
  const save = async (kind, names, focus) => {
    movedGroup.current = focus
    setOrderError('')
    setPending((current) => ({ ...current, [kind]: names }))
    if (unsent.current) { unsent.current[kind] = names; return }
    unsent.current = { [kind]: names }
    let failed = ''
    for (let next; !failed && (next = Object.keys(unsent.current)[0]);) {
      const groups = unsent.current[next]
      delete unsent.current[next]
      try {
        const response = await fetch(`/api/order/${next}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: project.slug, groups }) })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || data.error) throw new Error(data.error || (next === 'pins' ? 'Could not save the pinned groups.' : 'Could not save the group order.'))
      } catch (error) {
        failed = error.message || 'Could not save the change. Please try again.'
      }
      // The saved lists are read back once nothing more waits to be sent, or a save has failed.
      if (failed || !Object.keys(unsent.current).length) await onReorder?.()
    }
    unsent.current = null
    if (failed) setOrderError(failed)
    setPending(null)
  }

  // Moves `name` to `target` among the groups of its section, as they are on screen. Pinned groups
  // save as the new pins. The rest save as the group order, where each pinned group keeps its own
  // place, so unpinning puts it back there.
  const moveGroup = (name, target, focus) => {
    const section = sectionOf(name)
    const from = section.indexOf(name)
    if (from < 0 || target < 0 || target >= section.length || from === target) return
    const moved = [...section]
    moved.splice(target, 0, moved.splice(from, 1)[0])
    if (section === pinnedNames) save('pins', moved, focus)
    else save('groups', list.named.map((group) => pinnedNames.includes(group.name) ? group.name : moved.shift()), focus)
  }

  // Pins a group to the top of the list for everyone, above the earlier pins, or unpins it. Worked
  // from the keyboard, the pin keeps focus where the group lands; a click leaves the list where it is.
  const togglePin = (event, name) => {
    // The group leaves the pointer and another takes its place: a double click must not act on that one.
    if (event.detail > 1) return
    const pins = pending?.pins || (Array.isArray(savedPins) ? savedPins : [])
    save('pins', pins.includes(name) ? pins.filter((entry) => entry !== name) : [name, ...pins], event.detail === 0 ? { name, pin: true } : null)
  }

  const endDrag = () => { setDragging(null); setDropTarget(null) }
  const groupAt = (event) => event.target.closest?.('[data-group]')?.dataset.group
  // The whole list takes the drop, gaps between groups included: the dragged group lands in the place
  // of the group under the pointer, or of the last one it crossed. It stays in its own section, so
  // over the other one the last place it crossed still takes the drop.
  const sameSection = (name) => !!name && sectionOf(name) === sectionOf(dragging)
  const dragOverList = (event) => {
    if (!dragging) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const name = groupAt(event)
    if (sameSection(name)) setDropTarget(name)
  }
  const listDragHandlers = {
    onDragEnter: dragOverList,
    onDragOver: dragOverList,
    onDrop: (event) => {
      if (!dragging) return
      event.preventDefault()
      const name = [groupAt(event), dropTarget].find(sameSection)
      if (name) moveGroup(dragging, sectionOf(name).indexOf(name))
      endDrag()
    },
  }
  const toggleHandlers = (name) => reorderable(name) ? {
    draggable: true,
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', name)
      setDragging(name)
    },
    onDragEnd: endDrag,
    onKeyDown: (event) => {
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
      event.preventDefault()
      moveGroup(name, sectionOf(name).indexOf(name) + (event.key === 'ArrowUp' ? -1 : 1), { name })
    },
    'aria-keyshortcuts': 'Alt+ArrowUp Alt+ArrowDown',
    'aria-describedby': `${id}-reorder`,
  } : {}
  // The line shows where the dragged group lands: it takes the place of the group under the pointer.
  const dropMarker = (name) => {
    if (!dragging || dragging === name || dropTarget !== name) return ''
    const section = sectionOf(name)
    return section.indexOf(name) < section.indexOf(dragging) ? styles.dropBefore : styles.dropAfter
  }

  const documentLink = (entry) => (
    <a key={entry.slug} href={`/p/${encodeURIComponent(project.slug)}/${encodeURIComponent(entry.slug)}`}
      className={`${styles.documentLink} ${entry.slug === doc?.slug ? styles.currentDocument : ''}`}
      aria-current={entry.slug === doc?.slug ? 'page' : undefined} onClick={onNavigate}>
      <Icon name="file" size={16} />
      <span>{entry.title}</span>
    </a>
  )

  const groupBlock = (group) => {
    const open = !!query || !collapsed.has(group.name)
    const pinned = pinnedNames.includes(group.name)
    const items = `${id}-group-${list.named.indexOf(group)}`
    return (
      <div className={`${styles.documentGroup} ${dragging === group.name ? styles.draggingGroup : ''} ${dropMarker(group.name)}`} key={group.name} data-group={group.name}>
        <div className={`${styles.groupHead} ${pinned ? styles.pinnedHead : ''} ${owner ? styles.pinnableHead : ''}`}>
          <button className={styles.groupToggle} onClick={(event) => toggleGroup(event, group.name)} {...toggleHandlers(group.name)}
            aria-expanded={open} aria-controls={items}>
            <span className={`${styles.groupCaret} ${open ? styles.groupExpanded : ''}`}><Icon name="chevronRight" size={14} /></span>
            <span className={styles.groupName}>{group.name}</span>
            <span className={styles.groupCount}>{group.items.length}</span>
          </button>
          {owner ? <button className={styles.groupPin} onClick={(event) => togglePin(event, group.name)}
            aria-label={pinned ? `Unpin ${group.name}` : `Pin ${group.name} to the top`} title={pinned ? 'Unpin' : 'Pin to the top for everyone'}>
            <Icon name="pin" size={14} />
          </button> : pinned && <span className={styles.groupPin}><Icon name="pin" size={14} /></span>}
        </div>
        {open && <div id={items} className={styles.groupItems}>
          {group.items.map(documentLink)}
        </div>}
      </div>
    )
  }

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
      {owner && !query && (pinnedNames.length > 1 || restNames.length > 1) && <p id={`${id}-reorder`} className={styles.visuallyHidden}>Drag a group, or press Alt with the up or down arrow, to change the group order for everyone.</p>}
      {orderError && <p className={styles.navigationError} role="alert">{orderError}</p>}
      <nav className={styles.documentNavigation} ref={navRef} aria-label="Project documents" {...listDragHandlers}>
        {list.named.length + list.loose.length === 0 && <p className={styles.navigationEmpty}>{query ? 'No matching documents.' : 'No documents yet.'}</p>}
        {list.pinned.length > 0 && <div className={styles.pinnedGroups} role="group" aria-label="Pinned groups">{list.pinned.map(groupBlock)}</div>}
        {list.loose.map(documentLink)}
        {list.rest.map(groupBlock)}
      </nav>
      <div className={styles.navigationFooter}>
        {authed ? <a href="/"><Icon name="arrowLeft" size={16} />All projects</a> : <span><Icon name="lock" size={14} />Only this document is shared</span>}
      </div>
    </div>
  )
}
