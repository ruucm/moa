'use client'

import React, { forwardRef, useId, useRef } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import styles from './ui.module.css'

const cx = (...items) => items.filter(Boolean).join(' ')

const paths = {
  search: <><circle cx="10.75" cy="10.75" r="6.75"/><path d="m16 16 4.5 4.5"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  x: <path d="m6 6 12 12M18 6 6 18"/>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  chevronDown: <path d="m6 9 6 6 6-6"/>,
  chevronUp: <path d="m6 15 6-6 6 6"/>,
  chevronRight: <path d="m9 6 6 6-6 6"/>,
  arrowRight: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  arrowUpRight: <path d="M6 18 18 6M6 6h12v12"/>,
  arrowLeft: <path d="M20 12H4m6-6-6 6 6 6"/>,
  arrowUp: <path d="M12 20V4m-6 6 6-6 6 6"/>,
  arrowDown: <path d="M12 4v16m-6-6 6 6 6-6"/>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"/>,
  file: <><path d="M14 3H5v18h14V8Z"/><path d="M14 3v5h5M8 12h8M8 16h5"/></>,
  book: <><path d="M12 5v16M12 5C8 2 4 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-2-1-6-2-10 1Z"/></>,
  home: <><path d="m3 10 9-7 9 7v11H3Z"/><path d="M9 21v-8h6v8"/></>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  checkCircle: <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,
  link: <><path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M13 17a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1" transform="translate(0 -1) scale(.96)"/></>,
  users: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  history: <><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7"/><path d="M12 7v5l3 2"/></>,
  refresh: <><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/></>,
  settings: <><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 3 3-1 2 2 3-2 3 1 3-3-1-3 2-2-2-3-3-1-1-3Z"/><circle cx="12" cy="11" r="3"/></>,
  logOut: <><path d="M10 4H4v16h6M10 12h11m-4-4 4 4-4 4"/></>,
  sparkles: <><path d="m12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8Z"/><path d="m20 2 .7 1.3L22 4l-1.3.7L20 6l-.7-1.3L18 4l1.3-.7Z"/></>,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/></>,
  send: <><path d="m21 3-6 18-4-8-8-4Z"/><path d="m11 13 10-10"/></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2"/>,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>,
  alertCircle: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3v.1"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/></>,
  layers: <><path d="m12 3 10 5-10 5L2 8Zm-9 10 9 5 9-5m-18 5 9 4 9-4"/></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-6-6L3 21"/></>,
  play: <path d="m8 4 12 8-12 8Z"/>,
  archive: <><rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v13h14V8m-10 5h6"/></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></>,
  openExternal: <><path d="M14 3h7v7m0-7L10 14M10 4H4v16h16v-6"/></>,
  grip: <><path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"/></>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>,
}
const aliases = { close: 'x', logout: 'logOut', 'file-text': 'file', 'arrow-right':'arrowRight', 'arrow-left':'arrowLeft', 'arrow-up':'arrowUp', 'arrow-down':'arrowDown', 'chevron-down':'chevronDown', 'chevron-right':'chevronRight', 'chevron-up':'chevronUp', 'alert-circle':'alertCircle', 'check-circle':'checkCircle', 'external-link':'openExternal', 'log-out':'logOut', loader:'refresh' }

