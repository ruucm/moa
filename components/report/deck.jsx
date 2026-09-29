'use client'

// Slide decks written in MDX. A <Deck> holds <Slide>s: in the document every slide is a card you
// read and edit in place, and Present shows them one at a time, full screen. Each slide is laid
// out on a fixed canvas (960 px wide) and scaled as one piece, so it looks the same as a card, in
// the overview and on a projector — and the shared report components keep their sizes inside it.
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Icon, IconButton } from '../ui/index.jsx'
import styles from './deck.module.css'

const cx = (...names) => names.filter(Boolean).join(' ')
const CANVAS_WIDTH = 960
const CANVAS_HEIGHTS = { '16:9': 540, '16:10': 600, '4:3': 720 }
const LAYOUTS = new Set(['default', 'split', 'cover', 'section', 'statement'])
const BACKDROP_LAYOUTS = new Set(['cover', 'section', 'statement'])
const TONES = new Set(['accent', 'success', 'warning', 'danger', 'info', 'muted'])
const NOTES_KEY = 'hub.deck.notes'
// Anything that handles its own clicks and keys; the presenter leaves these alone.
const INTERACTIVE = 'a, button, input, textarea, select, summary, label, video, [role="checkbox"], [data-presenter-chrome]'

const canvasVars = (aspect) => {
  const height = CANVAS_HEIGHTS[aspect] || CANVAS_HEIGHTS['16:9']
  return { '--slide-w': `${CANVAS_WIDTH}px`, '--slide-h': `${height}px`, '--slide-ratio': `${CANVAS_WIDTH} / ${height}`, '--slide-aspect': CANVAS_WIDTH / height }
}

// Plain text of a title that may be a string or JSX, for labels and the overview.
const textOf = (node) => {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (React.isValidElement(node)) return node.type === 'br' ? ' ' : textOf(node.props.children)
  return ''
}
const labelOf = (node) => textOf(node).replace(/\s+/g, ' ').trim()

// A picture's shape decides how much room it needs. `ratio="3/4"` states it; otherwise it is read from
// the picture once loaded and remembered, so a saved document does not reflow its slides.
const knownRatios = new Map()
const parseRatio = (value) => {
  if (typeof value === 'number') return value > 0 ? value : null
  const [width, height] = String(value ?? '').split(/[/:]/).map(Number)
  return width > 0 && height > 0 ? width / height : null
}
// Returns an onLoad handler that records a picture's shape and re-renders the owner once.
function useLearnRatio() {
  const [, rerender] = useState(0)
  return useCallback((event) => {
    const picture = event.currentTarget
    const key = picture.getAttribute('src')
    if (!key || knownRatios.has(key) || !picture.naturalWidth || !picture.naturalHeight) return
    knownRatios.set(key, picture.naturalWidth / picture.naturalHeight)
    rerender((value) => value + 1)
  }, [])
}

// Sizes a picture of known shape to the room it has, so its caption sits right under it and spare
// room goes around the whole group. The canvas never changes size, so layout is measured once — and
// again when web fonts arrive or captions re-wrap at the new width.
const GRID_GAP = 14
const PAIR_GAP = 6
function useFit(ref, ratio, measure, deps) {
  const [fit, setFit] = useState(null)
  const passes = useRef(0)
  useLayoutEffect(() => { passes.current = 0 }, [ratio, ...deps])
  useLayoutEffect(() => {
    const node = ref.current
    if (!ratio || !node) { setFit(null); return }
    let alive = true
    const update = () => {
      if (!alive || passes.current > 3) return
      const next = measure(node)
      setFit((current) => current && Object.keys(next).every((key) => Math.abs(current[key] - next[key]) < 1) ? current : (passes.current++, next))
    }
    update()
    document.fonts?.ready.then(update)
    return () => { alive = false }
  }, [ratio, fit?.w, fit?.cols, ...deps])
  return fit
}

// ---------------------------------------------------------------- state that outlives a remount
// Saving a document remounts its whole tree. A talk in progress — the slide on screen, open notes,
// running timers, ticked items — lives here, outside React, so an edit mid-talk does not reset it.
const runs = new Map()
function runFor(key) {
  if (!runs.has(key)) runs.set(key, { presenting: false, index: 0, notes: false, ownsFullscreen: false, leavingFullscreen: false, mounted: 0, timers: new Map(), checks: new Map(), listeners: new Set() })
  return runs.get(key)
}
const notify = (run) => run.listeners.forEach((listener) => listener())
function useRun(run) {
  const [, rerender] = useState(0)
  useEffect(() => {
    const listener = () => rerender((value) => value + 1)
    run.listeners.add(listener)
    return () => { run.listeners.delete(listener) }
  }, [run])
}

