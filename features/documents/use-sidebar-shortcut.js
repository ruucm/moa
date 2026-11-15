'use client'

import { useEffect, useRef, useState } from 'react'
import { isApple } from '../search/GlobalSearch.jsx'

// ⌘B on a Mac, Ctrl+B elsewhere — the key editors give their sidebar. Only the platform's own modifier counts:
// on a Mac, Ctrl+B moves the caret back a letter in a text field, and that keeps working. The letter is read from
// `key` when the layout types Latin letters (so Dvorak's ⌘X stays cut), and from the physical key otherwise, so
// the shortcut also works with a Korean or Russian input method on.
const isToggle = (event, apple) => {
  if (event.altKey || event.shiftKey) return false
  if (apple ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return false
  const key = String(event.key).toLowerCase()
  return /^[a-z]$/.test(key) ? key === 'b' : event.code === 'KeyB'
}

// Calls `onToggle` for the shortcut from anywhere on the page, a text field included, as ⌘K does for the search.
// A rich text field keeps ⌘B for bold. Held down, the key toggles once. `null` leaves the key to the browser.
export function useSidebarShortcut(onToggle) {
  const latest = useRef(onToggle)
  useEffect(() => { latest.current = onToggle })
  const enabled = !!onToggle
  useEffect(() => {
    if (!enabled) return
    const apple = isApple()
    const onKeyDown = (event) => {
      if (event.defaultPrevented || !isToggle(event, apple)) return
      if (event.target instanceof HTMLElement && event.target.isContentEditable) return
      event.preventDefault()
      if (!event.repeat) latest.current?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}

// The shortcut as the keyboard in front of the reader names it, for the toggles' tooltips and `aria-keyshortcuts`.
// Read after mount, so the server and the first client render agree.
export function useSidebarShortcutLabel() {
  const [apple, setApple] = useState(false)
  useEffect(() => { setApple(isApple()) }, [])
  return apple ? { label: '⌘B', keys: 'Meta+B' } : { label: 'Ctrl+B', keys: 'Control+B' }
}

// Whether a modal dialog covers the page — the search, a zoomed picture, a presentation, the assistant's drawer.
// Radix marks an open dialog with data-state, the presentation and a page's own viewer say aria-modal, a <dialog>
// opened with showModal() matches :modal. One that is in the page but not shown does not count.
const MODAL = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [aria-modal="true"], dialog[open]'
export function dialogOverPage() {
  return [...document.querySelectorAll(MODAL)].some((element) => {
    if (element.getClientRects().length === 0) return false
    if (element.localName !== 'dialog' || element.matches('[aria-modal="true"], [data-state="open"]')) return true
    try { return element.matches(':modal') } catch { return true }
  })
}
