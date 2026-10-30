'use client'

import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { Brand, Icon, IconButton, StatusBadge } from '../../components/ui/index.jsx'
import { InviteButton } from './DocumentActions.jsx'
import { SearchButton } from '../search/GlobalSearch.jsx'
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

// A page's link in the list: in its own group, or (`pinned`) in the Pinned group.
const findLink = (nav, slug, pinned) => [...(nav?.querySelectorAll('a[data-doc]') || [])]
  .find((link) => link.dataset.doc === slug && !!link.closest(`.${styles.pinnedGroup}`) === pinned)

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

// The Pinned group opens and closes with the others, under a name no document group can have.
const PINNED = '\u0000pinned'

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

// `onSearch` opens the search over every project (the sidebar's own filter box is gone: the search finds a page
// of this project as well as any other, see features/search/GlobalSearch.jsx).
export default function DocumentNavigation({ project, projects, doc, authed, owner, collapsed, onToggle, sort = 'order', onSort, onReorder, onNavigate, onSearch, onCollapse, collapseButtonRef, mobile = false }) {
  const [dragging, setDragging] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [pendingOrder, setPendingOrder] = useState(null)
  const [orderError, setOrderError] = useState('')
  // Pins and unpins not saved yet, as [slug, pinned], the latest last. They show at once.
  const [pendingPins, setPendingPins] = useState([])
  const pinSaves = useRef(Promise.resolve())
  // Renames and moves not saved yet, as { slug, title } or { slug, group }, the latest last. They show at once too.
  const [pendingPages, setPendingPages] = useState([])
  const pageSaves = useRef(Promise.resolve())
  // The page being dragged to another group, and the group it would join.
  const [draggedPage, setDraggedPage] = useState(null)
  const [pageTarget, setPageTarget] = useState(null)
  // The row whose title is being edited: { slug, pinned } (`pinned` for its row in the Pinned group).
  const [renaming, setRenaming] = useState(null)
  const renamingRef = useRef(null)
  const renameInput = useRef(null)
  const renamedRow = useRef(null)
  // The menu open on a page row — { entry, index, x, y }, `index` for the row in the Pinned group — from a right
  // click, a long press, or Shift+F10 on the link; the link gets focus back when the menu closes from the keyboard.
  const [menu, setMenu] = useState(null)
  const menuRef = useRef(null)
  const menuLink = useRef(null)
  const longPress = useRef(null)
  const movedPage = useRef(null)
  const navRef = useRef(null)
  const openedGroup = useRef(null)
  const appliedSort = useRef(sort)
  const movedGroup = useRef(null)
  const id = useId()
  const savedOrder = project.groupOrder
  const docs = useMemo(() => pendingPages.length
    ? project.docs.map((entry) => pendingPages.reduce((page, { slug, ...change }) => slug === entry.slug ? { ...page, ...change } : page, entry))
    : project.docs, [project.docs, pendingPages])
  const groups = useMemo(() => {
    const result = []
    for (const entry of docs) {
      const name = entry.group || ''
      let group = result.find((item) => item.name === name)
      if (!group) result.push((group = { name, items: [] }))
      group.items.push(entry)
    }
    // A moved group shows in its new place at once, while the order is being saved.
    const order = pendingOrder || (Array.isArray(savedOrder) ? savedOrder : [])
    return arrangeGroups(result, order).map((group) => ({ ...group, items: sortPages(group.items, sort) }))
  }, [docs, savedOrder, pendingOrder, sort])
  // The page sort only shows where some group (or the ungrouped list) has more than one page.
  const sortable = useMemo(() => {
    const counts = new Map()
    for (const entry of docs) counts.set(entry.group || '', (counts.get(entry.group || '') || 0) + 1)
    return [...counts.values()].some((count) => count > 1)
  }, [docs])
  const named = groups.filter((group) => group.name !== '')
  const reorderable = owner && named.length > 1
  // An admin renames pages and moves them into other groups (a demo project stays as it ships). A page can move
  // once there is a group it isn't in: a second group, or one group and pages outside any.
  const editable = owner && !project.demo
  const movable = editable && (named.length > 1 || (named.length === 1 && groups.length > 1))
  // Pinned pages, the latest pin first, as they will be once the pending changes are saved.
  const pinnedSlugs = useMemo(() => {
    const changed = new Map(pendingPins)
    const saved = (Array.isArray(project.pins) ? project.pins : []).filter((slug) => !changed.has(slug))
    return [...pendingPins.filter(([, pinned]) => pinned).map(([slug]) => slug).reverse(), ...saved]
  }, [project.pins, pendingPins])
  // The Pinned group lists them on top of the list, sorted like the pages of any group. Each page
  // also stays in its own group.
  const pinnedPages = useMemo(() => {
    const pages = pinnedSlugs.map((slug) => docs.find((entry) => entry.slug === slug)).filter(Boolean)
    return sortPages(pages, sort)
  }, [docs, pinnedSlugs, sort])
  const pinnedOpen = !collapsed.has(PINNED)

  // Bring the current document into view when the reader lands on it. This must not re-run when a
  // group is toggled: the reader opened that group to look at its pages, and pulling the list back
  // to the current document (often the first entry) would throw that away.
  useEffect(() => {
    const nav = navRef.current
    revealInList(nav, nav?.querySelector('[aria-current="page"]'))
  }, [doc?.slug])

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

  // A page moved into another group comes into view there, and focus follows it when it was moved from the
  // keyboard: the row is drawn anew in its new group.
  useEffect(() => {
    const moved = movedPage.current
    movedPage.current = null
    const link = moved && findLink(navRef.current, moved.slug, false)
    if (!link) return
    revealInList(navRef.current, link, true)
    if (moved.focus) link.focus()
  }, [groups, collapsed])

  // Focus goes back to a page's link once its title is no longer edited from the keyboard.
  useEffect(() => {
    const row = renamedRow.current
    if (renaming || !row) return
    renamedRow.current = null
    findLink(navRef.current, row.slug, row.pinned)?.focus()
  }, [renaming])

  // While a group or a page is dragged, holding the pointer near the top or bottom edge of the list scrolls it,
  // so it can travel the whole list in one drag.
  useEffect(() => {
    if (!dragging && !draggedPage) return
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
  }, [dragging, draggedPage])

  const toggleGroup = (event, name) => {
    if (collapsed.has(name)) openedGroup.current = event.currentTarget.parentElement
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

  // Pins a page for this reader, or unpins it. Changes are saved one after another, in the order they were
  // made, and each shows until it is saved — or is undone if the save fails.
  const togglePin = (event, entry, index) => {
    // Pinning a page adds a row on top and moves the list down a row, which puts the pin of the page
    // above under the pointer: the second click of a double click is not for that page.
    if (event.detail > 1) return
    const change = [entry.slug, !pinnedSlugs.includes(entry.slug)]
    setOrderError('')
    flushSync(() => setPendingPins((current) => [...current.filter(([slug]) => slug !== entry.slug), change]))
    // Unpinned from the keyboard in the Pinned group, the page leaves it with the pin that had focus:
    // focus moves to the pin now in its place, or into the list when the group is gone.
    if (event.detail === 0 && index !== undefined) {
      const pins = navRef.current?.querySelectorAll(`.${styles.pinnedGroup} .${styles.documentPin}`) || []
      ;(pins[Math.min(index, pins.length - 1)] || navRef.current?.querySelector('a, button'))?.focus()
    }
    pinSaves.current = pinSaves.current.then(async () => {
      try {
        const response = await fetch('/api/pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: project.slug, doc: entry.slug, pinned: change[1] }) })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || data.error) throw new Error(data.error || 'Could not save the pin.')
        await onReorder?.()
      } catch (error) {
        setOrderError(error.message || 'Could not save the pin. Please try again.')
      } finally {
        setPendingPins((current) => current.filter((item) => item !== change))
      }
    })
  }

  // Saves a rename or a move in the page's file, where the sidebar reads its title and group. Changes are saved one
  // after another, in the order they were made, and each shows until it is saved — or is undone if the save fails.
  const savePage = (change) => {
    setOrderError('')
    setPendingPages((current) => [...current, change])
    pageSaves.current = pageSaves.current.then(async () => {
      const { slug, ...fields } = change
      try {
        const response = await fetch('/api/doc/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: project.slug, doc: slug, ...fields }) })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || data.error) throw new Error(data.error || 'Could not save the page.')
        await onReorder?.()
      } catch (error) {
        setOrderError(error.message || 'Could not save the page. Please try again.')
      } finally {
        setPendingPages((current) => current.filter((item) => item !== change))
      }
    })
  }

  // Moves a page into the group `name`. A closed group opens, so the page is seen to arrive. `focus` takes keyboard
  // focus along to the page's new row; `reveal: false` leaves the list where it is (a move made in the Pinned group).
  const movePage = (entry, name, { focus = false, reveal = true } = {}) => {
    if (!entry || !name || (entry.group || '') === name) return
    if (collapsed.has(name)) onToggle(name)
    if (reveal) movedPage.current = { slug: entry.slug, focus }
    savePage({ slug: entry.slug, group: name })
  }

  const startRename = (entry, pinned) => {
    setOrderError('')
    renamingRef.current = { slug: entry.slug, pinned }
    setRenaming(renamingRef.current)
  }
  // Enter, or leaving the field, saves a changed title; Escape keeps the old one (`title` null). A field closed from
  // the keyboard gives focus back to the page's link. Only the first of these counts: Escape also takes the field
  // away, which may blur it.
  const endRename = (entry, title, fromKeyboard) => {
    const row = renamingRef.current
    if (row?.slug !== entry.slug) return
    renamingRef.current = null
    if (fromKeyboard) renamedRow.current = row
    setRenaming(null)
    const text = (title || '').replace(/\s+/g, ' ').trim()
    if (text && text !== entry.title) savePage({ slug: entry.slug, title: text })
  }

  // The page menu opens at the pointer, or by the link when it was opened from the keyboard.
  const openMenu = (event, entry, index) => {
    event.preventDefault?.()
    const link = event.currentTarget
    const rect = link.getBoundingClientRect()
    const atPointer = event.clientX || event.clientY
    menuLink.current = link
    setMenu({ entry, index, x: atPointer ? event.clientX : rect.left + 24, y: atPointer ? event.clientY : rect.bottom - 6 })
  }
  const closeMenu = (toLink) => {
    const link = menuLink.current
    menuLink.current = null
    setMenu(null)
    if (toLink && link?.isConnected) link.focus()
  }
  // The open menu sits at the pointer, inside the window, and its first item takes focus. A press elsewhere, a
  // scroll, or leaving the window closes it.
  useLayoutEffect(() => {
    const panel = menuRef.current
    if (!menu || !panel) return
    const { width, height } = panel.getBoundingClientRect()
    panel.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - width - 8))}px`
    panel.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - height - 8))}px`
    panel.querySelector('[role="menuitem"]')?.focus()
    const away = (event) => { if (!panel.contains(event.target)) closeMenu(false) }
    const close = () => closeMenu(false)
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      document.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])
  // The arrow keys move through the menu; Escape (or Tab) closes it and puts focus back on the link.
  const menuKeys = (event) => {
    const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]')]
    const go = (index) => { event.preventDefault(); items.at(index % items.length)?.focus() }
    const at = items.indexOf(document.activeElement)
    if (event.key === 'ArrowDown') go(at + 1)
    else if (event.key === 'ArrowUp') go(at - 1)
    else if (event.key === 'Home') go(0)
    else if (event.key === 'End') go(-1)
    else if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); closeMenu(true) }
  }
  // On a touch screen the menu opens on a long press (half a second, without moving); the tap that ends the press
  // does not open the page.
  const stopPress = () => { clearTimeout(longPress.current?.timer); if (longPress.current?.timer) longPress.current = null }
  const pressHandlers = (entry, index) => ({
    onPointerDown: (event) => {
      stopPress()
      longPress.current = null
      if (event.pointerType !== 'touch' || event.button !== 0) return
      const link = event.currentTarget
      const { clientX, clientY } = event
      longPress.current = { x: clientX, y: clientY, timer: setTimeout(() => {
        longPress.current = { fired: true }
        openMenu({ currentTarget: link, clientX, clientY }, entry, index)
      }, 500) }
    },
    onPointerMove: (event) => {
      const press = longPress.current
      if (press?.timer && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) stopPress()
    },
    onPointerUp: stopPress,
    onPointerCancel: stopPress,
  })
  const followLink = (event) => {
    if (longPress.current?.fired) {
      event.preventDefault()
      longPress.current = null
      return
    }
    onNavigate?.(event)
  }

  const endDrag = () => { setDragging(null); setDropTarget(null); setDraggedPage(null); setPageTarget(null) }
  const groupAt = (event) => event.target.closest?.('[data-group]')?.dataset.group
  // A dragged page joins the group under the pointer, unless that is its own group.
  const pageTargetAt = (event) => {
    const name = groupAt(event)
    const entry = docs.find((item) => item.slug === draggedPage)
    return name && entry && (entry.group || '') !== name ? name : null
  }
  // The whole list takes the drop, gaps between groups included: the dragged group lands in the place
  // of the group under the pointer, or of the last one it crossed. A dragged page lands only on a group.
  const dragOverList = (event) => {
    if (draggedPage) {
      const name = pageTargetAt(event)
      setPageTarget(name)
      if (!name) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      return
    }
    if (!dragging) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const name = groupAt(event)
    if (name) setDropTarget(name)
  }
  const listDragHandlers = {
    onDragEnter: dragOverList,
    onDragOver: dragOverList,
    onDragLeave: (event) => { if (draggedPage && !event.currentTarget.contains(event.relatedTarget)) setPageTarget(null) },
    onDrop: (event) => {
      if (draggedPage) {
        const name = pageTargetAt(event)
        if (name) {
          event.preventDefault()
          movePage(docs.find((item) => item.slug === draggedPage), name)
        }
        endDrag()
        return
      }
      if (!dragging) return
      event.preventDefault()
      const name = groupAt(event) || dropTarget
      if (name) moveGroup(dragging, named.findIndex((group) => group.name === name))
      endDrag()
    },
  }
  // An admin's page link: dragged onto another group, or moved with Alt and the up or down arrow, the page joins
  // that group; F2 edits its title, and a right click, a long press, or Shift+F10 opens its menu. `pinned` is the
  // page's row in the Pinned group, which stays where it is (`index` its place there).
  const pageHandlers = (entry, pinned, index) => editable ? {
    ...(movable && {
      draggable: true,
      onDragStart: (event) => {
        event.dataTransfer.effectAllowed = 'all'
        setDraggedPage(entry.slug)
      },
      onDragEnd: endDrag,
    }),
    ...pressHandlers(entry, index),
    onContextMenu: (event) => openMenu(event, entry, index),
    onKeyDown: (event) => {
      if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
        event.preventDefault()
        openMenu(event, entry, index)
        return
      }
      if (event.key === 'F2' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault()
        startRename(entry, pinned)
        return
      }
      if (!movable || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
      event.preventDefault()
      // A page outside any group goes down into the first one.
      const target = named[named.findIndex((group) => group.name === (entry.group || '')) + (event.key === 'ArrowUp' ? -1 : 1)]
      if (target) movePage(entry, target.name, { focus: true, reveal: !pinned })
    },
    'aria-keyshortcuts': movable ? 'Alt+ArrowUp Alt+ArrowDown F2 Shift+F10' : 'F2 Shift+F10',
    'aria-describedby': `${id}-edit`,
  } : {}
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

  // A page row: the link, and for a signed-in reader the pin at its end. In the Pinned group (`index` is the row's
  // place there) the link also names the page's own group, since pages of different groups often share a title.
  const documentRow = (entry, index) => {
    const pinned = pinnedSlugs.includes(entry.slug)
    const inPinned = index !== undefined
    const context = inPinned && entry.group
    if (renaming?.slug === entry.slug && renaming.pinned === inPinned) return (
      <div key={entry.slug} className={styles.documentRow}>
        <form className={styles.renameForm} onSubmit={(event) => { event.preventDefault(); endRename(entry, renameInput.current?.value, true) }}>
          <Icon name="file" size={16} />
          <input ref={renameInput} className={styles.renameInput} defaultValue={entry.title} maxLength={200} autoFocus
            aria-label={`Title of ${entry.title}`} enterKeyHint="done" onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); endRename(entry, null, true) } }}
            onBlur={(event) => { if (document.hasFocus()) endRename(entry, event.currentTarget.value, false) }} />
        </form>
      </div>
    )
    return (
      <div key={entry.slug} className={`${styles.documentRow} ${authed ? styles.pinnableRow : ''} ${editable ? styles.editableRow : ''} ${pinned ? styles.pinnedRow : ''} ${draggedPage === entry.slug ? styles.draggingPage : ''} ${menu?.entry.slug === entry.slug && (menu.index !== undefined) === inPinned ? styles.menuRow : ''}`}>
        <a href={`/p/${encodeURIComponent(project.slug)}/${encodeURIComponent(entry.slug)}`} data-doc={entry.slug}
          className={`${styles.documentLink} ${entry.slug === doc?.slug ? styles.currentDocument : ''}`}
          aria-current={entry.slug === doc?.slug ? 'page' : undefined} onClick={followLink} {...pageHandlers(entry, inPinned, index)}>
          <Icon name="file" size={16} />
          <span className={styles.documentLabel}>{entry.title}{context && <>{' '}<small className={styles.documentContext} title={entry.group}>{entry.group}</small></>}</span>
        </a>
        {authed && <button className={styles.documentPin} onClick={(event) => togglePin(event, entry, index)}
          aria-label={`${pinned ? 'Unpin' : 'Pin'} ${entry.title}`} title={pinned ? 'Unpin' : 'Pin to the top'}>
          <Icon name="pin" size={14} />
        </button>}
      </div>
    )
  }

  return (
    <div className={`${styles.navigation} ${mobile ? styles.mobileNavigation : ''}`}>
      {!mobile && <div className={styles.brandRow}>
        {authed ? <a href="/" className={styles.brandLink} aria-label="MOA project home"><Brand /></a> : <Brand />}
        <div className={styles.brandActions}>
          {onSearch && <SearchButton onClick={onSearch} />}
          {onCollapse && <IconButton ref={collapseButtonRef} icon="panelLeftClose" label="Hide sidebar" onClick={onCollapse} />}
        </div>
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
      {editable && <p id={`${id}-edit`} className={styles.visuallyHidden}>{movable ? 'Drag a page onto another group, or press Alt with the up or down arrow, to move it there. ' : ''}Press F2 to rename a page, or Shift+F10 for its menu.</p>}
      {orderError && <p className={styles.navigationError} role="alert">{orderError}</p>}
      <nav className={styles.documentNavigation} ref={navRef} aria-label="Project documents" {...listDragHandlers}>
        {groups.length === 0 && <p className={styles.navigationEmpty}>No documents yet.</p>}
        {pinnedPages.length > 0 && <div className={`${styles.documentGroup} ${styles.pinnedGroup}`}>
          <button className={styles.groupToggle} onClick={() => onToggle(PINNED)} aria-expanded={pinnedOpen} aria-controls={`${id}-pinned`}>
            <span className={`${styles.groupCaret} ${pinnedOpen ? styles.groupExpanded : ''}`}><Icon name="chevronRight" size={14} /></span>
            <span className={styles.groupName}>Pinned</span>
            <span className={styles.groupCount}>{pinnedPages.length}</span>
          </button>
          {pinnedOpen && <div id={`${id}-pinned`} className={styles.groupItems}>
            {pinnedPages.map((entry, index) => documentRow(entry, index))}
          </div>}
        </div>}
        {groups.map((group, index) => group.name === '' ? group.items.map((entry) => documentRow(entry)) : (
          <div className={`${styles.documentGroup} ${dragging === group.name ? styles.draggingGroup : ''} ${dropMarker(group.name)} ${pageTarget === group.name ? styles.dropInto : ''}`} key={group.name} data-group={group.name}>
            <button className={styles.groupToggle} onClick={(event) => toggleGroup(event, group.name)} {...toggleHandlers(group.name)}
              aria-expanded={!collapsed.has(group.name)} aria-controls={`${id}-group-${index}`}>
              <span className={`${styles.groupCaret} ${!collapsed.has(group.name) ? styles.groupExpanded : ''}`}><Icon name="chevronRight" size={14} /></span>
              <span className={styles.groupName}>{group.name}</span>
              <span className={styles.groupCount}>{group.items.length}</span>
            </button>
            {!collapsed.has(group.name) && <div id={`${id}-group-${index}`} className={styles.groupItems}>
              {group.items.map((entry) => documentRow(entry))}
            </div>}
          </div>
        ))}
      </nav>
      {menu && createPortal(
        <div ref={menuRef} className={styles.pageMenu} role="menu" aria-label={menu.entry.title} onKeyDown={menuKeys}>
          <button type="button" role="menuitem" className={styles.pageMenuItem}
            onClick={() => { const { entry, index } = menu; closeMenu(false); startRename(entry, index !== undefined) }}>
            <Icon name="edit" size={14} /><span>Rename</span><kbd className={styles.pageMenuKey} aria-hidden="true">F2</kbd>
          </button>
          <button type="button" role="menuitem" className={styles.pageMenuItem}
            onClick={() => {
              const { entry, index } = menu
              closeMenu(false)
              togglePin({ detail: 1 }, entry, index)
              ;(findLink(navRef.current, entry.slug, index !== undefined) || findLink(navRef.current, entry.slug, false))?.focus()
            }}>
            <Icon name="pin" size={14} /><span>{pinnedSlugs.includes(menu.entry.slug) ? 'Unpin' : 'Pin to the top'}</span>
          </button>
        </div>,
        navRef.current?.closest('[role="dialog"]') || document.body)}
      <div className={styles.navigationFooter}>
        {authed ? <a href="/"><Icon name="arrowLeft" size={16} />All projects</a> : <span><Icon name="lock" size={14} />Only this document is shared</span>}
      </div>
    </div>
  )
}