const DeckContext = createContext(null)
const SlideContext = createContext(null)
const standaloneRun = runFor('standalone')

function leaveFullscreen(run) {
  if (run.ownsFullscreen && document.fullscreenElement) {
    run.leavingFullscreen = true
    document.exitFullscreen().catch(() => { run.leavingFullscreen = false })
  }
  run.ownsFullscreen = false
}
function enterFullscreen(run) {
  const root = document.documentElement
  if (document.fullscreenElement || !root.requestFullscreen) return
  root.requestFullscreen().then(() => { run.ownsFullscreen = true }).catch(() => {})
}

// ---------------------------------------------------------------- parsing the MDX children
const isBlank = (child) => child == null || typeof child === 'boolean' || (typeof child === 'string' && !child.trim())

function splitNotes(children) {
  const body = []
  const notes = []
  for (const child of React.Children.toArray(children)) {
    if (React.isValidElement(child) && child.type === Notes) notes.push(child.props.children)
    else if (!isBlank(child)) body.push(child)
  }
  return { body, notes: React.Children.toArray(notes) }
}

function slideEntry(props, number, anchor) {
  const { body, notes } = splitNotes(props.children)
  return { number, props, body, notes, anchor }
}

// ---------------------------------------------------------------- one slide
function SlideBackdrop({ src, video, eager }) {
  return <div className={styles.backdrop} aria-hidden="true">
    {video ? <video src={src} autoPlay muted loop playsInline /> : <img src={src} alt="" loading={eager ? 'eager' : 'lazy'} />}
  </div>
}

function SlideMedia({ src, video, fit, position, ratio: stated, cap, alt, eager, className }) {
  const learn = useLearnRatio()
  const ratio = knownRatios.get(src) || parseRatio(stated) || null
  const figure = useRef(null)
  const cover = fit === 'cover'
  const box = useFit(figure, cover ? null : ratio, (node) => {
    const caption = node.querySelector('figcaption')
    const room = node.clientHeight - (caption ? caption.offsetHeight + 10 : 0)
    const w = Math.max(24, Math.floor(Math.min(node.clientWidth, room * ratio)))
    return { w, h: Math.floor(w / ratio) }
  }, [labelOf(cap)])
  const style = { ...(position && { '--media-position': position }), ...(box && { '--pic-w': `${box.w}px`, '--pic-h': `${box.h}px` }) }
  return <figure ref={figure} className={cx(styles.media, cover && styles.mediaCover, box && styles.fitted, className)} style={style}>
    <div className={styles.picture}>
      {video
        ? <video src={src} controls preload="metadata" playsInline aria-label={alt || labelOf(cap) || 'Video'} />
        : <img src={src} alt={alt ?? labelOf(cap)} loading={eager ? 'eager' : 'lazy'} onLoad={learn} />}
    </div>
    {cap && <figcaption className={styles.mediaCaption}>{cap}</figcaption>}
  </figure>
}

function SlideFace({ entry, total, present = false }) {
  const deck = useContext(DeckContext)
  const { props, body, number, anchor } = entry
  const layout = LAYOUTS.has(props.layout) ? props.layout : 'default'
  const backdrop = !!props.image && BACKDROP_LAYOUTS.has(layout)
  const tone = TONES.has(props.tone) ? props.tone : 'neutral'
  const minutes = Number(props.timer) > 0 ? Number(props.timer) : 0
  const [textShare, mediaShare] = String(props.split || '5:7').split(':').map(Number)
  // Wide-open layouts keep the tag in the corner; the others line it up with the kicker.
  const cornerTag = !!props.tag && BACKDROP_LAYOUTS.has(layout)
  const headTop = !!(props.kicker || (props.tag && !cornerTag) || (minutes > 0 && layout !== 'split'))
  const media = { src: props.image, video: props.video, fit: props.fit, position: props.position, ratio: props.ratio, cap: props.cap, alt: props.alt, eager: present }
  return <SlideContext.Provider value={{ anchor, number, eager: present }}>
    <div className={cx(styles.frame, present && styles.framePresent)}>
      <div className={cx(styles.canvas, styles[`layout_${layout}`], backdrop && styles.onImage)}
        style={layout === 'split' ? { '--split-text': `${textShare || 5}fr`, '--split-media': `${mediaShare || 7}fr` } : undefined}>
        {backdrop && <SlideBackdrop src={props.image} video={props.video} eager={present} />}
        <div className={styles.main}>
          {headTop && <div className={styles.headTop}>
            {props.kicker ? <span className={styles.kicker}>{props.kicker}</span> : <span />}
            <span className={styles.headTopEnd}>
              {minutes > 0 && layout !== 'split' && <SlideTimer minutes={minutes} />}
              {props.tag && !cornerTag && <span className={cx(styles.tag, styles[`tone_${tone}`])}>{props.tag}</span>}
            </span>
          </div>}
          {props.title && <div className={styles.title}>{props.title}</div>}
          {props.sub && <div className={styles.sub}>{props.sub}</div>}
          {body.length > 0 && <div className={styles.body}>{body}</div>}
          {props.image && !backdrop && layout !== 'split' && <SlideMedia {...media} className={styles.fill} />}
          {minutes > 0 && layout === 'split' && <SlideTimer minutes={minutes} block />}
        </div>
        {props.image && layout === 'split' && <SlideMedia {...media} className={styles.side} />}
        {cornerTag && <span className={cx(styles.tag, styles.cornerTag, styles[`tone_${tone}`])}>{props.tag}</span>}
        {props.mark != null && <div className={styles.mark} aria-hidden="true">{props.mark}</div>}
        <div className={styles.foot}>
          <span>{layout === 'cover' ? '' : deck?.footer}</span>
          {total > 0 && <span>{number} / {total}</span>}
        </div>
      </div>
    </div>
  </SlideContext.Provider>
}

