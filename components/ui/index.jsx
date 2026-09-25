'use client'

import React, { forwardRef, useId, useRef } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { ALargeSmall, Archive, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronRight, ChevronUp, CircleAlert, CircleCheck, Clock, Copy, Ellipsis, ExternalLink, Eye, FileText, Folder, GripVertical, History, House, ImageIcon, Info, Layers, LinkIcon, List, Lock, LogOut, Menu, MoveHorizontal, PanelLeft, PanelLeftClose, Pencil, Play, Plus, RefreshCw, Search, Send, Settings, ShieldCheck, SlidersHorizontal, Sparkles, Square, SquareTerminal, Trash2, Users, X } from 'lucide-react'
import styles from './ui.module.css'

const cx = (...items) => items.filter(Boolean).join(' ')

// The icon set is Lucide (lucide.dev, ISC). Map a MOA name here before using a new glyph.
const icons = {
  search: Search, plus: Plus, x: X, menu: Menu,
  chevronDown: ChevronDown, chevronUp: ChevronUp, chevronRight: ChevronRight,
  arrowRight: ArrowRight, arrowUpRight: ArrowUpRight, arrowLeft: ArrowLeft, arrowUp: ArrowUp, arrowDown: ArrowDown,
  folder: Folder, file: FileText, book: BookOpen, home: House, more: Ellipsis,
  check: Check, checkCircle: CircleCheck, link: LinkIcon, users: Users, clock: Clock, history: History, refresh: RefreshCw,
  settings: Settings, logOut: LogOut, sparkles: Sparkles, terminal: SquareTerminal, send: Send, stop: Square, copy: Copy,
  alertCircle: CircleAlert, info: Info, lock: Lock, shield: ShieldCheck, layers: Layers, image: ImageIcon, play: Play,
  archive: Archive, eye: Eye, trash: Trash2, openExternal: ExternalLink, grip: GripVertical, list: List,
  panelLeft: PanelLeft, panelLeftClose: PanelLeftClose, sliders: SlidersHorizontal, textSize: ALargeSmall, width: MoveHorizontal, edit: Pencil,
}
const aliases = { close: 'x', logout: 'logOut', 'file-text': 'file', 'arrow-right':'arrowRight', 'arrow-left':'arrowLeft', 'arrow-up':'arrowUp', 'arrow-down':'arrowDown', 'chevron-down':'chevronDown', 'chevron-right':'chevronRight', 'chevron-up':'chevronUp', 'alert-circle':'alertCircle', 'check-circle':'checkCircle', 'external-link':'openExternal', 'log-out':'logOut', loader:'refresh' }
export const iconNames = Object.keys(icons)

export function Icon({ name = 'file', size = 20, className, ...props }) {
  const Glyph = icons[aliases[name] || name] || icons.file
  return <Glyph size={size} strokeWidth={1.65} aria-hidden="true" focusable="false" className={cx(styles.icon, className)} {...props}/>
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

function OverlayPanel({ open, onClose, title, description, children, footer, size = 'md', className, drawer = false, side = 'left', initialFocus }) {
  const returnFocus = useRef(null)
  const descriptionId = useId()
  // Focus lands on `initialFocus` when given (a form's first field), otherwise on the first control.
  const rememberFocus = (event) => {
    returnFocus.current = document.activeElement
    const target = initialFocus?.current
    if (target instanceof HTMLElement) { event.preventDefault(); target.focus({ preventScroll: true }) }
  }
  return <DialogPrimitive.Root open={open} onOpenChange={next => { if (!next) onClose?.() }}><DialogPrimitive.Portal><DialogPrimitive.Overlay className={styles.overlay}/><DialogPrimitive.Content className={cx(styles.dialog, size === 'lg' && styles.dialogLarge, drawer && styles.drawer, drawer && side === 'right' && styles.drawerRight, className)} onOpenAutoFocus={rememberFocus} onCloseAutoFocus={event => { event.preventDefault(); const target = returnFocus.current; if (target instanceof HTMLElement && target.isConnected) target.focus() }} aria-describedby={description ? descriptionId : undefined}><header className={styles.dialogHead}><div><DialogPrimitive.Title className={styles.dialogTitle}>{title}</DialogPrimitive.Title>{description && <DialogPrimitive.Description id={descriptionId} className={styles.dialogDescription}>{description}</DialogPrimitive.Description>}</div><DialogPrimitive.Close asChild><IconButton icon="x" label="Close"/></DialogPrimitive.Close></header><div className={styles.dialogBody}>{children}</div>{footer && <footer className={styles.dialogFooter}>{footer}</footer>}</DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>
}
export function Dialog(props) { return <OverlayPanel {...props}/> }
export function Drawer(props) { return <OverlayPanel {...props} drawer/> }
