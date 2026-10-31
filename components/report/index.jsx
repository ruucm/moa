'use client'

import React, { useId } from 'react'
import { ZoomableImage } from './lightbox.jsx'
import styles from './report.module.css'

const cx = (...names) => names.filter(Boolean).join(' ')
const severities = {
  high: { label: 'Urgent', tone: 'danger' },
  warn: { label: 'Watch', tone: 'warning' },
  done: { label: 'Fixed', tone: 'success' },
}

export function Updated({ at }) {
  return <div className={styles.updated}>Last updated: <span>{at}</span></div>
}

// The text of a cell as it reads: strings and numbers, and whatever is inside an element.
const textOf = (node) => node == null || typeof node === 'boolean' ? ''
  : typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(textOf).join('')
  : React.isValidElement(node) ? textOf(node.props.children) : ''
// About how wide a text is, in em: a CJK character takes an em, a Latin letter about half, a space less.
const cjk = /[ᄀ-ᇿ⺀-꓏가-퟿豈-﫿︰-﹏＀-￯]/
const emOf = (text) => [...text].reduce((width, char) => width + (cjk.test(char) ? 1 : char === ' ' ? .3 : .56), 0)
// On a narrow screen a column of long text keeps room to wrap in readable lines, so the table grows past its box
// and scrolls sideways instead of being squeezed to a word a line (report.module.css, under 40rem): the table's
// `--col-N` is the least width, in the table's em, of the Nth column's cells when their text runs past 8em: a
// column of a few words gets 9–14em (its lines wrap in two or three), a column of running text 18em. A short
// column keeps its own width. (A <col> width would not do: a table already wider than its box gives every column
// its narrowest fit and ignores it.)
const columnWidths = (rows) => {
  const widest = []
  for (const cells of rows) cells.forEach((cell, index) => { widest[index] = Math.max(widest[index] || 0, emOf(textOf(cell))) })
  const style = {}
  widest.forEach((em, index) => { if (em >= 8) style[`--col-${index + 1}`] = `${em >= 40 ? 18 : Math.min(14, Math.max(9, Math.ceil(em * .7) + 1))}em` })
  return style
}
// The cells of a Markdown table's body rows. The header row never wraps, so it sets its own width.
const bodyRows = (children) => {
  const rows = []
  const visit = (node) => {
    for (const child of React.Children.toArray(node)) {
      if (!React.isValidElement(child) || child.type === 'thead') continue
      if (child.type === 'tr') rows.push(React.Children.toArray(child.props.children).filter(React.isValidElement))
      else visit(child.props.children)
    }
  }
  visit(children)
  return rows
}

export function MarkdownTable({ children, className, style, ...props }) {
  return (
    <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={props['aria-label'] || 'Document table'}>
      <table {...props} className={cx(styles.table, className)} style={{ ...columnWidths(bodyRows(children)), ...style }}>{children}</table>
    </div>
  )
}

export function Stats({ items = [] }) {
  return (
    <dl className={styles.stats}>
      {items.map((item, index) => (
        <div key={index} className={cx(styles.stat, item.accent && styles.statAccent)}>
          <dt className={styles.statLabel}>{item.label}</dt>
          <dd className={styles.statValue}>{item.value}</dd>
          {item.sub && <dd className={styles.statSub}>{item.sub}</dd>}
        </div>
      ))}
    </dl>
  )
}

const isNumeric = (value) => typeof value === 'number' || (
  typeof value === 'string' && /^[+−-]?[₩$€¥]?\s*\d[\d,.\s:/%+−-]*(?:원|회|개|명|건|초|분|시간|일|배|점|클립|px|ms|s|MB|GB)?$/.test(value.trim())
)