// ---------------------------------------------------------------- slide parts
const clock = (ms) => {
  const seconds = Math.ceil(ms / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
function timerFor(run, anchor, minutes) {
  const total = Math.round(minutes * 60000)
  let timer = run.timers.get(anchor)
  if (!timer || timer.total !== total) {
    timer = { total, left: total, end: 0, running: false }
    run.timers.set(anchor, timer)
  }
  return timer
}
const remaining = (timer) => timer.running ? Math.max(0, timer.end - Date.now()) : timer.left
function toggleTimer(run, timer) {
  if (timer.running) { timer.left = remaining(timer); timer.running = false }
  else {
    if (timer.left <= 0) timer.left = timer.total
    timer.end = Date.now() + timer.left
    timer.running = true
  }
  notify(run)
}
function resetTimer(run, timer) {
  timer.left = timer.total
  timer.running = false
  notify(run)
}

// A countdown for timed exercises. `<Slide timer={4}>` places it; T starts and pauses it while presenting.
function SlideTimer({ minutes, block = false }) {
  const run = useContext(DeckContext)?.run || standaloneRun
  const slide = useContext(SlideContext)
  useRun(run)
  const timer = timerFor(run, slide?.anchor || 'standalone', minutes)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!timer.running) return
    const id = setInterval(() => {
      if (timer.running && remaining(timer) <= 0) { timer.running = false; timer.left = 0; notify(run) }
      tick((value) => value + 1)
    }, 250)
    return () => clearInterval(id)
  }, [run, timer, timer.running])
  const left = remaining(timer)
  return <span className={cx(styles.timer, block && styles.timerBlock, timer.running && styles.timerRunning, left <= 0 && styles.timerDone)}>
    <Icon name="timer" size={block ? 24 : 16} />
    <span className={styles.timerValue} role="timer">{clock(left)}</span>
    <button type="button" className={styles.timerButton} onClick={() => toggleTimer(run, timer)} aria-label={timer.running ? 'Pause timer' : 'Start timer'}>
      <Icon name={timer.running ? 'pause' : 'play'} size={block ? 18 : 14} />
    </button>
    <button type="button" className={styles.timerButton} onClick={() => resetTimer(run, timer)} aria-label="Reset timer">
      <Icon name="reset" size={block ? 18 : 14} />
    </button>
  </span>
}

const gridColumns = (count) => count <= 5 ? count : count <= 12 ? 4 : 6

