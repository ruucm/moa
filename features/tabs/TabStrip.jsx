'use client'

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Icon } from '../../components/ui/index.jsx'
import { fetchIndex, subscribeIndex } from '../../lib/client-store.js'
import { closeTab, moveTab, nameTabs, openTab, readTabs, restoreScroll, subscribeTabs, switchTab, syncTabs, tabbable } from '../../lib/tabs.js'
import styles from './tabs.module.css'

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
const decode = (value) => { try { return decodeURIComponent(value) } catch { return value } }

// What a tab shows: the title of the page it holds and the project it is in — from the project list once it is in,
// the title kept with the tab until then — or, for the hub, Projects.
function describe(tab, index) {
  const match = /^\/p\/([^/?#]+)(?:\/([^/?#]+))?/.exec(tab.href)
  if (!match) return { title: 'Projects', place: '', icon: 'home' }
  const slug = decode(match[1])
  const doc = match[2] ? decode(match[2]) : null
  const project = index?.projects?.find((entry) => entry.slug === slug)
  const page = project && (doc ? project.docs.find((entry) => entry.slug === doc) : project.docs[0])
  return { title: page?.title || tab.title || doc || project?.title || slug, place: project?.title || '', icon: 'file' }
}

// The tab a drop at `x` puts the dragged tab in front of (the number of tabs: after the last).
function dropPlace(list, x) {
  const items = [...list.children]
  const at = items.findIndex((item) => { const rect = item.getBoundingClientRect(); return x < rect.left + rect.width / 2 })
  return at < 0 ? items.length : at
}

// The tabs of this window (lib/tabs.js), in a strip fixed across the top of the window while there are two or more,
// and nowhere otherwise. A tab is a link to its page: a click shows it, the × or a middle click closes it, and a tab
// dragged along the strip moves there. The arrow keys go from tab to tab and Delete closes one. + opens the projects
// in a new tab.
export default function TabStrip() {
  const pathname = usePathname() || ''
  const on = tabbable(pathname)
  const [state, setState] = useState(null)
  const [index, setIndex] = useState(null)
  const [dragged, setDragged] = useState(null)
  const [dropAt, setDropAt] = useState(null)
  const listRef = useRef(null)
  const refocus = useRef(null)
  const id = useId()

  useBrowserLayoutEffect(() => {
    if (!on) {
      document.documentElement.removeAttribute('data-tabs')
      return
    }
    const restore = syncTabs()
    setState(readTabs())
    if (restore) restoreScroll(restore)
    const unsubscribe = subscribeTabs(setState)
    // Back to a page kept in the back-forward cache: its tab is worked out again, the tabs may have changed since.
    const onShow = (event) => { if (event.persisted) syncTabs(true) }
    window.addEventListener('pageshow', onShow)
    return () => {
      unsubscribe()
      window.removeEventListener('pageshow', onShow)
    }
  }, [on])

  const tabs = state?.tabs || []
  const shown = on && tabs.length > 1

  // The titles come from the project list, and change with it.
  useEffect(() => {
    if (!shown) return
    let alive = true
    fetchIndex().then((next) => { if (alive) setIndex(next) }).catch(() => {})
    const unsubscribe = subscribeIndex(setIndex)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [shown])

  useEffect(() => {
    if (index && state) nameTabs(Object.fromEntries(state.tabs.map((tab) => [tab.id, describe(tab, index).title])))
  }, [index, state])

  // The tab on screen stays in view when the tabs no longer fit and the strip scrolls sideways, and the wheel scrolls
  // the strip, rather than the page under it.
  useEffect(() => {
    if (shown) listRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [shown, state?.active])
  useEffect(() => {
    const list = listRef.current
    if (!shown || !list) return
    const onWheel = (event) => {
      if (list.scrollWidth <= list.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
      event.preventDefault()
      list.scrollLeft += event.deltaY
    }
    list.addEventListener('wheel', onWheel, { passive: false })
    return () => list.removeEventListener('wheel', onWheel)
  }, [shown])

  // Delete on a tab closes it, and focus goes to the tab that took its place.
  useEffect(() => {
    if (!refocus.current) return
    const next = listRef.current?.querySelector(`a[data-tab="${refocus.current}"]`)
    refocus.current = null
    next?.focus()
  }, [state])

  if (!shown) return null

  const links = () => [...(listRef.current?.querySelectorAll('a[data-tab]') || [])]
  const onKeyDown = (event, tab) => {
    const all = links()
    const at = all.indexOf(event.currentTarget)
    const focus = (place) => {
      event.preventDefault()
      all[(place + all.length) % all.length]?.focus()
    }
    if (event.key === 'ArrowRight') focus(at + 1)
    else if (event.key === 'ArrowLeft') focus(at - 1)
    else if (event.key === 'Home') focus(0)
    else if (event.key === 'End') focus(all.length - 1)
    else if (event.key === 'Delete') {
      event.preventDefault()
      refocus.current = (all[at + 1] || all[at - 1])?.dataset.tab || null
      closeTab(tab.id)
    }
  }
  // A plain click shows the tab; with a modifier key the browser does as it does with any link.
  const follow = (event, tab) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    switchTab(tab.id)
  }
  const endDrag = () => {
    setDragged(null)
    setDropAt(null)
  }
  const from = tabs.findIndex((tab) => tab.id === dragged)
  // The line shows where the dragged tab lands, when it would move.
  const marker = (position) => dropAt === null || dropAt === from || dropAt === from + 1 ? ''
    : dropAt === position ? styles.dropBefore : dropAt === tabs.length && position === tabs.length - 1 ? styles.dropAfter : ''

  return <nav className={styles.strip} aria-label="Tabs">
    <p id={`${id}-keys`} className={styles.visuallyHidden}>The arrow keys move between tabs. Delete closes a tab.</p>
    <ul ref={listRef} className={styles.tabs}
      onDragOver={(event) => {
        if (!dragged) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setDropAt(dropPlace(event.currentTarget, event.clientX))
      }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropAt(null) }}
      onDrop={(event) => {
        if (!dragged) return
        event.preventDefault()
        moveTab(dragged, dropPlace(event.currentTarget, event.clientX))
        endDrag()
      }}>
      {tabs.map((tab, position) => {
        const { title, place, icon } = describe(tab, index)
        const current = tab.id === state.active
        return <li key={tab.id} className={`${styles.tab} ${current ? styles.current : ''} ${dragged === tab.id ? styles.dragging : ''} ${marker(position)}`}
          onDragStart={(event) => {
            setDragged(tab.id)
            event.dataTransfer.effectAllowed = 'copyMove'
            event.dataTransfer.setData('text/uri-list', new URL(tab.href, window.location.href).href)
          }}
          onDragEnd={endDrag}>
          <a href={tab.href} data-tab={tab.id} className={styles.tabLink} aria-current={current ? 'page' : undefined}
            tabIndex={current ? 0 : -1} title={place ? `${title} — ${place}` : title} aria-describedby={`${id}-keys`} aria-keyshortcuts="Delete"
            onClick={(event) => follow(event, tab)} onKeyDown={(event) => onKeyDown(event, tab)}
            onMouseDown={(event) => { if (event.button === 1) event.preventDefault() }}
            onAuxClick={(event) => {
              if (event.button !== 1) return
              event.preventDefault()
              closeTab(tab.id)
            }}>
            <Icon name={icon} size={14} />
            <span className={styles.tabTitle}>{title}</span>
          </a>
          <button type="button" className={styles.tabClose} tabIndex={-1} aria-label={`Close ${title}`} title="Close tab"
            onClick={() => closeTab(tab.id)}>
            <Icon name="x" size={14} />
          </button>
        </li>
      })}
    </ul>
    <button type="button" className={styles.newTab} aria-label="New tab" title="New tab" onClick={() => openTab('/', { title: 'Projects' })}>
      <Icon name="plus" size={16} />
    </button>
  </nav>
}
