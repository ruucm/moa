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

// The pages of a group as an admin arranged them by dragging (`saved`: their file names): those first, as saved, and
// the pages not among them — written or moved in since — after them, by their order meta.
function arrangePages(items, saved) {
  if (!saved?.length) return items
  const place = new Map(saved.map((slug, index) => [slug, index]))
  return [...items.filter((entry) => place.has(entry.slug)).sort((a, b) => place.get(a.slug) - place.get(b.slug)), ...items.filter((entry) => !place.has(entry.slug))]
}

// The sort menu orders the pages inside each group: by title, newest first, or in the default order — as an admin
// arranged the group (`saved`), else by order meta.
function sortPages(items, sort, saved) {
  if (sort === 'name') return [...items].sort((a, b) => compareNames(a.title, b.title))
  if (sort === 'recent') return [...items].sort((a, b) => updatedAt(b) - updatedAt(a))
  return arrangePages(items, saved)
}

// Where a dragged item would land, compared by value: a new object comes with every move of the pointer.
const samePlace = (a, b) => a === b || (!!a && !!b && a.into === b.into && a.group === b.group && a.at === b.at && a.index === b.index && a.side === b.side)

const sortHints = {
  name: 'Sorted by name. Choose “Default order” to arrange pages by hand.',
  recent: 'Sorted by last update. Choose “Default order” to arrange pages by hand.',
}

