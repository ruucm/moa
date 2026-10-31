'use client'

// moa's own tabs: the pages a window keeps open side by side, in a strip across its top (features/tabs/TabStrip.jsx)
// that shows once there are two of them — like a browser's tab strip, or Notion's. Every page of moa is a full page
// load, so the tabs live in the window's sessionStorage: each window (each browser tab, each window of the installed
// app) has its own, a reload keeps them, and every page load picks up where the last one left them.
//
// The page on screen belongs to the active tab, which follows the reader wherever they go in it. Each history entry
// is tagged with the tab it was opened in (`history.state.moaTab`), so Back and Forward return to that tab, and a tab
// shown again comes back where the reader left it (its scroll position, restored once the page has rendered).

const KEY = 'moa.tabs'
const WINDOW = 'moa-window:'
const STOPS = ['wheel', 'touchstart', 'keydown', 'pointerdown']
const listeners = new Set()
let mine = null // the tab the page on screen belongs to
let watching = false

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

// The app's pages a tab holds: the hub and the reader. Elsewhere (the login page, a shared link) there are no tabs.
export const tabbable = (pathname) => pathname === '/' || /^\/p\/[^/]/.test(pathname)
const validHref = (href) => typeof href === 'string' && href.startsWith('/') && !href.startsWith('//') && tabbable(href.split(/[?#]/)[0])
const currentHref = () => window.location.pathname + window.location.search

// This window's id, kept in its name: a window opened from this one may start with a copy of its sessionStorage,
// and must not take over its tabs.
function windowId() {
  if (!window.name.startsWith(WINDOW)) window.name = WINDOW + newId()
  return window.name.slice(WINDOW.length)
}

export function readTabs() {
  const id = windowId()
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(KEY) || 'null')
    if (saved?.window === id && Array.isArray(saved.tabs)) {
      const tabs = saved.tabs.filter((tab) => tab && typeof tab.id === 'string' && validHref(tab.href))
      return { window: id, tabs, active: saved.active || null, restore: saved.restore || null }
    }
  } catch {}
  return { window: id, tabs: [], active: null, restore: null }
}

const storable = () => {
  try {
    window.sessionStorage.setItem(`${KEY}.check`, '1')
    window.sessionStorage.removeItem(`${KEY}.check`)
    return true
  } catch { return false }
}

function writeTabs(state) {
  try { window.sessionStorage.setItem(KEY, JSON.stringify(state)) } catch {}
  // The page's room for the strip (styles/base.css) — set before the first paint by the script in app/layout.jsx.
  document.documentElement.toggleAttribute('data-tabs', state.tabs.length > 1)
  for (const listener of listeners) listener(state)
}

export const subscribeTabs = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Tags the history entry on screen with the tab it belongs to. Next.js marks every entry it can restore (`__NA`) and
// reloads the page on Back to an entry whose state lacks the mark, so only an entry it has marked is tagged.
function tagEntry(id, retry = true) {
  const state = window.history.state
  if (state?.moaTab === id) return
  if (!state?.__NA) {
    if (retry) setTimeout(() => tagEntry(id, false), 0)
    return
  }
  window.history.replaceState({ ...state, moaTab: id }, '')
}

// The scroll position the reader leaves the page's tab at.
function remember(state) {
  const tab = state.tabs.find((entry) => entry.id === mine)
  if (tab && tab.href === currentHref()) tab.scroll = Math.round(window.scrollY)
}

function watchPage() {
  if (watching) return
  watching = true
  window.addEventListener('pagehide', () => {
    const state = readTabs()
    remember(state)
    try { window.sessionStorage.setItem(KEY, JSON.stringify(state)) } catch {}
  })
}

const navigationType = () => window.performance?.getEntriesByType?.('navigation')?.[0]?.type || 'navigate'

// Works out which tab the page on screen belongs to, as it loads or comes back from the back-forward cache
// (`traversal`): the tab its history entry was opened in; else, on Back or Forward, a tab already holding this
// address; else the active tab, which follows the reader to this page. Returns the scroll position to restore when
// the page was opened by showing its tab.
export function syncTabs(traversal = null) {
  watchPage()
  const type = navigationType()
  const back = traversal ?? type === 'back_forward'
  const state = readTabs()
  const href = currentHref()
  const active = state.tabs.find((tab) => tab.id === state.active)
  let tab = state.tabs.find((entry) => entry.id === window.history.state?.moaTab)
    || (back ? [active, ...state.tabs].find((entry) => entry?.href === href) : null)
    || active
  if (!tab) state.tabs.push((tab = { id: newId(), href, title: '', scroll: 0 }))
  let restore = null
  if (tab.href !== href) Object.assign(tab, { href, title: '', scroll: 0 })
  else if (!back && type === 'navigate' && state.restore?.id === tab.id && state.restore.href === href) restore = state.restore.y
  state.active = tab.id
  state.restore = null
  mine = tab.id
  writeTabs(state)
  tagEntry(tab.id)
  return restore
}

// Shows `tab`: its page, scrolled where the reader left it — in a new history entry, or in place of this one
// (`replace`). A tab holding the page on screen (two tabs may hold one page) takes over without a load.
function show(state, tab, replace = false) {
  state.active = tab.id
  if (tab.href === currentHref()) {
    state.restore = null
    mine = tab.id
    writeTabs(state)
    tagEntry(tab.id)
    window.scrollTo(0, tab.scroll || 0)
    return
  }
  state.restore = { id: tab.id, href: tab.href, y: tab.scroll || 0 }
  writeTabs(state)
  if (replace) window.location.replace(tab.href)
  else window.location.assign(tab.href)
}

// Opens `href` in a new tab beside the page's own (after the tabs it opened before, like a browser) and shows it.
// Where the window can't keep tabs (sessionStorage refused), the page opens in a new browser tab instead.
export function openTab(href, { title = '' } = {}) {
  if (!validHref(href) || !storable()) {
    window.open(href, '_blank', 'noopener')
    return
  }
  if (!mine) syncTabs()
  const state = readTabs()
  remember(state)
  let place = state.tabs.findIndex((tab) => tab.id === mine) + 1
  while (place < state.tabs.length && state.tabs[place].opener === mine) place += 1
  const tab = { id: newId(), href, title, scroll: 0, opener: mine }
  state.tabs.splice(place, 0, tab)
  show(state, tab)
}

export function switchTab(id) {
  const state = readTabs()
  const tab = state.tabs.find((entry) => entry.id === id)
  if (!tab || id === mine) return
  remember(state)
  show(state, tab)
}

// Closes a tab. The page's own tab gives its place on screen to the tab beside it (on its right, or else its left),
// in the same history entry, so Back doesn't bring the closed page back. The last tab stays.
export function closeTab(id) {
  const state = readTabs()
  const at = state.tabs.findIndex((tab) => tab.id === id)
  if (at < 0 || state.tabs.length < 2) return
  const [closed] = state.tabs.splice(at, 1)
  for (const tab of state.tabs) if (tab.opener === closed.id) tab.opener = closed.opener
  if (id !== mine) {
    writeTabs(state)
    return
  }
  show(state, state.tabs[at] || state.tabs[at - 1], true)
}

// Moves a tab to `before`, the place of the tab it goes in front of (the number of tabs: the end).
export function moveTab(id, before) {
  const state = readTabs()
  const from = state.tabs.findIndex((tab) => tab.id === id)
  if (from < 0 || before === from || before === from + 1) return
  const [tab] = state.tabs.splice(from, 1)
  state.tabs.splice(before > from ? before - 1 : before, 0, tab)
  writeTabs(state)
}

// Keeps the titles the strip shows with the tabs ({ id: title }), so the next page load shows them at once.
export function nameTabs(titles) {
  const state = readTabs()
  let changed = false
  for (const tab of state.tabs) {
    if (titles[tab.id] && tab.title !== titles[tab.id]) {
      tab.title = titles[tab.id]
      changed = true
    }
  }
  if (changed) writeTabs(state)
}

// Scrolls the page back to `y`. The page renders after it loads (the project list, then the page itself), so this
// tries again as the page grows, until it gets there and the page settles, the reader scrolls, taps or presses a
// key, or ten seconds pass.
export function restoreScroll(y) {
  if (!y || typeof ResizeObserver === 'undefined') return
  let settle = null
  const observer = new ResizeObserver(() => attempt())
  const stop = () => {
    observer.disconnect()
    clearTimeout(settle)
    clearTimeout(limit)
    for (const type of STOPS) window.removeEventListener(type, stop, true)
  }
  const attempt = () => {
    window.scrollTo(0, y)
    clearTimeout(settle)
    if (Math.abs(window.scrollY - y) < 2) settle = setTimeout(stop, 1500)
  }
  const limit = setTimeout(stop, 10000)
  for (const type of STOPS) window.addEventListener(type, stop, { capture: true, passive: true })
  observer.observe(document.body)
  attempt()
}
