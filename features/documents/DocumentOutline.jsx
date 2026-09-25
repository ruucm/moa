'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Icon, IconButton } from '../../components/ui/index.jsx'
import styles from './reader.module.css'

// Preserve authored anchors and reserve page-wide IDs before assigning missing ones.
export function collectHeadings(article) {
  const reserved = new Set(Array.from(document.querySelectorAll('[id]'), (node) => node.id))
  return Array.from(article.querySelectorAll('h2, h3')).filter((node) => node.textContent.trim()).map((node, index) => {
    if (!node.id) {
      const base = node.textContent.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').slice(0, 80) || `section-${index + 1}`
      let id = base
      let suffix = 2
      while (reserved.has(id)) id = `${base}-${suffix++}`
      node.id = id
      reserved.add(id)
    }
    return { id: node.id, text: node.textContent.trim(), level: Number(node.tagName.slice(1)), node }
  })
}

export default function DocumentOutline({ articleRef, documentKey, version, onHide, hideButtonRef }) {
  const [headings, setHeadings] = useState([])
  const [active, setActive] = useState('')
  const initialAnchor = useRef(null)
  useEffect(() => {
    const article = articleRef.current
    if (!article) return
    let scheduled = null
    let outline = []
    const updateActive = () => {
      let current = outline[0]?.id || ''
      for (const heading of outline) {
        if (heading.node.getBoundingClientRect().top <= 132) current = heading.id
      }
      setActive(current)
    }
    const collect = () => {
      outline = collectHeadings(article)
      setHeadings(outline)
      if (initialAnchor.current !== documentKey && window.location.hash) {
        let id
        try { id = decodeURIComponent(window.location.hash.slice(1)) } catch { id = window.location.hash.slice(1) }
        const target = document.getElementById(id)
        if (target && article.contains(target)) {
          target.scrollIntoView({ block: 'start' })
          initialAnchor.current = documentKey
        }
      }
      updateActive()
    }
    const onMutation = () => {
      cancelAnimationFrame(scheduled)
      scheduled = requestAnimationFrame(collect)
    }
    const observer = new MutationObserver(onMutation)
    observer.observe(article, { childList: true, subtree: true, characterData: true })
    collect()
    window.addEventListener('scroll', updateActive, { passive: true })
    window.addEventListener('resize', updateActive)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(scheduled)
      window.removeEventListener('scroll', updateActive)
      window.removeEventListener('resize', updateActive)
    }
  }, [articleRef, documentKey, version])

  if (headings.length < 2) return null
  const followHeading = (event, heading) => {
    event.preventDefault()
    history.replaceState(history.state, '', `#${encodeURIComponent(heading.id)}`)
    const previous = heading.node.getAttribute('tabindex')
    heading.node.setAttribute('tabindex', '-1')
    heading.node.focus({ preventScroll: true })
    heading.node.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
    heading.node.addEventListener('blur', () => {
      if (previous === null) heading.node.removeAttribute('tabindex')
      else heading.node.setAttribute('tabindex', previous)
    }, { once: true })
    setActive(heading.id)
  }
  return <aside className={styles.outline} aria-label="Document outline">
    <div className={styles.outlineHeading}>
      <span><Icon name="list" size={15} />On this page</span>
      {onHide && <IconButton ref={hideButtonRef} icon="panelRightClose" label="Hide outline" size="sm" onClick={onHide} />}
    </div>
    <nav>{headings.map((heading, index) => <a key={`${heading.id}-${index}`} href={`#${encodeURIComponent(heading.id)}`}
      className={`${styles.outlineLink} ${heading.level === 3 ? styles.outlineNested : ''} ${active === heading.id ? styles.outlineActive : ''}`}
      aria-current={active === heading.id ? 'location' : undefined} onClick={(event) => followHeading(event, heading)}>
      {heading.text}
    </a>)}</nav>
    <a className={styles.backToTop} href="#document-content"><Icon name="arrowUp" size={14} />Back to top</a>
  </aside>
}