// Pictures with labels, laid out to fill the space left on the slide. Pictures are never cropped
// unless `fit="cover"`; `tone` marks a pick (accent), a failure (danger) and so on.
export function SlideGrid({ items = [], cols, fit = 'contain', ratio: stated, note, label, sub }) {
  const slide = useContext(SlideContext)
  const learn = useLearnRatio()
  const count = Math.max(1, items.length)
  const fixedColumns = Math.max(0, Math.floor(Number(cols) || 0))
  const pictures = Math.max(1, ...items.map((item) => [].concat(item.src || []).length))
  const statedRatio = parseRatio(stated)
  // A measured shape wins; `ratio` only stands in until the picture has loaded.
  const shapeOf = (src) => knownRatios.get(src) || statedRatio || null
  // The room one cell's pictures need side by side: a pair adds up both shapes.
  const firstSources = [].concat(items.find((item) => item.src)?.src || [])
  const shapes = firstSources.map(shapeOf)
  const ratio = shapes.length && shapes.every(Boolean) ? shapes.reduce((sum, value) => sum + value, 0) : null
  const stack = useRef(null)
  const box = useFit(stack, fit === 'cover' ? null : ratio, (node) => {
    const grid = node.firstElementChild
    const noteNode = grid.nextElementSibling
    const noteRoom = noteNode ? noteNode.offsetHeight + 10 : 0
    const gaps = (pictures - 1) * PAIR_GAP
    // Captions grow as columns narrow: read each caption line's natural width once, then count
    // the lines it needs at any column width.
    const captions = [...grid.querySelectorAll('figcaption')].map((caption) => [...caption.children].map((line) => {
      const width = line.style.width
      line.style.width = 'max-content'
      const natural = line.offsetWidth
      line.style.width = width
      const style = getComputedStyle(line)
      return { natural, height: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 }
    }))
    const captionRoom = (width) => captions.length
      ? Math.max(...captions.map((lines) => lines.reduce((sum, line) => sum + Math.max(1, Math.ceil((line.natural + 1) / width)) * line.height, 0) + (lines.length - 1))) + PAIR_GAP
      : 0
    // A cell narrowed by the height it has wraps its captions further, which takes more height:
    // settle the two together.
    const widthAt = (columns) => {
      const rows = Math.ceil(count / columns)
      const byWidth = (node.clientWidth - (columns - 1) * GRID_GAP) / columns
      const perRow = (node.clientHeight - noteRoom - (rows - 1) * GRID_GAP) / rows
      let width = byWidth
      for (let round = 0; round < 4; round++) width = Math.min(byWidth, (perRow - captionRoom(width)) * ratio + gaps)
      return width
    }
    // Without `cols`, try every column count whose last row is full or one short, and keep the one
    // that gives the largest pictures; on a tie, fewer rows.
    let columns = fixedColumns
    if (!columns) {
      let best = -Infinity
      for (let candidate = count; candidate >= 1; candidate--) {
        if (count % candidate && count % candidate < candidate - 1) continue
        const width = widthAt(candidate)
        if (width > best + 1) { best = width; columns = candidate }
      }
    }
    const w = Math.max(24, Math.floor(widthAt(columns)))
    return { w, h: Math.max(16, Math.floor((w - gaps) / ratio)), cols: columns }
  }, [fixedColumns, count, pictures, typeof note === 'string' ? note : !!note])
  const columns = box?.cols || fixedColumns || gridColumns(count)
  const rows = Math.ceil(count / columns)
  const gridStyle = { '--grid-cols': columns, '--grid-rows': rows, ...(box && { '--cell-w': `${box.w}px`, '--pic-h': `${box.h}px` }) }
  return <div className={cx(styles.gridBlock, label && styles.gridRow)}>
    {label && <div className={styles.rowLabel}><span>{label}</span>{sub && <small>{sub}</small>}</div>}
    <div ref={stack} className={cx(styles.gridStack, box && styles.fitted)}>
      <div className={styles.grid} style={gridStyle}>
        {items.map((item, index) => {
          const sources = [].concat(item.src || [])
          const caption = item.label ?? item.cap
          const tone = TONES.has(item.tone) ? item.tone : null
          return <figure key={index} className={cx(styles.gridItem, tone && styles.toned, tone && styles[`tone_${tone}`])}>
            {sources.length > 0 && <div className={cx(styles.gridMedia, (item.fit || fit) === 'cover' && styles.mediaCover)}>
              {sources.map((src, position) => <div key={position} className={styles.picture} style={sources.length > 1 ? { flexGrow: shapeOf(src) || 1 } : undefined}>
                {item.video
                  ? <video src={src} controls preload="metadata" playsInline aria-label={labelOf(caption) || `Video ${index + 1}`} />
                  : <img src={src} alt={item.alt ?? labelOf(caption)} loading={slide?.eager ? 'eager' : 'lazy'} onLoad={learn} />}
              </div>)}
            </div>}
            {(caption || item.sub) && <figcaption className={styles.gridCaption}>
              {caption && <span className={styles.gridLabel}>{caption}</span>}
              {item.sub && <span className={styles.gridSub}>{item.sub}</span>}
            </figcaption>}
          </figure>
        })}
      </div>
      {note && <p className={styles.gridNote}>{note}</p>}
    </div>
  </div>
}

