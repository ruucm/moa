'use client'

// Click-to-zoom for document images.
// Every zoomable image on the page joins one gallery, collected from the DOM when the viewer
// opens — images never have to register with each other, so <Figure>, <MediaGrid> and plain
// Markdown images all share the same viewer and the same ←/→ navigation.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Icon } from '../ui/index.jsx'
import styles from './report.module.css'

const cx = (...names) => names.filter(Boolean).join(' ')
// The attribute wins over currentSrc: with a srcset the browser may have loaded a small
// candidate, and the viewer should show the source the document actually points at.
const fullSource = (node) => node.dataset.zoomSrc || node.getAttribute('src') || node.currentSrc || ''
const captionOf = (node) => node.dataset.zoomCap || node.alt || ''

// Gallery order is document order, read at open time so lazy or filtered images stay in sync.
function collectGallery(current) {
  const nodes = [...document.querySelectorAll('img[data-zoomable]')].filter(fullSource)
  return {
    items: nodes.map((node) => ({ node, src: fullSource(node), cap: captionOf(node) })),
    index: Math.max(0, nodes.indexOf(current)),
  }
}

function Lightbox({ items, index: openedAt, onClose }) {
  const [index, setIndex] = useState(openedAt)
  const item = items[index] || items[0]
  const many = items.length > 1
  const step = useCallback((delta) => setIndex((current) => (current + delta + items.length) % items.length), [items.length])

  useEffect(() => {
    if (!many) return
    const onKey = (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
      event.preventDefault()
      step(event.key === 'ArrowRight' ? 1 : -1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [many, step])

  // Closing returns to the image being viewed, which may not be the one that opened the viewer.
  const restoreFocus = (event) => {
    event.preventDefault()
    const node = item?.node
    if (node instanceof HTMLElement && node.isConnected) node.focus()
  }
  // The backdrop and the image both close; only the controls keep the viewer open.
  const closeUnlessControl = (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('button')) onClose()
  }

  return (
    <DialogPrimitive.Root open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={styles.zoomOverlay} />
        <DialogPrimitive.Content className={styles.zoomViewer} aria-describedby={undefined} onCloseAutoFocus={restoreFocus} onClick={closeUnlessControl}>
          <DialogPrimitive.Title className={styles.srOnly}>{item?.cap || 'Image viewer'}</DialogPrimitive.Title>
          <img className={styles.zoomImage} src={item?.src} alt={item?.cap || ''} />
          <button type="button" className={styles.zoomClose} onClick={onClose} aria-label="Close image viewer"><Icon name="x" size={20} /></button>
          {many && <>
            <button type="button" className={cx(styles.zoomStep, styles.zoomPrevious)} onClick={() => step(-1)} aria-label="Previous image"><Icon name="arrowLeft" size={20} /></button>
            <button type="button" className={cx(styles.zoomStep, styles.zoomNext)} onClick={() => step(1)} aria-label="Next image"><Icon name="arrowRight" size={20} /></button>
          </>}
          {(item?.cap || many) && <div className={styles.zoomCaption}>
            {item?.cap && <span>{item.cap}</span>}
            {many && <span className={styles.zoomCount}>{index + 1} / {items.length}</span>}
          </div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

// A drop-in <img> that opens the viewer. Keeps the plain <img> element so document CSS
// (centering, sizing, captions) keeps working exactly as before.
export function ZoomableImage({ className, alt, cap, zoom = true, zoomSrc, ...props }) {
  const node = useRef(null)
  const [gallery, setGallery] = useState(null)
  const open = () => setGallery(collectGallery(node.current))
  const label = alt ?? cap ?? ''

  if (!zoom) return <img className={className} alt={label} {...props} />
  return <>
    <img
      ref={node} className={cx(styles.zoomable, className)} alt={label} {...props}
      data-zoomable="" data-zoom-src={zoomSrc || undefined} data-zoom-cap={cap || undefined}
      role="button" tabIndex={0} aria-haspopup="dialog"
      onClick={open}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() } }}
    />
    {gallery && <Lightbox {...gallery} onClose={() => setGallery(null)} />}
  </>
}
