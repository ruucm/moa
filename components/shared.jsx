'use client'

// Public MDX API. Keep names and props stable for registered and external reports.
export {
  Updated, Stats, DataTable, Issues, Lessons, Rules, Timeline, Checks,
  FooterNote, Callout, Progress, Badge, Figure, MediaGrid, MarkdownTable as table,
} from './report/index.jsx'
// Slide decks: <Deck> with <Slide>s (and <Notes>, <SlideGrid>, <SlideChecklist> inside them).
export { Deck, Slide, Notes, SlideGrid, SlideChecklist } from './report/deck.jsx'
// Every image in a document is click-to-zoom, including plain Markdown ones.
export { ZoomableImage as img } from './report/lightbox.jsx'
