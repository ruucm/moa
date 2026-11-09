'use client'

import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { Brand, Icon, IconButton, StatusBadge } from '../../components/ui/index.jsx'
import { copyText } from '../../lib/client-store.js'
import { openTab } from '../../lib/tabs.js'
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
// The Archived group closes the list and starts closed: for it the set holds the opposite, its name while it is open.
const ARCHIVED = '\u0000archived'

// Pages gathered by group, in the order they come.
function groupPages(items) {
  const result = []
  for (const entry of items) {
    const name = entry.group || ''
    let group = result.find((item) => item.name === name)
    if (!group) result.push((group = { name, items: [] }))
    group.items.push(entry)
  }
  return result
}

// The top of the list — groups, and pages outside any group (`loose`, in the order of the sort menu) — as an admin
// arranged it by dragging (`saved`: group names, and { doc } for a page outside any group). Saved items come first,
// as saved; a group not saved follows the last saved group (or opens the list), by its order meta; a page outside any
// group that isn't saved goes to the end. With nothing saved, the groups come first and the pages outside any group
// after them. The sort menu never moves a group or a saved page. A page from `saved` is marked `placed`.
function arrangeTop(groups, loose, saved = []) {
  const groupNamed = new Map(groups.map((group) => [group.name, group]))
  const pageAt = new Map(loose.map((entry) => [entry.slug, entry]))
  const top = []
  const used = new Set()
  let afterGroups = 0
  for (const item of saved) {
    const group = typeof item === 'string' ? groupNamed.get(item) : null
    const entry = !group && typeof item?.doc === 'string' ? pageAt.get(item.doc) : null
    const key = group ? `group:${group.name}` : entry && `page:${entry.slug}`
    if (!key || used.has(key)) continue
    used.add(key)
    top.push(group ? { group } : { page: entry, placed: true })
    if (group) afterGroups = top.length
  }
  top.splice(afterGroups, 0, ...groups.filter((group) => !used.has(`group:${group.name}`)).map((group) => ({ group })))
  return [...top, ...loose.filter((entry) => !used.has(`page:${entry.slug}`)).map((entry) => ({ page: entry }))]
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
  // What is dragged — { group: name } or { page: slug } — and where it would land: into a group ({ into: name }, a
  // page), or beside an item at the top of the list ({ index, side: 'before' | 'after' }).
  const [dragged, setDragged] = useState(null)
  const [drop, setDrop] = useState(null)
  // The top of the list as it is being saved, after a group or a page outside any group was moved there.
  const [pendingOrder, setPendingOrder] = useState(null)
  const [orderError, setOrderError] = useState('')
  // Pins and unpins not saved yet, as [slug, pinned], the latest last. They show at once.
  const [pendingPins, setPendingPins] = useState([])
  const pinSaves = useRef(Promise.resolve())
  // Renames and moves not saved yet, as { slug, title } or { slug, group }, the latest last. They show at once too.
  const [pendingPages, setPendingPages] = useState([])
  const pageSaves = useRef(Promise.resolve())
  // Pages and groups archived or brought back, not saved yet, as { doc | group, archived }, the latest last.
  const [pendingArchive, setPendingArchive] = useState([])
  const archiveSaves = useRef(Promise.resolve())
  // The row being edited — { slug, pinned, field }, `pinned` for its row in the Pinned group: its page's title
  // (`field: 'title'`), or the name of a new group for a page outside any group (`field: 'group'`).
  const [editing, setEditing] = useState(null)
  const editingRef = useRef(null)
  const editInput = useRef(null)
  const editedRow = useRef(null)
  // The menu open on a page row — { entry, index, x, y }, `index` for the row in the Pinned group — from a right
  // click, a long press, or Shift+F10 on the link; the link gets focus back when the menu closes from the keyboard.
  const [menu, setMenu] = useState(null)
  const menuRef = useRef(null)
  const menuLink = useRef(null)
  const longPress = useRef(null)
  // The menu's Copy link item says the link is copied for a moment before the menu closes.
  const [copied, setCopied] = useState(false)
  const menuTimer = useRef(null)
  const movedPage = useRef(null)
  const navRef = useRef(null)
  const openedGroup = useRef(null)
  const appliedSort = useRef(sort)
  const movedGroup = useRef(null)
  const id = useId()
  const savedOrder = project.groupOrder
  const allDocs = useMemo(() => pendingPages.length
    ? project.docs.map((entry) => pendingPages.reduce((page, { slug, ...change }) => slug === entry.slug ? { ...page, ...change } : page, entry))
    : project.docs, [project.docs, pendingPages])
  // The groups and pages an admin archived (`project.archived`, as they will be once pending changes are saved):
  // out of the list, in the Archived group at its end.
  const archivedGroups = useMemo(() => {
    const names = new Set(project.archived?.groups || [])
    for (const change of pendingArchive) if (change.group) change.archived ? names.add(change.group) : names.delete(change.group)
    return names
  }, [project.archived, pendingArchive])
  const archivedDocs = useMemo(() => {
    const slugs = new Set(project.archived?.docs || [])
    for (const change of pendingArchive) if (change.doc) change.archived ? slugs.add(change.doc) : slugs.delete(change.doc)
    return slugs
  }, [project.archived, pendingArchive])
  const inArchivedGroup = (entry) => archivedGroups.has(entry.group || '')
  const docs = useMemo(() => allDocs.filter((entry) => !archivedDocs.has(entry.slug) && !archivedGroups.has(entry.group || '')), [allDocs, archivedDocs, archivedGroups])
  const savedList = useMemo(() => Array.isArray(savedOrder) ? savedOrder : [], [savedOrder])
  // The top of the list: the groups, their pages sorted by the sort menu, and the pages outside any group, as an admin
  // arranged them. A moved group or page shows in its new place at once, while the order is being saved.
  const top = useMemo(() => {
    const groups = groupPages(docs.filter((entry) => entry.group)).map((group) => ({ ...group, items: sortPages(group.items, sort) }))
    return arrangeTop(groups, sortPages(docs.filter((entry) => !entry.group), sort), pendingOrder || savedList)
  }, [docs, savedList, pendingOrder, sort])
  // In the Archived group: pages archived on their own (the name of their group beside them), then whole groups.
  const archivedPages = useMemo(() => sortPages(allDocs.filter((entry) => archivedDocs.has(entry.slug) && !archivedGroups.has(entry.group || '')), sort), [allDocs, archivedDocs, archivedGroups, sort])
  const archivedList = useMemo(() => {
    const groups = groupPages(allDocs.filter((entry) => archivedGroups.has(entry.group || ''))).map((group) => ({ ...group, items: sortPages(group.items, sort) }))
    return arrangeTop(groups, [], savedList).map((item) => item.group)
  }, [allDocs, archivedGroups, savedList, sort])
  const archivedCount = archivedPages.length + archivedList.reduce((count, group) => count + group.items.length, 0)
  const archivedOpen = collapsed.has(ARCHIVED)
  // The page sort only shows where some group (or the ungrouped list) has more than one page.
  const sortable = useMemo(() => {
    const counts = new Map()
    for (const entry of docs) counts.set(entry.group || '', (counts.get(entry.group || '') || 0) + 1)
    return [...counts.values()].some((count) => count > 1)
  }, [docs])
  // The groups as they are listed.
  const named = useMemo(() => top.filter((item) => item.group).map((item) => item.group), [top])
  // An admin drags a group into another place at the top of the list, once there is another item there.
  const reorderable = owner && top.length > 1
  // An admin renames pages and moves them into other groups (a demo project stays as it ships). A page in a group can
  // move once there is a second group; a page outside any group, once there is anything else at the top of the list —
  // a group to go into, or a place beside it.
  const editable = owner && !project.demo
  const movable = editable && top.length > 1
  const canMove = (entry) => movable && (entry.group ? named.length > 1 : true)
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
  }, [top])

  // A page moved into another group comes into view there, and focus follows it when it was moved from the
  // keyboard: the row is drawn anew in its new group.
  useEffect(() => {
    const moved = movedPage.current
    movedPage.current = null
    const link = moved && findLink(navRef.current, moved.slug, false)
    if (!link) return
    revealInList(navRef.current, link, true)
    if (moved.focus) link.focus()
  }, [top, collapsed])

  // Focus goes back to a page's link once its title, or the name of a new group for it, is no longer edited from the
  // keyboard.
  useEffect(() => {
    const row = editedRow.current
    if (editing || !row) return
    editedRow.current = null
    findLink(navRef.current, row.slug, row.pinned)?.focus()
  }, [editing])

  // While a group or a page is dragged, holding the pointer near the top or bottom edge of the list scrolls it,
  // so it can travel the whole list in one drag.
  useEffect(() => {
    if (!dragged) return
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
  }, [dragged])

  const toggleGroup = (event, name) => {
    if (collapsed.has(name)) openedGroup.current = event.currentTarget.parentElement
    onToggle(name)
  }

  // Moves the item at `from` of the top of the list to the place before the item at `at` (at the end for its length),
  // and saves that order for everyone: the items down to the last group, the moved item, or a page saved in its place
  // before (pages outside any group below them stay unsaved, at the end, in the order of the sort menu), then the
  // archived groups and pages, which keep their saved places. The move shows at once and is undone if the save fails.
  const moveTop = async (from, at) => {
    if (pendingOrder || from < 0 || from >= top.length || at < 0 || at > top.length || at === from || at === from + 1) return
    const next = [...top]
    const [item] = next.splice(from, 1)
    next.splice(at > from ? at - 1 : at, 0, item)
    const end = next.findLastIndex((entry) => entry.group || entry.placed || entry === item)
    const kept = savedList.filter((entry) => typeof entry === 'string' ? archivedGroups.has(entry) : archivedDocs.has(entry?.doc))
    const order = [...next.slice(0, end + 1).map((entry) => entry.group ? entry.group.name : { doc: entry.page.slug }), ...kept]
    setOrderError('')
    setPendingOrder(order)
    try {
      const response = await fetch('/api/order/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: project.slug, groups: order }) })
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

  const startEdit = (entry, pinned, field) => {
    setOrderError('')
    editingRef.current = { slug: entry.slug, pinned, field }
    setEditing(editingRef.current)
  }
  // Takes the field away from `entry`'s row and returns that row, or null when it is gone already: only the first of
  // Enter, Escape and leaving the field counts — Escape also takes the field away, which may blur it.
  const endEdit = (entry) => {
    const row = editingRef.current
    if (row?.slug !== entry.slug) return null
    editingRef.current = null
    setEditing(null)
    return row
  }
  const oneLine = (text) => (text || '').replace(/\s+/g, ' ').trim()
  // Enter, or leaving the field, saves a changed title; Escape keeps the old one (`title` null). A field closed from
  // the keyboard gives focus back to the page's link.
  const endRename = (entry, title, fromKeyboard) => {
    const row = endEdit(entry)
    if (!row) return
    if (fromKeyboard) editedRow.current = row
    const text = oneLine(title)
    if (text && text !== entry.title) savePage({ slug: entry.slug, title: text })
  }
  // A page outside any group goes into the group named in the field above it — a new group, or one of that name
  // already there — as a move into another group: Enter saves it and keyboard focus goes along to the page there,
  // and leaving the field saves it too. Escape, or no name, leaves the page where it was. An archived group's name is
  // refused: the page would be archived with that group. A page's row in the Pinned group stays where it is.
  const endNewGroup = (entry, name, fromKeyboard) => {
    const row = endEdit(entry)
    if (!row) return
    const text = oneLine(name)
    const refused = archivedGroups.has(text)
    if (fromKeyboard && (!text || refused || row.pinned)) editedRow.current = row
    if (refused) setOrderError(`“${text}” is an archived group. Unarchive it first, or choose another name.`)
    else if (text) movePage(entry, text, { focus: fromKeyboard, reveal: !row.pinned })
  }

  // The menu of a page ({ kind: 'page', entry, index }) or of a group ({ kind: 'group', name }) opens at the pointer,
  // or by the row when it was opened from the keyboard.
  const openMenu = (event, target) => {
    event.preventDefault?.()
    const row = event.currentTarget
    const rect = row.getBoundingClientRect()
    const atPointer = event.clientX || event.clientY
    clearTimeout(menuTimer.current)
    setCopied(false)
    menuLink.current = row
    setMenu({ ...target, x: atPointer ? event.clientX : rect.left + 24, y: atPointer ? event.clientY : rect.bottom - 6 })
  }
  const closeMenu = (toLink) => {
    const link = menuLink.current
    menuLink.current = null
    clearTimeout(menuTimer.current)
    setCopied(false)
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
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    // A scroll closes it too — once the list has settled: a group opened just before scrolls its pages into view
    // for a moment longer.
    const settled = setTimeout(() => document.addEventListener('scroll', close, true), 400)
    return () => {
      clearTimeout(settled)
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
  // On a touch screen the menu opens on a long press (half a second, without moving), beside the finger. The tap
  // that ends the press is not a click on the page, nor on the menu item that may have come up under the finger:
  // that click follows the lift at once, and after it clicks count again.
  const stopPress = () => {
    const press = longPress.current
    clearTimeout(press?.timer)
    if (press?.timer) longPress.current = null
    else if (press?.fired) setTimeout(() => { if (longPress.current === press) longPress.current = null }, 400)
  }
  const pressHandlers = (target) => ({
    onPointerDown: (event) => {
      stopPress()
      longPress.current = null
      if (event.pointerType !== 'touch' || event.button !== 0) return
      const row = event.currentTarget
      const { clientX, clientY } = event
      longPress.current = { x: clientX, y: clientY, timer: setTimeout(() => {
        longPress.current = { fired: true }
        openMenu({ currentTarget: row, clientX: clientX + 12, clientY: clientY + 12 }, target)
      }, 500) }
    },
    onPointerMove: (event) => {
      const press = longPress.current
      if (press?.timer && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) stopPress()
    },
    onPointerUp: stopPress,
    onPointerCancel: stopPress,
  })
  // A click right after a long press is the press ending, not a click.
  const afterPress = (event) => {
    if (!longPress.current?.fired) return false
    event.preventDefault()
    longPress.current = null
    return true
  }
  const followLink = (event) => { if (!afterPress(event)) onNavigate?.(event) }

  const pageHref = (entry) => `/p/${encodeURIComponent(project.slug)}/${encodeURIComponent(entry.slug)}`
  // What the browser's own link menu offered before the row's menu took the right click (held with Shift, the right
  // click still gets it): the page in a new tab — one of moa's own, in the strip at the top of the window
  // (lib/tabs.js) — or in a new window — the popup window a page may open, the size of this one and a little to the
  // side — and its link copied.
  const openPage = (entry, inWindow) => {
    if (!inWindow) { openTab(pageHref(entry), { title: entry.title }); return }
    const width = Math.min(window.outerWidth || 1280, window.screen?.availWidth || 1280)
    const height = Math.min(window.outerHeight || 900, window.screen?.availHeight || 900)
    window.open(pageHref(entry), '_blank', `popup,noopener,width=${width},height=${height},left=${(window.screenX || 0) + 40},top=${(window.screenY || 0) + 40}`)
  }
  const copyLink = async (entry) => {
    const ok = await copyText(new URL(pageHref(entry), window.location.href).href, { promptFallback: false })
    if (!ok) {
      closeMenu(true)
      setOrderError('Could not copy the link.')
      return
    }
    setCopied(true)
    clearTimeout(menuTimer.current)
    menuTimer.current = setTimeout(() => closeMenu(true), 900)
  }

  // Archives a page or a whole group, or brings it back. The change shows at once and is saved in the registry for
  // everyone; it is undone if the save fails. Focus follows: to the Archived group the row went into, or to the row
  // where it is back (its group's heading while that group is closed).
  const setArchived = (target, archived) => {
    const change = target.kind === 'group' ? { group: target.name, archived } : { doc: target.entry.slug, archived }
    setOrderError('')
    flushSync(() => setPendingArchive((current) => [...current.filter((item) => item.group !== change.group || item.doc !== change.doc), change]))
    const nav = navRef.current
    const groupToggle = (name) => [...(nav?.querySelectorAll('[data-group]') || [])].find((element) => element.dataset.group === name)?.querySelector('button')
    const back = target.kind === 'group' ? groupToggle(target.name) : findLink(nav, target.entry.slug, false) || groupToggle(target.entry.group || '')
    const row = (archived ? null : back) || nav?.querySelector('[data-archived-toggle]')
    if (row) {
      revealInList(nav, row, true)
      row.focus()
    }
    archiveSaves.current = archiveSaves.current.then(async () => {
      try {
        const response = await fetch('/api/archive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: project.slug, ...change }) })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || data.error) throw new Error(data.error || 'Could not save the change.')
        await onReorder?.()
      } catch (error) {
        setOrderError(error.message || 'Could not save the change. Please try again.')
      } finally {
        setPendingArchive((current) => current.filter((item) => item !== change))
      }
    })
  }

  const endDrag = () => { setDragged(null); setDrop(null) }
  // The elements of the top of the list, in its order: the groups (data-group) and the pages outside any group
  // (data-loose). The item under the pointer is { element, index }.
  const topElements = () => [...(navRef.current?.children || [])].filter((element) => 'group' in element.dataset || 'loose' in element.dataset)
  const topAt = (event) => {
    const element = event.target.closest?.('[data-group], [data-loose]')
    const index = element ? topElements().indexOf(element) : -1
    return index < 0 ? null : { element, index }
  }
  // A dragged group takes the place of the item under the pointer — before it when that is higher in the list, after
  // it when lower — or of the last one it crossed, so the gaps between items take the drop too.
  const groupDropAt = (event, name) => {
    const target = topAt(event)
    if (!target) return drop
    const from = top.findIndex((item) => item.group?.name === name)
    return target.index === from ? null : { index: target.index, side: target.index < from ? 'before' : 'after' }
  }
  // A dragged page goes into the group under the pointer — its heading or its pages — unless that is its own group. A
  // page outside any group also goes beside an item at the top of the list: above a group from the top edge of its
  // heading (below a closed group from the bottom edge), above or below another such page by the half of it under the
  // pointer, or into the gap between items it is held in. A drop that would leave it where it is takes nothing.
  const pageDropAt = (event, slug) => {
    const entry = docs.find((item) => item.slug === slug)
    if (!entry) return null
    const target = topAt(event)
    const name = target?.element.dataset.group
    if (entry.group) return name !== undefined && name !== entry.group ? { into: name } : null
    const y = event.clientY
    let place = null
    if (name !== undefined) {
      const box = target.element.firstElementChild.getBoundingClientRect()
      const edge = box.height / 4
      if (y < box.top + edge) place = { index: target.index, side: 'before' }
      else if (collapsed.has(name) && y > box.bottom - edge && y <= box.bottom) place = { index: target.index, side: 'after' }
      else return { into: name }
    } else if (target) {
      const box = target.element.getBoundingClientRect()
      place = { index: target.index, side: y < box.top + box.height / 2 ? 'before' : 'after' }
    } else if (event.target === navRef.current && top.length) {
      const below = topElements().findIndex((element) => element.getBoundingClientRect().top > y)
      place = below < 0 ? { index: top.length - 1, side: 'after' } : { index: below, side: 'before' }
    } else return null
    const from = top.findIndex((item) => item.page?.slug === slug)
    const at = place.side === 'before' ? place.index : place.index + 1
    return at === from || at === from + 1 ? null : place
  }
  const dropAt = (event) => !dragged ? null : dragged.group !== undefined ? groupDropAt(event, dragged.group) : pageDropAt(event, dragged.page)
  const dragOverList = (event) => {
    if (!dragged) return
    const place = dropAt(event)
    setDrop(place)
    if (!place) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }
  const listDragHandlers = {
    onDragEnter: dragOverList,
    onDragOver: dragOverList,
    onDragLeave: (event) => { if (dragged?.page && !event.currentTarget.contains(event.relatedTarget)) setDrop(null) },
    onDrop: (event) => {
      const place = dropAt(event)
      if (place) {
        event.preventDefault()
        if (place.into) movePage(docs.find((item) => item.slug === dragged.page), place.into)
        else {
          const from = top.findIndex((item) => dragged.group !== undefined ? item.group?.name === dragged.group : item.page?.slug === dragged.page)
          moveTop(from, place.side === 'before' ? place.index : place.index + 1)
        }
      }
      endDrag()
    },
  }
  // An admin's page link: dragged onto another group, or moved with Alt and the up or down arrow, the page joins
  // that group — a page outside any group the nearest group above or below it, and dragged between the items at the
  // top of the list, it moves there; F2 edits its title, and a right click, a long press, or Shift+F10 opens its menu.
  // `pinned` is the page's row in the Pinned group, which stays where it is (`index` its place there). An archived
  // page's row only has the menu and F2.
  const pageHandlers = (entry, pinned, index, archived) => {
    if (!editable) return {}
    const target = { kind: 'page', entry, index }
    const moves = canMove(entry) && !archived
    return {
      ...(moves && {
        draggable: true,
        onDragStart: (event) => {
          event.dataTransfer.effectAllowed = 'all'
          setDragged({ page: entry.slug })
        },
        onDragEnd: endDrag,
      }),
      ...pressHandlers(target),
      onContextMenu: (event) => { if (!event.shiftKey) openMenu(event, target) },
      onKeyDown: (event) => {
        if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
          event.preventDefault()
          openMenu(event, target)
          return
        }
        if (event.key === 'F2' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
          event.preventDefault()
          startEdit(entry, pinned, 'title')
          return
        }
        if (!moves || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
        event.preventDefault()
        const up = event.key === 'ArrowUp'
        // A page in a group goes into the group above or below its own; a page outside any group, into the nearest
        // group above or below it.
        const at = top.findIndex((item) => entry.group ? item.group?.name === entry.group : item.page?.slug === entry.slug)
        const into = (up ? top.slice(0, at).reverse() : top.slice(at + 1)).find((item) => item.group)?.group
        if (into) movePage(entry, into.name, { focus: true, reveal: !pinned })
      },
      'aria-keyshortcuts': moves ? 'Alt+ArrowUp Alt+ArrowDown F2 Shift+F10' : 'F2 Shift+F10',
      'aria-describedby': `${id}-edit`,
    }
  }
  // A group's heading: an admin drags it into another place at the top of the list, or moves it one place up or down
  // there with Alt and the arrow keys; a right click, a long press, or Shift+F10 opens the group's menu. An archived
  // group's heading only has the menu.
  const groupHandlers = (name, archived) => {
    const orderable = reorderable && !archived
    const target = { kind: 'group', name }
    return {
      ...(orderable && {
        draggable: !pendingOrder,
        onDragStart: (event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', name)
          setDragged({ group: name })
        },
        onDragEnd: endDrag,
        'aria-describedby': `${id}-reorder`,
      }),
      ...(editable && { ...pressHandlers(target), onContextMenu: (event) => { if (!event.shiftKey) openMenu(event, target) } }),
      ...((orderable || editable) && { 'aria-keyshortcuts': [orderable && 'Alt+ArrowUp Alt+ArrowDown', editable && 'Shift+F10'].filter(Boolean).join(' ') }),
      onKeyDown: (event) => {
        if (editable && ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu')) {
          event.preventDefault()
          openMenu(event, target)
          return
        }
        if (!orderable || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
        event.preventDefault()
        const from = top.findIndex((item) => item.group?.name === name)
        const at = event.key === 'ArrowUp' ? from - 1 : from + 2
        if (pendingOrder || from < 0 || at < 0 || at > top.length) return
        movedGroup.current = name
        moveTop(from, at)
      },
    }
  }
  // The line shows where the dragged item lands, beside the item of the top of the list at `index`.
  const dropMarker = (index) => drop?.index === index ? (drop.side === 'before' ? styles.dropBefore : styles.dropAfter) : ''

  // A page row: the link, and for a signed-in reader the pin at its end. In the Pinned group (`index` is the row's
  // place there) the link also names the page's own group, since pages of different groups often share a title. A
  // page outside any group, at the top of the list (`place` its index there), is marked for dragging with data-loose.
  const documentRow = (entry, index, { archived = false, withGroup = false, place } = {}) => {
    const pinned = pinnedSlugs.includes(entry.slug)
    const inPinned = index !== undefined
    const context = (inPinned || withGroup) && entry.group
    const edited = editing?.slug === entry.slug && editing.pinned === inPinned && editing.field
    // At the top of the list a page shares the keys of the groups beside it.
    const key = place === undefined ? entry.slug : `page:${entry.slug}`
    const loose = place === undefined ? {} : { 'data-loose': entry.slug }
    if (edited === 'title') return (
      <div key={key} className={styles.documentRow} {...loose}>
        <form className={styles.renameForm} onSubmit={(event) => { event.preventDefault(); endRename(entry, editInput.current?.value, true) }}>
          <Icon name="file" size={16} />
          <input ref={editInput} className={styles.renameInput} defaultValue={entry.title} maxLength={200} autoFocus
            aria-label={`Title of ${entry.title}`} enterKeyHint="done" onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); endRename(entry, null, true) } }}
            onBlur={(event) => { if (document.hasFocus()) endRename(entry, event.currentTarget.value, false) }} />
        </form>
      </div>
    )
    const row = (
      <div key={key} {...(edited ? {} : loose)} className={`${styles.documentRow} ${authed && !archived ? styles.pinnableRow : ''} ${editable ? styles.editableRow : ''} ${pinned ? styles.pinnedRow : ''} ${archived ? styles.archivedRow : ''} ${dragged?.page === entry.slug ? styles.draggingPage : ''} ${menu?.kind === 'page' && menu.entry.slug === entry.slug && (menu.index !== undefined) === inPinned ? styles.menuRow : ''} ${place === undefined || edited ? '' : dropMarker(place)}`}>
        <a href={pageHref(entry)} data-doc={entry.slug}
          className={`${styles.documentLink} ${entry.slug === doc?.slug ? styles.currentDocument : ''}`}
          aria-current={entry.slug === doc?.slug ? 'page' : undefined} onClick={followLink} {...pageHandlers(entry, inPinned, index, archived)}>
          <Icon name="file" size={16} />
          <span className={styles.documentLabel}>{entry.title}{context && <>{' '}<small className={styles.documentContext} title={entry.group}>{entry.group}</small></>}</span>
        </a>
        {authed && !archived && <button className={styles.documentPin} onClick={(event) => togglePin(event, entry, index)}
          aria-label={`${pinned ? 'Unpin' : 'Pin'} ${entry.title}`} title={pinned ? 'Unpin' : 'Pin to the top'}>
          <Icon name="pin" size={14} />
        </button>}
      </div>
    )
    // The name of a new group for the page is typed above it, in a field in the shape of a group's heading: the group
    // as it will be, with the page in it.
    if (edited === 'group') return (
      <div key={key} className={`${styles.newGroup} ${place === undefined ? '' : dropMarker(place)}`} {...loose}>
        <form className={styles.newGroupForm} onSubmit={(event) => { event.preventDefault(); endNewGroup(entry, editInput.current?.value, true) }}>
          <span className={`${styles.groupCaret} ${styles.groupExpanded}`}><Icon name="chevronRight" size={14} /></span>
          <input ref={editInput} className={`${styles.renameInput} ${styles.groupNameInput}`} placeholder="Group name" maxLength={200} autoFocus
            aria-label={`New group for ${entry.title}`} enterKeyHint="done"
            onKeyDown={(event) => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); endNewGroup(entry, null, true) } }}
            onBlur={(event) => { if (document.hasFocus()) endNewGroup(entry, event.currentTarget.value, false) }} />
        </form>
        <div className={styles.groupItems}>{row}</div>
      </div>
    )
    return row
  }

  // What the open menu's archive item acts on: the group (a group's menu, or a page inside an archived group), or
  // the page itself.
  const archiveItem = !menu ? null : menu.kind === 'group' || inArchivedGroup(menu.entry)
    ? ((name) => ({ target: { kind: 'group', name }, archived: archivedGroups.has(name), label: archivedGroups.has(name) ? 'Unarchive group' : 'Archive group' }))(menu.kind === 'group' ? menu.name : menu.entry.group)
    : { target: { kind: 'page', entry: menu.entry }, archived: archivedDocs.has(menu.entry.slug), label: archivedDocs.has(menu.entry.slug) ? 'Unarchive' : 'Archive' }

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
      {reorderable && <p id={`${id}-reorder`} className={styles.visuallyHidden}>Drag a group, or press Alt with the up or down arrow, to move it among the groups and the pages outside any group, for everyone.</p>}
      {editable && <p id={`${id}-edit`} className={styles.visuallyHidden}>{movable ? 'Drag a page onto another group, or press Alt with the up or down arrow, to move it there. A page outside any group can also be dragged between the groups and the other pages. ' : ''}Press F2 to rename a page, or Shift+F10 for its menu, which also archives it, and puts a page outside any group into a new group. Shift+F10 on a group opens the group's menu.</p>}
      {orderError && <p className={styles.navigationError} role="alert">{orderError}</p>}
      <span className={styles.visuallyHidden} role="status">{copied ? 'Link copied' : ''}</span>
      <nav className={styles.documentNavigation} ref={navRef} aria-label="Project documents" {...listDragHandlers}>
        {top.length === 0 && <p className={styles.navigationEmpty}>No documents yet.</p>}
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
        {top.map(({ group, page }, index) => page ? documentRow(page, undefined, { place: index }) : (
          <div className={`${styles.documentGroup} ${dragged?.group === group.name ? styles.draggingGroup : ''} ${dropMarker(index)} ${drop?.into === group.name ? styles.dropInto : ''}`} key={`group:${group.name}`} data-group={group.name}>
            <button className={`${styles.groupToggle} ${menu?.kind === 'group' && menu.name === group.name ? styles.menuGroup : ''}`} onClick={(event) => { if (!afterPress(event)) toggleGroup(event, group.name) }} {...groupHandlers(group.name, false)}
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
        {archivedCount > 0 && <div className={`${styles.documentGroup} ${styles.archivedGroup}`}>
          <button className={styles.groupToggle} data-archived-toggle="" onClick={(event) => { if (!archivedOpen) openedGroup.current = event.currentTarget.parentElement; onToggle(ARCHIVED) }}
            aria-expanded={archivedOpen} aria-controls={`${id}-archived`}>
            <span className={`${styles.groupCaret} ${archivedOpen ? styles.groupExpanded : ''}`}><Icon name="chevronRight" size={14} /></span>
            <span className={styles.groupName}>Archived</span>
            <span className={styles.groupCount}>{archivedCount}</span>
          </button>
          {archivedOpen && <div id={`${id}-archived`} className={styles.groupItems}>
            {archivedPages.map((entry) => documentRow(entry, undefined, { archived: true, withGroup: true }))}
            {archivedList.map((group, index) => (
              <div className={`${styles.documentGroup} ${styles.archivedSubgroup}`} key={group.name} data-archived-group={group.name}>
                <button className={`${styles.groupToggle} ${menu?.kind === 'group' && menu.name === group.name ? styles.menuGroup : ''}`} onClick={(event) => { if (!afterPress(event)) toggleGroup(event, group.name) }} {...groupHandlers(group.name, true)}
                  aria-expanded={!collapsed.has(group.name)} aria-controls={`${id}-archived-${index}`}>
                  <span className={`${styles.groupCaret} ${!collapsed.has(group.name) ? styles.groupExpanded : ''}`}><Icon name="chevronRight" size={14} /></span>
                  <span className={styles.groupName}>{group.name}</span>
                  <span className={styles.groupCount}>{group.items.length}</span>
                </button>
                {!collapsed.has(group.name) && <div id={`${id}-archived-${index}`} className={styles.groupItems}>
                  {group.items.map((entry) => documentRow(entry, undefined, { archived: true }))}
                </div>}
              </div>
            ))}
          </div>}
        </div>}
      </nav>
      {menu && createPortal(
        <div ref={menuRef} className={styles.pageMenu} role="menu" aria-label={menu.kind === 'group' ? menu.name : menu.entry.title} onKeyDown={menuKeys}
          onClickCapture={(event) => { if (afterPress(event)) event.stopPropagation() }}>
          {menu.kind === 'page' && <>
            <button type="button" role="menuitem" className={styles.pageMenuItem}
              onClick={() => { const { entry } = menu; closeMenu(true); openPage(entry, false) }}>
              <Icon name="arrowUpRight" size={14} /><span>Open in new tab</span>
            </button>
            <button type="button" role="menuitem" className={styles.pageMenuItem}
              onClick={() => { const { entry } = menu; closeMenu(true); openPage(entry, true) }}>
              <Icon name="window" size={14} /><span>Open in new window</span>
            </button>
            <button type="button" role="menuitem" className={styles.pageMenuItem} onClick={() => { if (!copied) copyLink(menu.entry) }}>
              <Icon name={copied ? 'check' : 'link'} size={14} /><span>{copied ? 'Link copied' : 'Copy link'}</span>
            </button>
            <div role="separator" className={styles.pageMenuRule} />
          </>}
          {menu.kind === 'page' && <button type="button" role="menuitem" className={styles.pageMenuItem}
            onClick={() => { const { entry, index } = menu; closeMenu(false); startEdit(entry, index !== undefined, 'title') }}>
            <Icon name="edit" size={14} /><span>Rename</span><kbd className={styles.pageMenuKey} aria-hidden="true">F2</kbd>
          </button>}
          {menu.kind === 'page' && !menu.entry.group && !archivedDocs.has(menu.entry.slug) && <button type="button" role="menuitem" className={styles.pageMenuItem}
            onClick={() => { const { entry, index } = menu; closeMenu(false); startEdit(entry, index !== undefined, 'group') }}>
            <Icon name="folderPlus" size={14} /><span>Add to new group</span>
          </button>}
          {menu.kind === 'page' && !archivedDocs.has(menu.entry.slug) && !inArchivedGroup(menu.entry) && <button type="button" role="menuitem" className={styles.pageMenuItem}
            onClick={() => {
              const { entry, index } = menu
              closeMenu(false)
              togglePin({ detail: 1 }, entry, index)
              ;(findLink(navRef.current, entry.slug, index !== undefined) || findLink(navRef.current, entry.slug, false))?.focus()
            }}>
            <Icon name="pin" size={14} /><span>{pinnedSlugs.includes(menu.entry.slug) ? 'Unpin' : 'Pin to the top'}</span>
          </button>}
          <button type="button" role="menuitem" className={styles.pageMenuItem}
            onClick={() => { closeMenu(false); setArchived(archiveItem.target, !archiveItem.archived) }}>
            <Icon name="archive" size={14} /><span>{archiveItem.label}</span>
          </button>
        </div>,
        navRef.current?.closest('[role="dialog"]') || document.body)}
      <div className={styles.navigationFooter}>
        {authed ? <a href="/"><Icon name="arrowLeft" size={16} />All projects</a> : <span><Icon name="lock" size={14} />Only this document is shared</span>}
      </div>
    </div>
  )
}