// A checklist the room can tick off: click an item, or press C while presenting to tick the next one.
// Items that start with ✅ begin ticked.
export function SlideChecklist({ items = [] }) {
  const run = useContext(DeckContext)?.run || standaloneRun
  const slide = useContext(SlideContext)
  useRun(run)
  const key = slide?.anchor || 'standalone'
  let checked = run.checks.get(key)
  if (!checked) {
    checked = new Set(items.flatMap((item, index) => String(item).startsWith('✅') ? [index] : []))
    run.checks.set(key, checked)
  }
  const toggle = (index) => {
    if (checked.has(index)) checked.delete(index)
    else checked.add(index)
    notify(run)
  }
  return <ul className={styles.checklist}>
    {items.map((item, index) => {
      const on = checked.has(index)
      return <li key={index}>
        <button type="button" role="checkbox" aria-checked={on} data-slide-check="" className={styles.checkItem} onClick={() => toggle(index)}>
          <span className={styles.checkBox} aria-hidden="true">{on && <Icon name="check" size={16} />}</span>
          <span>{String(item).replace(/^✅\s*/, '')}</span>
        </button>
      </li>
    })}
  </ul>
}

// Speaker notes for the slide they sit in. The document shows them under the card; N shows them
// while presenting. Outside a <Slide> they render as a quiet aside.
export function Notes({ children }) {
  return <aside className={cx(styles.notes, styles.notesAside)} aria-label="Speaker notes">{children}</aside>
}

// A slide is normally rendered by its <Deck>. On its own it shows as a single card.
export function Slide(props) {
  const entry = slideEntry(props, 1, props.id || 'slide')
  return <div className={styles.single} style={canvasVars(props.aspect)}>
    <SlideFace entry={entry} total={0} />
    {entry.notes.length > 0 && <div className={styles.notes}>{entry.notes}</div>}
  </div>
}

// ---------------------------------------------------------------- the deck in the document
function readNotesPreference() {
  try { return localStorage.getItem(NOTES_KEY) !== 'hidden' } catch { return true }
}

function SlideCard({ entry, total, showNotes, onPresent }) {
  const label = labelOf(entry.props.title)
  return <div id={entry.anchor} className={styles.card} role="group" aria-roledescription="slide" aria-label={`${entry.number} of ${total}${label ? `: ${label}` : ''}`}>
    <SlideFace entry={entry} total={total} />
    <div className={styles.caption}>
      <a className={styles.number} href={`#${encodeURIComponent(entry.anchor)}`} aria-label={`Link to slide ${entry.number}`}>{entry.number}</a>
      <span className={styles.captionTitle}>{label}</span>
      {entry.props.time && <span className={styles.captionTime}><Icon name="clock" size={14} />{entry.props.time}</span>}
      <IconButton icon="play" size="sm" label={`Present from slide ${entry.number}`} onClick={onPresent} />
    </div>
    {showNotes && entry.notes.length > 0 && <div className={styles.notes}>{entry.notes}</div>}
  </div>
}

export function Deck({ title, footer, aspect = '16:9', id = 'slide', children }) {
  const entries = []
  const slides = []
  for (const child of React.Children.toArray(children)) {
    if (React.isValidElement(child) && child.type === Slide) {
      const number = slides.length + 1
      const entry = slideEntry(child.props, number, child.props.id || `${id}-${number}`)
      slides.push(entry)
      entries.push(entry)
    } else if (!isBlank(child)) entries.push({ node: child })
  }
  const total = slides.length
  const key = typeof window === 'undefined' ? id : `${window.location.pathname}#${id}`
  const run = runFor(key)
  const [presenting, setPresenting] = useState(() => run.presenting && total > 0)
  const [index, setIndex] = useState(() => Math.min(run.index, Math.max(0, total - 1)))
  const [showNotes, setShowNotes] = useState(readNotesPreference)
  const presentButton = useRef(null)
  const slidesRef = useRef(slides)
  slidesRef.current = slides
  const current = Math.min(index, Math.max(0, total - 1))

  // A saved document remounts the deck at once; leaving the page does not come back. Only then
  // does a talk end on its own.
  useEffect(() => {
    run.mounted += 1
    return () => {
      run.mounted -= 1
      setTimeout(() => {
        if (run.mounted > 0 || !run.presenting) return
        run.presenting = false
        leaveFullscreen(run)
      }, 1500)
    }
  }, [run])

  const go = useCallback((next) => {
    const target = Math.max(0, Math.min(slidesRef.current.length - 1, next))
    run.index = target
    setIndex(target)
  }, [run])

  const present = (start) => {
    run.presenting = true
    go(start)
    setPresenting(true)
    enterFullscreen(run)
  }

  // Present starts from the slide being read, so the button works from anywhere in a long deck.
  const presentFromView = () => {
    const line = window.innerHeight * 0.3
    let start = 0
    slides.forEach((slide, position) => {
      const card = document.getElementById(slide.anchor)
      if (card && card.getBoundingClientRect().top <= line) start = position
    })
    present(start)
  }

  const exit = useCallback(() => {
    run.presenting = false
    setPresenting(false)
    leaveFullscreen(run)
    // Back in the document, land on the slide that was on screen.
    requestAnimationFrame(() => {
      const slide = slidesRef.current[run.index]
      const card = slide && document.getElementById(slide.anchor)
      if (card) card.scrollIntoView({ block: 'center' })
      presentButton.current?.focus({ preventScroll: true })
    })
  }, [run])

  const toggleNotes = () => setShowNotes((visible) => {
    try { localStorage.setItem(NOTES_KEY, visible ? 'hidden' : 'shown') } catch {}
    return !visible
  })

  const vars = canvasVars(aspect)
  return <DeckContext.Provider value={{ run, footer }}>
    <div className={styles.deck} style={vars}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarInfo}>
          {title && <span className={styles.toolbarTitle}>{title}</span>}
          <span className={styles.count}>{total} {total === 1 ? 'slide' : 'slides'}</span>
        </div>
        <div className={styles.toolbarActions}>
          <Button variant="ghost" size="sm" aria-pressed={showNotes} onClick={toggleNotes}><Icon name="notes" size={16} />Notes</Button>
          <Button ref={presentButton} variant="primary" size="sm" onClick={presentFromView} disabled={!total}><Icon name="play" size={16} />Present</Button>
        </div>
      </div>
      {entries.map((entry, position) => entry.node === undefined
        ? <SlideCard key={entry.anchor} entry={entry} total={total} showNotes={showNotes} onPresent={() => present(entry.number - 1)} />
        : <React.Fragment key={`content-${position}`}>{entry.node}</React.Fragment>)}
    </div>
    {presenting && total > 0 && <Presenter slides={slides} index={current} go={go} onExit={exit} title={title} run={run} vars={vars} />}
  </DeckContext.Provider>
}