// `onSearch` opens the search over every project (the sidebar's own filter box is gone: the search finds a page
// of this project as well as any other, see features/search/GlobalSearch.jsx).
export default function DocumentNavigation({ project, projects, doc, authed, owner, collapsed, onToggle, sort = 'order', onSort, onReorder, onNavigate, onSearch, onCollapse, collapseButtonRef, mobile = false }) {
  // What is dragged — { group: name } or { page: slug } — and where it would land: a page into a group, at its end
  // ({ into: name }), or among the pages of a group, before the one at `at` there or after the last ({ group: name,
  // at }); a group or a page beside an item at the top of the list ({ index, side: 'before' | 'after' }).
  const [dragged, setDragged] = useState(null)
  const [drop, setDrop] = useState(null)
  // Changes to the arrangement not saved yet, the latest last: a page moved into another group or out of any (`page`:
  // { slug, group }), the pages of a group in a new order (`pages`: { group, docs }), the top of the list in a new
  // order (`top`) — one change may hold all three. They show at once.
  const [pendingMoves, setPendingMoves] = useState([])
  const [orderError, setOrderError] = useState('')
  // Why a drop took nothing: the pages are sorted by name or by update, where no page has a place of its own.
  // `sortBlocked` tells that the dragged page is held over the pages of its own group in such a list.
  const [hint, setHint] = useState('')
  const sortBlocked = useRef(false)
  // Pins and unpins not saved yet, as [slug, pinned], the latest last. They show at once.
  const [pendingPins, setPendingPins] = useState([])
  const pinSaves = useRef(Promise.resolve())
  // Renames not saved yet, as { slug, title }, the latest last. They show at once too. Renames and moves are saved
  // one after another: both rewrite the page's file.
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
  // The page that was just moved (its file name): its row is tinted for a moment, to show where it arrived.
  const [arrived, setArrived] = useState(null)
  const navRef = useRef(null)
  const openedGroup = useRef(null)
  const appliedSort = useRef(sort)
  const movedGroup = useRef(null)
  const id = useId()
  const savedOrder = project.groupOrder
  const allDocs = useMemo(() => {
    const changes = [...pendingPages, ...pendingMoves.filter((move) => move.page).map((move) => move.page)]
    return changes.length
      ? project.docs.map((entry) => changes.reduce((page, { slug, ...change }) => slug === entry.slug ? { ...page, ...change } : page, entry))
      : project.docs
  }, [project.docs, pendingPages, pendingMoves])
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
  // The top of the list as it is being saved, after a group or a page was moved there; and the pages of each group
  // as an admin arranged them (`project.pageOrder`, as it will be once pending changes are saved).
  const pendingOrder = useMemo(() => pendingMoves.findLast((move) => move.top)?.top || null, [pendingMoves])
  const pageOrders = useMemo(() => {
    const orders = { ...project.pageOrder }
    for (const move of pendingMoves) if (move.pages) orders[move.pages.group] = move.pages.docs
    return orders
  }, [project.pageOrder, pendingMoves])
  // The top of the list: the groups, their pages sorted by the sort menu, and the pages outside any group, as an admin
  // arranged them. A moved group or page shows in its new place at once, while the change is being saved.
  const top = useMemo(() => {
    const groups = groupPages(docs.filter((entry) => entry.group)).map((group) => ({ ...group, items: sortPages(group.items, sort, pageOrders[group.name]) }))
    return arrangeTop(groups, sortPages(docs.filter((entry) => !entry.group), sort), pendingOrder || savedList)
  }, [docs, savedList, pendingOrder, pageOrders, sort])
  // In the Archived group: pages archived on their own (the name of their group beside them), then whole groups.
  const archivedPages = useMemo(() => sortPages(allDocs.filter((entry) => archivedDocs.has(entry.slug) && !archivedGroups.has(entry.group || '')), sort), [allDocs, archivedDocs, archivedGroups, sort])
  const archivedList = useMemo(() => {
    const groups = groupPages(allDocs.filter((entry) => archivedGroups.has(entry.group || ''))).map((group) => ({ ...group, items: sortPages(group.items, sort, pageOrders[group.name]) }))
    return arrangeTop(groups, [], savedList).map((item) => item.group)
  }, [allDocs, archivedGroups, savedList, pageOrders, sort])
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
  // An admin renames pages and moves them (a demo project stays as it ships). A page in a group moves among the
  // group's pages, into another group, or out of its group; a page outside any group, once there is anything else at
  // the top of the list — a group to go into, or a place beside it.
  const editable = owner && !project.demo
  const canMove = (entry) => editable && (!!entry.group || top.length > 1)
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
    setHint('')
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

  // A moved page comes into view where it arrived and shows there for a moment, and focus follows it when it was
  // moved from the keyboard: in another group its row is drawn anew.
  useEffect(() => {
    const moved = movedPage.current
    movedPage.current = null
    const link = moved && findLink(navRef.current, moved.slug, false)
    if (!link) return
    revealInList(navRef.current, link, true)
    if (moved.focus) link.focus()
    setArrived(moved.slug)
  }, [top, collapsed])
  useEffect(() => {
    if (!arrived) return
    const timer = setTimeout(() => setArrived(null), 1500)
    return () => clearTimeout(timer)
  }, [arrived])

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
    const track = (event) => {
      pointer = event.clientY
      // Outside the list, the page is no longer held over the pages of its group (see the note on a sorted list).
      if (!navRef.current?.contains(event.target)) sortBlocked.current = false
    }
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

  // Saves a change to the arrangement for everyone: a page into another group or out of any, in its file (`page`:
  // { slug, group }); then the order of a group's pages (`pages`: { group, docs }) and of the top of the list (`top`),
  // in the registry. Changes are saved one after another, in the order they were made; each shows at once, until it
  // is saved — or is undone if its save fails, down to what was saved before the failure.
  const saveMove = (change) => {
    setOrderError('')
    setHint('')
    setPendingMoves((current) => [...current, change])
    const post = async (url, body, failure) => {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: project.slug, ...body }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.error) throw new Error(data.error || failure)
    }
    pageSaves.current = pageSaves.current.then(async () => {
      try {
        if (change.page) await post('/api/doc/update', { doc: change.page.slug, group: change.page.group }, 'Could not save the page.')
        if (change.pages) await post('/api/order/pages', change.pages, 'Could not save the page order.')
        if (change.top) await post('/api/order/groups', { groups: change.top }, 'Could not save the group order.')
      } catch (error) {
        setOrderError(error.message || 'Could not save the change. Please try again.')
      }
      try { await onReorder?.() } catch {}
      setPendingMoves((current) => current.filter((item) => item !== change))
    })
  }

  // An item of the top of the list as it is saved, and the archived groups and pages, which keep their saved places.
  const savedName = (item) => item.group ? item.group.name : { doc: item.page.slug }
  const keptOrder = () => (pendingOrder || savedList).filter((entry) => typeof entry === 'string' ? archivedGroups.has(entry) : archivedDocs.has(entry?.doc))

  // The top of the list `next` as it is saved once `item` was moved to its place there: the items down to the last
  // group, `item`, or a page saved in its place before (pages outside any group below them stay unsaved, at the end,
  // in the order of the sort menu).
  const topOrder = (next, item) => {
    const end = next.findLastIndex((entry) => entry.group || entry.placed || entry === item)
    return [...next.slice(0, end + 1).map(savedName), ...keptOrder()]
  }

  // What to save for the top of the list to stand as `next` once a page has changed groups (`pages`: the pages as
  // they will be). Nothing (null) where the saved order and the order meta put it so already; else the list from its
  // start, as far down as it takes — what stands below keeps following the order meta and the sort menu, so a group
  // written later still finds its place among the groups nobody arranged.
  const topSave = (next, pages) => {
    const groups = groupPages(pages.filter((page) => page.group))
    const loose = sortPages(pages.filter((page) => !page.group), sort)
    const key = (item) => item.group ? `group:${item.group.name}` : `page:${item.page.slug}`
    const wanted = next.map(key)
    const stands = (saved) => {
      const list = arrangeTop(groups, loose, saved)
      return list.length === wanted.length && list.every((item, index) => key(item) === wanted[index])
    }
    if (stands(pendingOrder || savedList)) return null
    const names = next.map(savedName)
    let end = 1
    while (end < names.length && !stands(names.slice(0, end))) end += 1
    return [...names.slice(0, end), ...keptOrder()]
  }

  // Moves the item at `from` of the top of the list to the place before the item at `at` (at the end for its length),
  // and saves that order.
  const moveTop = (from, at) => {
    if (from < 0 || from >= top.length || at < 0 || at > top.length || at === from || at === from + 1) return
    const next = [...top]
    const [item] = next.splice(from, 1)
    next.splice(at > from ? at - 1 : at, 0, item)
    saveMove({ top: topOrder(next, item) })
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

  // Saves a rename in the page's file, where the sidebar reads its title. Renames and moves are saved one after
  // another, in the order they were made, and each shows until it is saved — or is undone if the save fails.
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

  // Moves a page into the group `name`, or to another place among the pages of its own. `at` is its place among the
  // group's other pages as they are listed — an index, or 'end' — and is saved as the group's order; left out, or
  // while the pages are sorted by name or by update, the page goes where the group's order puts it. A closed group
  // opens, so the page is seen to arrive. `focus` takes keyboard focus along to the page's new row; `reveal: false`
  // leaves the list where it is (a move made in the Pinned group).
  const movePage = (entry, name, { at, focus = false, reveal = true } = {}) => {
    if (!entry || !name) return
    const group = named.find((item) => item.name === name)
    const stays = (entry.group || '') === name
    const change = stays ? {} : { page: { slug: entry.slug, group: name } }
    if (group && at !== undefined && sort === 'order') {
      const others = group.items.filter((item) => item.slug !== entry.slug).map((item) => item.slug)
      const index = at === 'end' ? others.length : Math.max(0, Math.min(at, others.length))
      const order = [...others.slice(0, index), entry.slug, ...others.slice(index)]
      if (!stays || order.some((slug, place) => slug !== group.items[place].slug)) change.pages = { group: name, docs: order }
    }
    if (!change.page && !change.pages) return
    // The groups stay where they stand. A group that isn't in the saved order has its place by the order meta of its
    // first page, so a page that changes groups could carry its new group — or leave its old one — to another place:
    // then the top of the list is saved as it stands, without the page's own row there or a group it leaves empty.
    if (change.page) {
      const stands = top.filter((item) => item.page ? item.page.slug !== entry.slug : item.group.name !== entry.group || item.group.items.length > 1)
      const order = topSave(stands, docs.map((page) => page.slug === entry.slug ? { ...page, group: name } : page))
      if (order) change.top = order
    }
    if (collapsed.has(name)) onToggle(name)
    if (reveal) movedPage.current = { slug: entry.slug, focus }
    saveMove(change)
  }

  // Takes a page out of its group, to the place before the item at `at` of the top of the list (at the end for its
  // length); the top of the list is saved as far down as it takes for the page to stand there. A group left without
  // a page goes with it.
  const ungroupPage = (entry, at, { focus = false, reveal = true } = {}) => {
    if (!entry?.group) return
    const next = [...top]
    const from = next.findIndex((item) => item.group?.name === entry.group)
    let index = Math.max(0, Math.min(at, next.length))
    if (from >= 0 && next[from].group.items.length === 1) {
      next.splice(from, 1)
      if (index > from) index -= 1
    }
    next.splice(index, 0, { page: { ...entry, group: '' }, placed: true })
    const order = topSave(next, docs.map((page) => page.slug === entry.slug ? { ...page, group: '' } : page))
    if (reveal) movedPage.current = { slug: entry.slug, focus }
    saveMove({ page: { slug: entry.slug, group: '' }, ...(order && { top: order }) })
  }

  // Puts a page into the group `name`: at the end of a group of that name already there, or in a new group. A new
  // group gets a place of its own at the top of the list: right after the group the page was in (in that group's
  // place, when the page was its only one); in the page's own place, when it was outside any group and an admin had
  // put it there; or right above the pages outside any group that follow the sort menu. Where the order meta of the
  // page wouldn't put the group there by itself, the top of the list is saved as far down as it takes.
  const groupPage = (entry, name, { focus = false, reveal = true } = {}) => {
    if (named.some((group) => group.name === name)) return movePage(entry, name, { at: 'end', focus, reveal })
    const item = { group: { name, items: [{ ...entry, group: name }] } }
    const next = [...top]
    if (entry.group) {
      const from = next.findIndex((other) => other.group?.name === entry.group)
      const alone = from >= 0 && next[from].group.items.length === 1
      next.splice(from < 0 ? next.length : alone ? from : from + 1, alone ? 1 : 0, item)
    } else {
      const from = next.findIndex((other) => other.page?.slug === entry.slug)
      const end = next.findLastIndex((other) => other.group || other.placed)
      if (from >= 0) next.splice(from, 1)
      next.splice(from >= 0 && from <= end ? from : end + 1, 0, item)
    }
    const order = topSave(next, docs.map((page) => page.slug === entry.slug ? { ...page, group: name } : page))
    if (collapsed.has(name)) onToggle(name)
    if (reveal) movedPage.current = { slug: entry.slug, focus }
    saveMove({ page: { slug: entry.slug, group: name }, ...(order && { top: order }) })
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
  // A page goes into the group named in the field above it — a new group, or one of that name already there — out
  // of the group it was in: Enter saves it and keyboard focus goes along to the page there, and leaving the field
  // saves it too. Escape, no name, or the name of its own group leaves the page where it was. An archived group's
  // name is refused: the page would be archived with that group. A page's row in the Pinned group stays where it is.
  const endNewGroup = (entry, name, fromKeyboard) => {
    const row = endEdit(entry)
    if (!row) return
    const text = oneLine(name)
    const refused = archivedGroups.has(text)
    const stays = !text || refused || text === (entry.group || '')
    if (fromKeyboard && (stays || row.pinned)) editedRow.current = row
    if (refused) setOrderError(`“${text}” is an archived group. Unarchive it first, or choose another name.`)
    else if (!stays) groupPage(entry, text, { focus: fromKeyboard, reveal: !row.pinned })
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
  // The rows of the pages a group lists (data-row), in its order.
  const rowsOf = (group) => [...group.querySelectorAll(':scope > div > [data-row]')]
  // A dragged page goes where the pointer holds it. Over the pages of a group: among them, before the page whose upper
  // half is under the pointer, or after the one whose lower half is — but while they are sorted by name or by update,
  // where no page has a place of its own, it only joins another group. On a group's heading: into that group, at its
  // end; or, from the top edge of the heading (and the bottom edge, of a closed group), out of any group to the place
  // above (below) that group at the top of the list. On a page outside any group, by the half of it under the pointer,
  // or in the gap between two items at the top of the list: out of any group, to that place. A drop that would leave
  // the page where it is takes nothing.
  const pageDropAt = (event, slug) => {
    sortBlocked.current = false
    const entry = docs.find((item) => item.slug === slug)
    if (!entry) return null
    const target = topAt(event)
    const name = target?.element.dataset.group
    const y = event.clientY
    let place = null
    if (name !== undefined) {
      const box = target.element.firstElementChild.getBoundingClientRect()
      const edge = box.height / 4
      if (y > box.bottom) {
        const own = name === entry.group
        if (sort !== 'order') {
          sortBlocked.current = own
          return own ? null : { into: name }
        }
        const rows = rowsOf(target.element)
        const below = rows.findIndex((row) => { const rect = row.getBoundingClientRect(); return y < rect.top + rect.height / 2 })
        const at = below < 0 ? rows.length : below
        const from = own ? rows.findIndex((row) => row.dataset.row === slug) : -1
        return from >= 0 && (at === from || at === from + 1) ? null : { group: name, at }
      }
      if (y < box.top + edge) place = { index: target.index, side: 'before' }
      else if (collapsed.has(name) && y > box.bottom - edge) place = { index: target.index, side: 'after' }
      else return name === entry.group ? null : { into: name }
    } else if (target) {
      const box = target.element.getBoundingClientRect()
      place = { index: target.index, side: y < box.top + box.height / 2 ? 'before' : 'after' }
    } else if (event.target === navRef.current && top.length) {
      const below = topElements().findIndex((element) => element.getBoundingClientRect().top > y)
      place = below < 0 ? { index: top.length - 1, side: 'after' } : { index: below, side: 'before' }
    } else return null
    if (entry.group) return place
    const from = top.findIndex((item) => item.page?.slug === slug)
    const at = place.side === 'before' ? place.index : place.index + 1
    return at === from || at === from + 1 ? null : place
  }
  const dropAt = (event) => !dragged ? null : dragged.group !== undefined ? groupDropAt(event, dragged.group) : pageDropAt(event, dragged.page)
  const dragOverList = (event) => {
    if (!dragged) return
    const place = dropAt(event)
    setDrop((current) => samePlace(current, place) ? current : place)
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
        const entry = dragged.page === undefined ? null : docs.find((item) => item.slug === dragged.page)
        if (place.into !== undefined) movePage(entry, place.into, { at: 'end' })
        else if (place.group !== undefined) {
          // Among the group's other pages: its own row, above the place, is not counted.
          const own = entry.group === place.group ? named.find((group) => group.name === place.group)?.items.findIndex((item) => item.slug === entry.slug) ?? -1 : -1
          movePage(entry, place.group, { at: own >= 0 && place.at > own ? place.at - 1 : place.at })
        } else {
          const at = place.side === 'before' ? place.index : place.index + 1
          if (entry?.group) ungroupPage(entry, at)
          else moveTop(top.findIndex((item) => dragged.group !== undefined ? item.group?.name === dragged.group : item.page?.slug === dragged.page), at)
        }
      }
      endDrag()
    },
  }
  // An admin's page link. Dragged, the page goes where it is dropped: among the pages of a group, into a group, or out
  // of any group to a place at the top of the list. Alt with the up or down arrow moves it a place up or down among
  // the pages of its group, and from the group's first or last place into the group above (at its end) or below (at
  // its start) — a page outside any group goes into the nearest group above or below it the same way. While the pages
  // are sorted by name or by update, the arrows take it straight to that group. F2 edits its title, and a right click,
  // a long press, or Shift+F10 opens its menu. `pinned` is the page's row in the Pinned group, which stays where it is
  // (`index` its place there). An archived page's row only has the menu and F2.
  const pageHandlers = (entry, pinned, index, archived) => {
    if (!editable) return {}
    const target = { kind: 'page', entry, index }
    const moves = canMove(entry) && !archived
    return {
      ...(moves && {
        draggable: true,
        onDragStart: (event) => {
          event.dataTransfer.effectAllowed = 'all'
          sortBlocked.current = false
          setDragged({ page: entry.slug })
        },
        // A page let go over the pages of its own group while they are sorted: the list says why it took nothing.
        // The note of an earlier drag goes here too, not when the next drag starts: taking it away then would move
        // the list under the pointer, and a browser gives up a drag whose source moves as it starts.
        onDragEnd: () => {
          setHint(sortBlocked.current ? sortHints[sort] || '' : '')
          sortBlocked.current = false
          endDrag()
        },
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
        const arranged = sort === 'order'
        const at = top.findIndex((item) => entry.group ? item.group?.name === entry.group : item.page?.slug === entry.slug)
        // A place up or down among the pages of its group, while there is one.
        const pages = arranged && entry.group ? top[at]?.group.items : null
        const to = pages ? pages.findIndex((item) => item.slug === entry.slug) + (up ? -1 : 1) : -1
        if (pages && to >= 0 && to < pages.length) {
          movePage(entry, entry.group, { at: to, focus: true, reveal: !pinned })
          return
        }
        // Then into the nearest group above, at its end, or below, at its start.
        const into = (up ? top.slice(0, at).reverse() : top.slice(at + 1)).find((item) => item.group)?.group
        if (into) movePage(entry, into.name, { at: arranged ? (up ? 'end' : 0) : undefined, focus: true, reveal: !pinned })
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
        draggable: true,
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
        if (from < 0 || at < 0 || at > top.length) return
        movedGroup.current = name
        moveTop(from, at)
      },
    }
  }
  // The line shows where the dragged item lands: beside the item of the top of the list at `index`, or — a page
  // among the pages of a group — above the group's page at `slot.at`, or below its last one.
  const dropMarker = (index) => drop?.index === index ? (drop.side === 'before' ? styles.dropBefore : styles.dropAfter) : ''
  const slotMarker = (slot) => !slot || drop?.group !== slot.group ? '' : drop.at === slot.at ? styles.dropBefore : slot.last && drop.at === slot.at + 1 ? styles.dropAfter : ''

  // A page row: the link, and for a signed-in reader the pin at its end. In the Pinned group (`index` is the row's
  // place there) the link also names the page's own group, since pages of different groups often share a title. A
  // page outside any group, at the top of the list (`place` its index there), is marked for dragging with data-loose;
  // a page listed in its group (`slot`: the group, the page's place `at` there, and whether it is the `last`), with
  // data-row.
  const documentRow = (entry, index, { archived = false, withGroup = false, place, slot } = {}) => {
    const pinned = pinnedSlugs.includes(entry.slug)
    const inPinned = index !== undefined
    const context = (inPinned || withGroup) && entry.group
    const edited = editing?.slug === entry.slug && editing.pinned === inPinned && editing.field
    // At the top of the list a page shares the keys of the groups beside it.
    const key = place === undefined ? entry.slug : `page:${entry.slug}`
    const mark = place !== undefined ? { 'data-loose': entry.slug } : slot ? { 'data-row': entry.slug } : {}
    const marker = place !== undefined ? dropMarker(place) : slotMarker(slot)
    if (edited === 'title') return (
      <div key={key} className={styles.documentRow} {...mark}>
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
      <div key={key} {...(edited ? {} : mark)} className={`${styles.documentRow} ${authed && !archived ? styles.pinnableRow : ''} ${editable ? styles.editableRow : ''} ${pinned ? styles.pinnedRow : ''} ${archived ? styles.archivedRow : ''} ${dragged?.page === entry.slug ? styles.draggingPage : ''} ${arrived === entry.slug && !inPinned ? styles.arrivedRow : ''} ${menu?.kind === 'page' && menu.entry.slug === entry.slug && (menu.index !== undefined) === inPinned ? styles.menuRow : ''} ${edited ? '' : marker}`}>
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
      <div key={key} className={`${styles.newGroup} ${marker}`} {...mark}>
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
      {editable && <p id={`${id}-edit`} className={styles.visuallyHidden}>Drag a page to another place among the pages of its group, into another group, or between the groups to take it out of its group. Alt with the up or down arrow moves it a place up or down, and on into the next group. Press F2 to rename a page, or Shift+F10 for its menu, which also moves it into a new group, takes it out of its group, and archives it. Shift+F10 on a group opens the group's menu.</p>}
      {orderError && <p className={styles.navigationError} role="alert">{orderError}</p>}
      {hint && !orderError && <p className={styles.navigationNote} role="status">{hint}</p>}
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
              {group.items.map((entry, at) => documentRow(entry, undefined, { slot: { group: group.name, at, last: at === group.items.length - 1 } }))}
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
          {menu.kind === 'page' && !archivedDocs.has(menu.entry.slug) && !inArchivedGroup(menu.entry) && <button type="button" role="menuitem" className={styles.pageMenuItem}
            onClick={() => { const { entry, index } = menu; closeMenu(false); startEdit(entry, index !== undefined, 'group') }}>
            <Icon name="folderPlus" size={14} /><span>Move to new group</span>
          </button>}
          {menu.kind === 'page' && menu.entry.group && !archivedDocs.has(menu.entry.slug) && !inArchivedGroup(menu.entry) && <button type="button" role="menuitem" className={styles.pageMenuItem}
            onClick={() => {
              // The page lands right below the group it leaves. Its row in the Pinned group stays, with focus.
              const { entry, index } = menu
              const inPinned = index !== undefined
              closeMenu(inPinned)
              ungroupPage(entry, top.findIndex((item) => item.group?.name === entry.group) + 1, { focus: !inPinned, reveal: !inPinned })
            }}>
            <Icon name="folderOutput" size={14} /><span>Remove from group</span>
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
