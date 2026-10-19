'use client'

import React, { forwardRef, useEffect, useId, useMemo, useRef, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Icon, IconButton, Spinner } from '../../components/ui/index.jsx'
import styles from './search.module.css'

const RECENT_LIMIT = 8
const DEBOUNCE_MS = 120

const isApple = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '')

// The shortcut as the keyboard in front of the reader names it: ⌘K on a Mac, Ctrl+K elsewhere. Read after
// mount, so the server and the first client render agree.
export function useShortcutLabel() {
  const [label, setLabel] = useState('Ctrl+K')
  useEffect(() => { if (isApple()) setLabel('⌘K') }, [])
  return label
}

// ⌘K (Ctrl+K elsewhere) toggles the search from anywhere on the page, a text field included: the browser has
// no use for the key that matters here. `code` names the physical key, so the shortcut works under an IME too.
export function useSearchShortcut(onToggle) {
  useEffect(() => {
    if (!onToggle) return
    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.repeat) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.code !== 'KeyK' && String(event.key).toLowerCase() !== 'k') return
      event.preventDefault()
      onToggle()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onToggle])
}

// The icon that opens the search, with the shortcut in its tooltip.
export const SearchButton = forwardRef(function SearchButton({ onClick, className, size }, ref) {
  const shortcut = useShortcutLabel()
  return <IconButton ref={ref} icon="search" label="Search documents" title={`Search documents (${shortcut})`}
    aria-keyshortcuts="Meta+K Control+K" onClick={onClick} className={className} size={size} />
})

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// `text` with every occurrence of the terms marked.
function Highlight({ text, terms }) {
  if (!text) return null
  if (!terms.length) return text
  const parts = text.split(new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'giu'))
  return parts.map((part, index) => (index % 2 ? <mark key={index}>{part}</mark> : part))
}

const hrefOf = (item) => `/p/${encodeURIComponent(item.slug)}/${encodeURIComponent(item.doc)}`