// ---------------------------------------------------------------- presenting
const SHORTCUTS = [
  ['→  Space  PgDn', 'Next slide'], ['←  PgUp', 'Previous slide'], ['Home  End', 'First · last slide'],
  ['12  Enter', 'Go to slide 12'], ['F', 'Full screen'], ['N', 'Speaker notes'], ['O', 'All slides'],
  ['T', 'Start or pause the timer'], ['C', 'Tick the next checklist item'], ['B  .', 'Blank the screen'], ['Esc', 'Close a panel · end the presentation'],
]

function Overview({ slides, index, total, onPick }) {
  const currentRef = useRef(null)
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' })
    currentRef.current?.focus({ preventScroll: true })
  }, [])
  return <div className={styles.overview} role="region" aria-label="All slides" data-presenter-chrome="">
    <div className={styles.overviewGrid}>
      {slides.map((entry, position) => {
        const label = labelOf(entry.props.title)
        return <div key={entry.anchor} className={cx(styles.overviewItem, position === index && styles.overviewCurrent)}>
          <div inert aria-hidden="true"><SlideFace entry={entry} total={total} /></div>
          <button ref={position === index ? currentRef : undefined} type="button" className={styles.overviewHit}
            aria-current={position === index ? 'true' : undefined} onClick={() => onPick(position)}>
            <b>{entry.number}</b><span>{label || `Slide ${entry.number}`}</span>
          </button>
        </div>
      })}
    </div>
  </div>
}