export function Icon({ name = 'file', size = 20, className, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={cx(styles.icon, className)} {...props}>{paths[aliases[name] || name] || paths.file}</svg>
}

export function BrandMark({ width = 35, height = 34, className, ...props }) {
  return <svg width={width} height={height} viewBox="0 0 36 36" fill="none" aria-hidden="true" focusable="false" className={cx(styles.brandMark, className)} {...props}><path d="M6 12h18M12 24h18" stroke="currentColor" strokeWidth="5" strokeLinecap="round" /></svg>
}

export function Brand({ compact = false, className }) {
  return <span className={cx(styles.brand, className)} role="img" aria-label="moa"><BrandMark />{!compact && <span className={styles.brandWord} aria-hidden="true">moa</span>}</span>
}

export const Button = forwardRef(function Button({ variant = 'secondary', size = 'md', loading = false, disabled, className, children, type = 'button', href, ...props }, ref) {
  const classNames = cx(styles.button, styles[variant], styles[size], className)
  if (href) return <a ref={ref} href={href} className={classNames} {...props}>{children}</a>
  return <button ref={ref} type={type} className={classNames} disabled={disabled || loading} aria-busy={loading || undefined} {...props}><span className={cx(styles.buttonContent, loading && styles.buttonContentLoading)}>{children}</span>{loading && <span className={styles.buttonSpinner}><Spinner size={16}/></span>}</button>
})

export const IconButton = forwardRef(function IconButton({ icon, label, children, className, size = 'md', ...props }, ref) {
  return <Button ref={ref} variant="ghost" size={size} className={cx(styles.iconButton, className)} aria-label={label} title={label} {...props}>{icon ? <Icon name={icon} size={size === 'sm' ? 18 : 20}/> : children}</Button>
})
export const Input = forwardRef(function Input({ className, ...props }, ref) { return <input ref={ref} className={cx(styles.input, className)} {...props}/> })
export const Textarea = forwardRef(function Textarea({ className, ...props }, ref) { return <textarea ref={ref} className={cx(styles.input, styles.textarea, className)} {...props}/> })

export function Field({ label, hint, error, children, className, htmlFor }) {
  const id = useId()
  const child = React.Children.only(children)
  const inputId = htmlFor || child.props.id || id
  const description = cx(child.props['aria-describedby'], hint && `${id}-hint`, error && `${id}-error`) || undefined
  return <div className={cx(styles.field, className)}><label className={styles.label} htmlFor={inputId}>{label}</label>{React.cloneElement(child, { id: inputId, 'aria-invalid': !!error || child.props['aria-invalid'], 'aria-describedby': description })}{hint && <p id={`${id}-hint`} className={styles.hint}>{hint}</p>}{error && <p role="alert" id={`${id}-error`} className={styles.fieldError}>{error}</p>}</div>
}

export function StatusBadge({ tone = 'neutral', children, className }) { return <span className={cx(styles.badge, styles[`tone_${tone}`], className)}>{children}</span> }
export function Surface({ as: Tag = 'div', className, children, ...props }) { return <Tag className={cx(styles.surface, className)} {...props}>{children}</Tag> }
export function Spinner({ size = 18 }) { return <svg className={styles.spinner} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity=".2"/><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg> }
export function Skeleton({ className }) { return <div aria-hidden="true" className={cx(styles.skeleton, className)}/> }
export function EmptyState({ icon = 'file', title, description, action, children, className }) {
  return <div className={cx(styles.empty, className)}><div className={styles.emptyIcon}><Icon name={icon} size={26}/></div><h2>{title}</h2>{description && <p>{description}</p>}{children}{action && <div className={styles.emptyAction}>{action}</div>}</div>
}
export function InlineAlert({ tone = 'info', title, children, className }) {
  return <div className={cx(styles.alert, styles[`tone_${tone}`], className)} role={tone === 'danger' ? 'alert' : 'status'}><Icon name={tone === 'success' ? 'checkCircle' : 'info'} size={19}/><div>{title && <strong>{title}</strong>}{children && <div>{children}</div>}</div></div>
}

function OverlayPanel({ open, onClose, title, description, children, footer, size = 'md', className, drawer = false, side = 'left' }) {
  const returnFocus = useRef(null)
  const descriptionId = useId()
  const rememberFocus = () => { returnFocus.current = document.activeElement }
  return <DialogPrimitive.Root open={open} onOpenChange={next => { if (!next) onClose?.() }}><DialogPrimitive.Portal><DialogPrimitive.Overlay className={styles.overlay}/><DialogPrimitive.Content className={cx(styles.dialog, size === 'lg' && styles.dialogLarge, drawer && styles.drawer, drawer && side === 'right' && styles.drawerRight, className)} onOpenAutoFocus={rememberFocus} onCloseAutoFocus={event => { event.preventDefault(); const target = returnFocus.current; if (target instanceof HTMLElement && target.isConnected) target.focus() }} aria-describedby={description ? descriptionId : undefined}><header className={styles.dialogHead}><div><DialogPrimitive.Title className={styles.dialogTitle}>{title}</DialogPrimitive.Title>{description && <DialogPrimitive.Description id={descriptionId} className={styles.dialogDescription}>{description}</DialogPrimitive.Description>}</div><DialogPrimitive.Close asChild><IconButton icon="x" label="Close"/></DialogPrimitive.Close></header><div className={styles.dialogBody}>{children}</div>{footer && <footer className={styles.dialogFooter}>{footer}</footer>}</DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>
}
export function Dialog(props) { return <OverlayPanel {...props}/> }
export function Drawer(props) { return <OverlayPanel {...props} drawer/> }
