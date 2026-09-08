// Run only against `npm run dev:review` (or review-server --production).
// Screenshots use fictional English content; the original fixture files are restored.
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import verifyReviewServer from '../tests/verify-review-server.mjs'
import { reviewRoot, reviewPassword } from './review-fixtures.mjs'

await verifyReviewServer()
const originals = new Map()
const replace = (file, contents) => {
  if (!originals.has(file)) originals.set(file, fs.readFileSync(file))
  fs.writeFileSync(file, contents)
}
const examples = [
  ['moa-design', 'A clearer workspace', 'A calmer place to read, reflect, and move work forward.'],
  ['brand-notes', 'The next chapter', 'Finding the words and visual language that feel like us.'],
  ['product-research', 'Product research', 'Listening closely to find what could work better.'],
  ['content-studio', 'Content studio', 'Ideas taking shape, from the first note to publication.'],
  ['team-playbook', 'Our team playbook', 'The principles and small lessons we gather along the way.'],
  ['service-archive', 'Service archive', 'A record of thoughtful improvements and problems solved.'],
  ['guide', 'MOA design system', 'Shared foundations and components for a familiar experience.'],
]
const report = `export const title = 'A little clarity goes a long way'
export const group = 'Project overview'
export const order = 1
export const date = '2026-09-08'

# A little clarity goes a long way

Good notes make the next step easier. This week, we brought our research, decisions,
and progress together so everyone can pick up where the work left off.

<Badge tone="live">In progress</Badge> <Badge tone="muted">Sample project</Badge>

## This week, at a glance

Start with the essentials, then take your time with the details.

<Stats items={[
  { label: 'Reports organized', value: '12', sub: 'One shared source of context' },
  { label: 'Tasks completed', value: '8', sub: 'Small steps, steady progress' },
  { label: 'Weekly progress', value: '67%', sub: 'Getting closer, together', accent: true }
]} />

<Callout type="info" title="Make room for the reader">
A clear heading gives direction. A little space makes an idea easier to absorb.
Together, they help the important details find their place.
</Callout>

## Small details, shared standards

We use the same language for the same purpose. Shared components make each new
report feel familiar, while leaving room for the work itself.

<DataTable cols={['Workstream', 'Focus', 'Done', 'Status']} rows={[
  ['Reading experience', 'Documents and navigation', '4', 'Complete'],
  ['Shared components', 'Design system', '3', 'Complete'],
  ['Mobile review', 'Responsive layouts', '1', 'In progress'],
  ['Total', 'All workstreams', '8', 'On track']
]} note="Fictional project and example figures, created for this screenshot." />

## What comes next

<Checks items={['✅ Clarify document headings and body text', '✅ Align button and form states', 'Review long tables on small screens', 'Bring team feedback into the next iteration']} />

<Progress label="This week" value={67} sub="8 of 12 example tasks complete" />

<FooterNote>Sample project. All names, content, and figures are fictional.</FooterNote>
`
const browser = await chromium.launch()
try {
  const registryFile = path.join(reviewRoot, 'registry.json')
  const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'))
  for (const [slug, title, description] of examples) {
    const dir = path.join(reviewRoot, 'projects', slug)
    const meta = path.join(dir, '_meta.json')
    replace(meta, JSON.stringify({ ...JSON.parse(fs.readFileSync(meta)), title, description }))
    const registered = registry.projects.find(project => project.slug === slug)
    if (registered) Object.assign(registered, { title, description })
    for (const name of fs.readdirSync(dir).filter(name => name.endsWith('.mdx'))) {
      const file = path.join(dir, name)
      if (name === 'overview.mdx') replace(file, report)
      else if (slug === 'moa-design') {
        const order = name === 'long-content.mdx' ? 5 : Number(name.match(/\d+/)?.[0]) || 2
        const title = ({2:'Observations and lessons',3:'Weekly notes',4:'Next steps',5:'Reading on small screens'})[order]
        replace(file, `export const title = '${title}'\nexport const group = 'Work notes'\nexport const order = ${order}\n\n# ${title}\n\nFictional notes for a sample project.\n`)
      }
    }
  }
  replace(registryFile, JSON.stringify(registry, null, 2))
  const context = await browser.newContext({baseURL:'http://localhost:5001', viewport:{width:1440,height:1000},locale:'en-US',reducedMotion:'reduce'})
  const login = await context.request.post('/api/login', {data:{email:'review@moa.example',password:reviewPassword}})
  if (!login.ok()) throw new Error(`Review login failed: ${login.status()}`)
  const page = await context.newPage()
  const output = path.resolve('docs/images')
  fs.mkdirSync(output,{recursive:true})
  const capture = async (route, heading, name, fullPage) => {
    await page.goto(route)
    await page.getByRole('heading',{name:heading,exact:true}).waitFor()
    await page.evaluate(()=>document.fonts.ready)
    const body = await page.locator('body').innerText()
    if (/[가-힣]/.test(body)) throw new Error(`Non-English text on ${route}: ${body.match(/[^\n]*[가-힣][^\n]*/g)}`)
    if (await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)) throw new Error('Horizontal overflow')
    await page.mouse.move(1439,0)
    await page.screenshot({path:path.join(output,name),fullPage,animations:'disabled'})
  }
  await capture('/', 'A clearer workspace', 'home.png', true)
  await capture('/p/moa-design/overview', 'A little clarity goes a long way', 'report.png', true)
  await page.setViewportSize({width:390,height:844})
  await capture('/', 'A clearer workspace', 'home-mobile.png', true)
  await capture('/p/moa-design/overview', 'A little clarity goes a long way', 'report-mobile.png', true)
  console.log('Captured four English screenshots in docs/images using fictional content.')
} finally {
  await browser.close()
  for (const [file, contents] of originals) fs.writeFileSync(file,contents)
}