function Presenter({ slides, index, go, onExit, title, run, vars }) {
  const total = slides.length
  const current = slides[index]
  const following = slides[index + 1]
  const layerRef = useRef(null)
  const stageRef = useRef(null)
  const keyHandler = useRef(null)
  const idleTimer = useRef(null)
  const pointer = useRef(null)
  const swiped = useRef(false)
  const [notes, setNotes] = useState(() => run.notes)
  const [panel, setPanel] = useState(null)
  const [blank, setBlank] = useState(false)
  const [typed, setTyped] = useState('')
  const [idle, setIdle] = useState(false)
  const [fullscreen, setFullscreen] = useState(() => !!document.fullscreenElement)

  // The presenter is a layer over the window, not a native modal: entering full screen puts the page
  // itself in the browser's top layer, above a modal opened a moment earlier. The page behind is
  // made inert instead, so focus and screen readers stay with the slides.
  useEffect(() => {
    const layer = layerRef.current
    const behind = [...document.body.children].filter((node) => node !== layer && !node.inert)
    behind.forEach((node) => { node.inert = true })
    stageRef.current?.focus({ preventScroll: true })
    return () => behind.forEach((node) => { node.inert = false })
  }, [])

  // Keys are read on the document: when a focused control leaves with its slide, focus falls back
  // to the page, and the shortcuts must keep working. A dialog opened on top (the image viewer) wins.
  useEffect(() => {
    const onKey = (event) => { if (!document.querySelector('dialog[open]')) keyHandler.current?.(event) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (!layerRef.current?.contains(document.activeElement)) stageRef.current?.focus({ preventScroll: true })
  }, [index])

  useEffect(() => {
    const root = document.documentElement
    const overflow = root.style.overflow
    root.style.overflow = 'hidden'
    return () => { root.style.overflow = overflow }
  }, [])

  useEffect(() => {
    const onChange = () => {
      setFullscreen(!!document.fullscreenElement)
      if (document.fullscreenElement) return
      if (run.leavingFullscreen) { run.leavingFullscreen = false; return }
      // Esc, or the browser's own control, left full screen: end the talk too, like other slide apps.
      if (run.ownsFullscreen) { run.ownsFullscreen = false; onExit() }
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [run, onExit])

  const anchor = current?.anchor
  useEffect(() => {
    if (anchor) history.replaceState(history.state, '', `#${encodeURIComponent(anchor)}`)
  }, [anchor])

  const wake = useCallback(() => {
    setIdle(false)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setIdle(true), 2600)
  }, [])
  useEffect(() => { wake(); return () => clearTimeout(idleTimer.current) }, [wake])

  const toggleNotes = () => setNotes((open) => { run.notes = !open; return !open })
  const togglePanel = (name) => setPanel((open) => open === name ? null : name)
  const toggleFullscreen = () => {
    if (document.fullscreenElement) leaveFullscreen(run)
    else enterFullscreen(run)
  }
  const currentTimer = () => {
    const minutes = Number(current?.props.timer)
    return minutes > 0 ? timerFor(run, current.anchor, minutes) : null
  }
  const tickNext = () => {
    stageRef.current?.querySelector('[data-current-slide] [data-slide-check][aria-checked="false"]')?.click()
  }

  const onKeyDown = (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
    wake()
    // Esc closes whatever covers the slide first, then ends the presentation. (In full screen the
    // browser takes the first Esc itself; leaving full screen that way ends the talk as well.)
    if (event.key === 'Escape') {
      event.preventDefault()
      if (blank || panel || typed) { setBlank(false); setPanel(null); setTyped('') }
      else onExit()
      return
    }
    if (blank) { event.preventDefault(); setBlank(false); return }
    const onControl = !!target?.closest(INTERACTIVE)
    const { key, code } = event
    if (/^[0-9]$/.test(key)) { event.preventDefault(); setTyped((value) => (value + key).slice(-3)); return }
    if (key === 'Enter' && typed) { event.preventDefault(); go(Number(typed) - 1); setTyped(''); return }
    if (key === 'Backspace' && typed) { event.preventDefault(); setTyped((value) => value.slice(0, -1)); return }
    if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown' || (!onControl && (key === ' ' || key === 'Enter'))) { event.preventDefault(); go(index + 1); return }
    if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp') { event.preventDefault(); go(index - 1); return }
    if (key === 'Home') { event.preventDefault(); go(0); return }
    if (key === 'End') { event.preventDefault(); go(total - 1); return }
    if (key === '?') { event.preventDefault(); togglePanel('help'); return }
    // Letters by physical key, so the shortcuts also work with a Korean input method on.
    const actions = {
      KeyF: toggleFullscreen, KeyN: toggleNotes, KeyO: () => togglePanel('overview'), KeyG: () => togglePanel('overview'),
      KeyB: () => setBlank(true), Period: () => setBlank(true), KeyC: tickNext,
      KeyT: () => { const timer = currentTimer(); if (timer) (event.shiftKey ? resetTimer : toggleTimer)(run, timer) },
      // Clickers send F5 to start a slideshow; it must not reload the page mid-talk.
      F5: () => {},
    }
    if (actions[code]) { event.preventDefault(); actions[code]() }
  }
  keyHandler.current = onKeyDown

  const stepByClick = (event) => {
    if (window.getSelection()?.toString()) return
    const box = stageRef.current.getBoundingClientRect()
    go(event.clientX < box.left + box.width * 0.25 ? index - 1 : index + 1)
  }
  // Pictures in a slide open the image viewer in the document; while presenting a click turns the page.
  const onClickCapture = (event) => {
    if (event.target instanceof Element && event.target.closest('img[data-zoomable]') && !event.target.closest('[data-presenter-chrome]')) {
      event.stopPropagation()
      stepByClick(event)
    }
  }
  const onClick = (event) => {
    if (swiped.current) { swiped.current = false; return }
    if (!(event.target instanceof Element) || event.target.closest(INTERACTIVE)) return
    stepByClick(event)
  }
  const onPointerDown = (event) => { pointer.current = event.pointerType === 'mouse' ? null : { x: event.clientX, y: event.clientY } }
  const onPointerUp = (event) => {
    const start = pointer.current
    pointer.current = null
    if (!start) return
    const dx = event.clientX - start.x
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(event.clientY - start.y) * 1.5) {
      swiped.current = true
      go(index + (dx < 0 ? 1 : -1))
    }
  }
  // After a pointer click on a control, return focus to the stage so Space and Enter keep turning pages.
  const control = (action) => (event) => {
    action()
    if (event.detail > 0) stageRef.current?.focus({ preventScroll: true })
  }

  if (!current) return null
  const label = labelOf(current.props.title)
  return createPortal(
    <div ref={layerRef} className={cx(styles.presenter, idle && !panel && styles.presenterIdle)} style={vars}
      role="dialog" aria-modal="true" aria-label={`Presentation${title ? `: ${labelOf(title)}` : ''}`} onPointerMove={wake}>
      <div ref={stageRef} className={styles.stage} tabIndex={-1}
        onClickCapture={onClickCapture} onClick={onClick} onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
        <div className={styles.stageFrame} data-current-slide="" role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${total}${label ? `: ${label}` : ''}`}>
          <SlideFace key={current.anchor} entry={current} total={total} present />
        </div>
        {/* The neighbours render off screen so their pictures are ready before the page turns. */}
        <div className={styles.preload} inert aria-hidden="true">
          {[slides[index - 1], following].filter(Boolean).map((entry) => <SlideFace key={entry.anchor} entry={entry} total={total} present />)}
        </div>
        <div className={styles.controls} role="toolbar" aria-label="Presentation controls" data-presenter-chrome="">
          <button type="button" className={styles.control} onClick={control(() => go(index - 1))} disabled={index === 0} aria-label="Previous slide"><Icon name="arrowLeft" size={18} /></button>
          <span className={styles.counter}>{index + 1} / {total}</span>
          <button type="button" className={styles.control} onClick={control(() => go(index + 1))} disabled={index === total - 1} aria-label="Next slide"><Icon name="arrowRight" size={18} /></button>
          <span className={styles.controlDivider} aria-hidden="true" />
          <button type="button" className={styles.control} onClick={control(toggleNotes)} aria-pressed={notes} aria-label="Speaker notes (N)" title="Speaker notes (N)"><Icon name="notes" size={18} /></button>
          <button type="button" className={styles.control} onClick={control(() => togglePanel('overview'))} aria-pressed={panel === 'overview'} aria-label="All slides (O)" title="All slides (O)"><Icon name="grid" size={18} /></button>
          <button type="button" className={styles.control} onClick={control(toggleFullscreen)} aria-label={fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'} title={fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'}><Icon name={fullscreen ? 'minimize' : 'maximize'} size={18} /></button>
          <button type="button" className={styles.control} onClick={control(() => togglePanel('help'))} aria-pressed={panel === 'help'} aria-label="Keyboard shortcuts (?)" title="Keyboard shortcuts (?)"><Icon name="keyboard" size={18} /></button>
          <button type="button" className={styles.control} onClick={onExit} aria-label="End presentation (Esc)" title="End presentation (Esc)"><Icon name="x" size={18} /></button>
        </div>
        {typed && <div className={styles.goto} data-presenter-chrome="">Go to {typed} ↵</div>}
      </div>
      {notes && <aside className={styles.notesPanel} aria-label="Speaker notes" data-presenter-chrome="">
        <div className={styles.notesHead}>
          <span className={styles.notesCount}>{index + 1} / {total}</span>
          {current.props.time && <span className={styles.notesTime}><Icon name="clock" size={14} />{current.props.time}</span>}
          <strong>{label}</strong>
          {following && <span className={styles.notesNext}>Next · {labelOf(following.props.title) || `Slide ${index + 2}`}</span>}
        </div>
        <div className={styles.notesBody}>{current.notes.length > 0 ? current.notes : <p className={styles.notesEmpty}>No notes for this slide.</p>}</div>
      </aside>}
      {panel === 'overview' && <Overview slides={slides} index={index} total={total} onPick={(position) => { go(position); setPanel(null); stageRef.current?.focus({ preventScroll: true }) }} />}
      {panel === 'help' && <div className={styles.help} role="region" aria-label="Keyboard shortcuts" data-presenter-chrome="">
        <table><tbody>{SHORTCUTS.map(([keys, action]) => <tr key={keys}><td><kbd>{keys}</kbd></td><td>{action}</td></tr>)}</tbody></table>
      </div>}
      {blank && <div className={styles.blank} onClick={() => setBlank(false)} aria-hidden="true" />}
      <div className={styles.srOnly} aria-live="polite">{`Slide ${index + 1} of ${total}${label ? `: ${label}` : ''}`}</div>
    </div>,
    document.body,
  )
}