// The search palette: one field over every page the reader may open, results beneath it, ↑↓ and ↵ to move
// and open. Without a query it lists the pages updated last. Opened from `/p/<slug>`, `currentSlug` is that
// project, whose pages rank above equal matches elsewhere.
export default function GlobalSearch({ open, onClose, index, currentSlug = null }) {
  const id = useId()
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const returnFocus = useRef(null)
  const scrollToActive = useRef(false)
  const [query, setQuery] = useState('')
  const [response, setResponse] = useState(null) // the last answer: { query, terms, total, results }
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [active, setActive] = useState(0)
  const shortcut = useShortcutLabel()
  const trimmed = query.trim()

  // Closed, the search forgets its query, so it opens clean next time (the dialog is unmounted while closed,
  // so nothing of this shows).
  useEffect(() => {
    if (open) return
    setQuery('')
    setResponse(null)
    setError('')
    setActive(0)
  }, [open])

  // Fetch the pages matching the query once typing pauses; a newer query cancels the fetch of an older one.
  useEffect(() => {
    if (!open || !trimmed) { setSearching(false); return }
    const controller = new AbortController()
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: trimmed })
        if (currentSlug) params.set('from', currentSlug)
        const res = await fetch(`/api/search?${params}`, { signal: controller.signal })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `Search failed (${res.status})`)
        setResponse(data)
        setError('')
        setActive(0)
        scrollToActive.current = true
      } catch (fetchError) {
        if (controller.signal.aborted) return
        setError(fetchError.message || 'Could not search. Please try again.')
      } finally {
        if (!controller.signal.aborted) setSearching(false)
      }
    }, DEBOUNCE_MS)
    return () => { clearTimeout(timer); controller.abort() }
  }, [open, trimmed, currentSlug])

  // Without a query: the pages updated last among those the reader may open (hidden projects stay out of the
  // way here as in the hub, except the one the reader is in).
  const recent = useMemo(() => {
    const hidden = new Set(index?.hidden || [])
    const docs = []
    for (const project of index?.projects || []) {
      if (hidden.has(project.slug) && project.slug !== currentSlug) continue
      for (const doc of project.docs) {
        if (doc.mtime) docs.push({ slug: project.slug, project: project.title, demo: !!project.demo, doc: doc.slug, title: doc.title, group: doc.group, date: doc.date, mtime: doc.mtime })
      }
    }
    return docs.sort((a, b) => b.mtime - a.mtime).slice(0, RECENT_LIMIT)
  }, [index, currentSlug])

  const showingRecent = !trimmed
  // While a new query is being answered, the previous answer stays in place: the list does not blink empty.
  const answered = !showingRecent && response && response.query === trimmed ? response : null
  const shown = showingRecent ? recent : (answered || response)?.results || []
  const total = showingRecent ? recent.length : (answered || response)?.total ?? shown.length
  const terms = showingRecent ? [] : (answered || response)?.terms || trimmed.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const activeItem = shown[active]
  const optionId = (position) => `${id}-option-${position}`

  // Moved from the keyboard, the active row is kept in view; the pointer picks rows without moving the list.
  useEffect(() => {
    if (!open || !scrollToActive.current) return
    scrollToActive.current = false
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [active, shown, open])

  const move = (step) => {
    if (!shown.length) return
    scrollToActive.current = true
    setActive((current) => (current + step + shown.length) % shown.length)
  }
  const onKeyDown = (event) => {
    if (event.isComposing || event.nativeEvent?.isComposing) return
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1) }
    else if (event.key === 'Enter' && activeItem) {
      event.preventDefault()
      const href = hrefOf(activeItem)
      if (event.metaKey || event.ctrlKey) window.open(href, '_blank', 'noopener')
      else window.location.assign(href)
    }
  }

  const label = showingRecent ? 'Recent documents' : `${shown.length < total ? `${shown.length} of ${total}` : total} ${total === 1 ? 'result' : 'results'}`
  const status = searching ? 'Searching…' : showingRecent ? '' : answered ? `${total} ${total === 1 ? 'result' : 'results'} for ${trimmed}` : ''

  // Focus lands in the field; closed, the search hands it back to where it was (the icon that opened it, or
  // the field the reader was typing in when pressing the shortcut). The dialog has no trigger of its own to
  // return focus to, so this is done here rather than left to it.
  const onOpenAutoFocus = (event) => {
    event.preventDefault()
    returnFocus.current = document.activeElement
    inputRef.current?.focus()
  }
  const onCloseAutoFocus = (event) => {
    event.preventDefault()
    const target = returnFocus.current
    if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true })
  }

  return <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose?.() }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={styles.overlay} />
      <DialogPrimitive.Content className={styles.palette} aria-describedby={undefined} onOpenAutoFocus={onOpenAutoFocus} onCloseAutoFocus={onCloseAutoFocus}>
        <DialogPrimitive.Title className={styles.visuallyHidden}>Search documents</DialogPrimitive.Title>
        <div className={styles.inputRow}>
          {searching ? <Spinner size={18} /> : <Icon name="search" size={18} />}
          <input ref={inputRef} className={styles.input} type="text" role="combobox" aria-label="Search documents"
            aria-expanded="true" aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={activeItem ? optionId(active) : undefined}
            placeholder="Search all documents…" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} />
          {query ? <IconButton icon="x" label="Clear search" size="sm" onClick={() => { setQuery(''); inputRef.current?.focus() }} />
            : <kbd className={styles.kbd} aria-hidden="true">esc</kbd>}
        </div>
        <div ref={listRef} className={styles.results}>
          {shown.length > 0 && <>
            <div id={`${id}-label`} className={styles.groupLabel}>{label}</div>
            <div id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`}>
              {shown.map((item, position) => <a key={`${item.slug}/${item.doc}`} id={optionId(position)} role="option" aria-selected={position === active}
                href={hrefOf(item)} className={styles.option} onMouseMove={() => { if (active !== position) setActive(position) }}>
                <Icon name="file" size={16} />
                <span className={styles.optionBody}>
                  <span className={styles.optionTitle} data-part="title"><Highlight text={item.title} terms={terms} /></span>
                  <span className={styles.optionMeta}>
                    <span data-part="project"><Highlight text={item.project} terms={terms} /></span>
                    {item.group && <span data-part="group"><Highlight text={item.group} terms={terms} /></span>}
                    {item.date && <span>{item.date}</span>}
                    {item.demo && <span>Demo</span>}
                  </span>
                  {item.excerpt && <span className={styles.optionExcerpt} data-part="excerpt"><Highlight text={item.excerpt} terms={terms} /></span>}
                </span>
                <kbd className={`${styles.kbd} ${styles.enterHint}`} aria-hidden="true">↵</kbd>
              </a>)}
            </div>
          </>}
          {shown.length === 0 && (error && !showingRecent ? <p className={`${styles.status} ${styles.statusError}`} role="alert">{error}</p>
            : showingRecent ? <p className={styles.status}>Type to search every document you can open — by title, group, project or the words on the page.</p>
            : answered ? <p className={styles.status}>No documents match <strong>{trimmed}</strong>.</p>
            : <p className={styles.status}>Searching…</p>)}
        </div>
        <div className={styles.footer} aria-hidden="true">
          <span><span><kbd className={styles.kbd}>↑</kbd><kbd className={styles.kbd}>↓</kbd></span>Move</span>
          <span><kbd className={styles.kbd}>↵</kbd>Open</span>
          <span><kbd className={styles.kbd}>{shortcut}</kbd>Close</span>
        </div>
        <div className={styles.visuallyHidden} role="status" aria-live="polite">{status}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}
