'use client'

// Public MDX API. Keep names and props stable for registered and external reports.
export {
  Updated, Stats, DataTable, Issues, Lessons, Rules, Timeline, Checks,
  FooterNote, Callout, Progress, Badge, Figure, MediaGrid, MarkdownTable as table,
} from './report/index.jsx'
// Every image in a document is click-to-zoom, including plain Markdown ones.
export { ZoomableImage as img } from './report/lightbox.jsx'
