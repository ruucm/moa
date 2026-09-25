'use client'

import React, { useEffect, useId, useRef, useState } from 'react'
import { Icon, IconButton } from '../../components/ui/index.jsx'
import styles from './reader.module.css'

// The table of contents row only shows where the outline column exists (see .outlineOption).
const options = [
  { key: 'smallText', icon: 'textSize', label: 'Small text', hint: 'Fit more on the screen' },
  { key: 'fullWidth', icon: 'width', label: 'Full width', hint: 'Use the whole page width' },
  { key: 'outline', icon: 'list', label: 'Table of contents', hint: 'Headings on this page', className: styles.outlineOption },
]

// The page display menu: a switch per setting, kept for every document (see use-reader-view.js).
export default function ViewMenu({ view, onToggle }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const triggerRef = useRef(null)
  const panelRef = useRef(null)

  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector('button')?.focus()
    const dismiss = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return
      if (event.type === 'pointerdown' && (panelRef.current?.contains(event.target) || triggerRef.current?.contains(event.target))) return
      setOpen(false)
      if (event.type === 'keydown') triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismiss)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', dismiss) }
  }, [open])

  // Tabbing away closes the menu; clicks elsewhere are handled above.
  const leave = (event) => {
    const next = event.relatedTarget
    if (next && !panelRef.current?.contains(next) && !triggerRef.current?.contains(next)) setOpen(false)
  }

  return <div className={styles.viewMenu} onBlur={leave}>
    <IconButton ref={triggerRef} icon="sliders" label="View options" size="sm" aria-haspopup="true" aria-expanded={open}
      aria-controls={open ? id : undefined} onClick={() => setOpen((current) => !current)} />
    {open && <div id={id} ref={panelRef} className={styles.viewMenuPanel} role="group" aria-label="View options">
      {options.map((option) => <button key={option.key} type="button" role="switch" aria-checked={view[option.key]}
        className={`${styles.viewOption} ${option.className || ''}`} aria-labelledby={`${id}-${option.key}`}
        aria-describedby={`${id}-${option.key}-hint`} onClick={() => onToggle(option.key)}>
        <Icon name={option.icon} size={16} />
        <span className={styles.viewOptionText}>
          <span id={`${id}-${option.key}`}>{option.label}</span>
          <small id={`${id}-${option.key}-hint`}>{option.hint}</small>
        </span>
        <span className={styles.switch} aria-hidden="true"><span /></span>
      </button>)}
    </div>}
  </div>
}