export function DataTable({ cols = [], rows = [], note }) {
  const noteId = useId()
  const numericColumns = cols.map((_, index) => index > 0 && rows.some((row) => isNumeric(row[index])) && rows.every((row) => row[index] == null || row[index] === '' || row[index] === '—' || row[index] === '-' || isNumeric(row[index])))
  return (
    <div className={styles.dataTable}>
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Data table">
        <table className={styles.table} style={columnWidths(rows)} aria-describedby={note ? noteId : undefined}>
          <thead><tr>{cols.map((col, index) => <th scope="col" key={index} className={numericColumns[index] ? styles.numeric : undefined}>{col}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className={(row[0] === 'Total' || row[0] === '누적') ? styles.totalRow : undefined}>
                {row.map((value, colIndex) => colIndex === 0
                  ? <th scope="row" key={colIndex}>{value}</th>
                  : <td key={colIndex} className={numericColumns[colIndex] ? styles.numeric : undefined}>{value}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <p id={noteId} className={styles.note}>{note}</p>}
    </div>
  )
}

export function Issues({ items = [] }) {
  return (
    <ul className={cx(styles.panel, styles.list)}>
      {items.map((item, index) => {
        const severity = severities[item.sev] || severities.warn
        return (
          <li key={index} className={styles.issue}>
            <span className={cx(styles.badge, styles[severity.tone])}>{severity.label}</span>
            <div className={styles.itemContent}>
              <div className={cx(styles.itemTitle, item.sev === 'done' && styles.resolved)}>{item.t}</div>
              {item.d && <div className={styles.itemDescription}>{item.d}</div>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function Lessons({ keep = [], fix = [] }) {
  return (
    <div className={styles.lessons}>
      <section className={styles.panel} aria-label="What worked">
        <div className={styles.panelHeading}><span className={cx(styles.badge, styles.success)}>Keep</span><span>What worked → keep as is</span></div>
        <ul className={styles.list}>
          {keep.map((item, index) => <li key={index} className={styles.lesson}><div className={styles.itemTitle}>{item.t}</div><div className={styles.itemDescription}>{item.d}</div></li>)}
        </ul>
      </section>
      <section className={styles.panel} aria-label="What to improve">
        <div className={styles.panelHeading}><span className={cx(styles.badge, styles.warning)}>Improve</span><span>What failed → prevent repeats</span></div>
        <ul className={styles.list}>
          {fix.map((item, index) => <li key={index} className={styles.lesson}><div className={styles.itemTitle}>{item.t}</div><div className={styles.itemDescription}>{item.d}</div>{item.fix && <div className={styles.lessonAction}><span aria-hidden="true">↳</span> {item.fix}</div>}</li>)}
        </ul>
      </section>
    </div>
  )
}

export function Rules({ items = [] }) {
  return (
    <ol className={styles.rules}>
      {items.map((item, index) => <li key={item.no ?? index} className={styles.rule}><span className={styles.ruleNumber}>{item.no}</span><div className={styles.itemTitle}>{item.t}</div><div className={styles.itemDescription}>{item.d}</div></li>)}
    </ol>
  )
}

export function Timeline({ items = [] }) {
  return (
    <ol className={styles.timeline}>
      {items.map((item, index) => (
        <li key={index} className={cx(styles.timelineItem, (item.accent || item.now) && styles.timelineActive)}>
          <div className={styles.timelineDate}>{item.d}{item.now && <span className={cx(styles.badge, styles.accent)}>Today</span>}</div>
          <span className={styles.timelineDot} aria-hidden="true" />
          <div className={styles.timelineContent}>{item.t}</div>
        </li>
      ))}
    </ol>
  )
}

export function Checks({ items = [] }) {
  return (
    <ul className={cx(styles.panel, styles.list)}>
      {items.map((item, index) => {
        const text = String(item)
        const done = text.startsWith('✅')
        return (
          <li key={index} className={cx(styles.check, done && styles.checkDone)}>
            <span className={styles.checkIcon} aria-hidden="true">{done && <svg viewBox="0 0 16 16" fill="none"><path d="m4 8 2.5 2.5L12 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>
            <span><span className={styles.srOnly}>{done ? 'Completed: ' : 'Incomplete: '}</span>{text.replace(/^✅\s*/, '')}</span>
          </li>
        )
      })}
    </ul>
  )
}

export function FooterNote({ children }) {
  return <div className={styles.footerNote}>{children}</div>
}

export function Callout({ type = 'info', title, children }) {
  const tone = { info: 'info', warn: 'warning', success: 'success', danger: 'danger' }[type] || 'info'
  return (
    <aside className={cx(styles.callout, styles[tone])} aria-label={title || { info: 'Information', warning: 'Warning', success: 'Success', danger: 'Important information' }[tone]}>
      {title && <div className={styles.calloutTitle}>{title}</div>}
      <div className={styles.calloutBody}>{children}</div>
    </aside>
  )
}

export function Progress({ label, value, sub }) {
  const id = useId()
  const numericValue = Number(value)
  const safeValue = Number.isFinite(numericValue) ? Math.min(100, Math.max(0, numericValue)) : 0
  return (
    <div className={styles.progress}>
      <div className={styles.progressHead}><span id={id} className={styles.progressLabel}>{label}</span><span className={styles.progressValue}>{Number.isFinite(numericValue) ? value : 0}%</span></div>
      <div className={styles.progressTrack} role="progressbar" aria-labelledby={id} aria-valuemin={0} aria-valuemax={100} aria-valuenow={safeValue} aria-describedby={sub ? `${id}-sub` : undefined}>
        <div className={styles.progressFill} style={{ width: `${safeValue}%` }} />
      </div>
      {sub && <div id={`${id}-sub`} className={styles.note}>{sub}</div>}
    </div>
  )
}

export function Badge({ tone = 'muted', children }) {
  const toneClass = { live: 'success', wait: 'warning', done: 'neutral', muted: 'muted' }[tone] || 'muted'
  return <span className={cx(styles.badge, styles[toneClass])}>{children}</span>
}

export function MediaGrid({ items = [], cols = 3 }) {
  const requestedColumns = Number(cols)
  const columns = Number.isFinite(requestedColumns) ? Math.max(1, Math.floor(requestedColumns)) : 3
  return (
    <div className={cx(styles.mediaGrid, columns === 1 && styles.mediaSingle)} style={{ '--media-columns': columns }}>
      {items.map((item, index) => <figure key={index} className={styles.mediaFigure}>
        {item.video
          ? <video className={styles.media} controls preload="metadata" src={item.src} aria-label={item.cap || `Video ${index + 1}`} />
          : <ZoomableImage className={styles.media} src={item.src} cap={item.cap} zoomSrc={item.full} loading="lazy" />}
        {item.cap && <figcaption className={styles.mediaCaption}>{item.cap}</figcaption>}
      </figure>)}
    </div>
  )
}

// One piece of media with its caption. `wide` lets it breathe past the reading column,
// as far as the layout's bleed budget allows (--figure-bleed).
export function Figure({ src, cap, alt, video = false, wide = false, zoom = true, full }) {
  return (
    <figure className={cx(styles.figure, wide && styles.figureWide)}>
      {video
        ? <video className={styles.figureMedia} controls preload="metadata" src={src} aria-label={cap || 'Video'} />
        : <ZoomableImage className={styles.figureMedia} src={src} alt={alt} cap={cap} zoom={zoom} zoomSrc={full} loading="lazy" />}
      {cap && <figcaption className={styles.figureCaption}>{cap}</figcaption>}
    </figure>
  )
}
