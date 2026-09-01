---
name: moa-add-page
description: Write a new MDX report page into a project on the local MOA hub (default port 5001) — front-matter exports, sidebar group/order, the built-in shared components (Stats, DataTable, Checks, Issues, Timeline, Progress, Callout, Badge, Lessons, Rules, MediaGrid), media placement, and mobile-safe layout. Use when asked to add a page/report/doc to moa or the hub (모아에 문서·리포트·페이지 추가), to write up results as an mdx report, or to update an existing hub document.
---

# Add a document (.mdx) to the MOA hub

`<hub root>` below means the directory where MOA runs — the checkout containing `registry.json` and `projects/`, commonly a folder named `moa`. If you don't know where it is, ask the user or check what's serving port 5001 (`lsof -i :5001`).

One **top-level `.mdx` file in a project folder** is one page
(`/p/<slug>/<filename>`). Saving the file auto-refreshes any open browser within a few seconds — no server restart needed.

If the project doesn't exist yet, create it first with the `moa-add-project` skill.

## Where to write

```bash
ls -l <hub root>/projects/<slug>     # if it's a symlink, the arrow shows the target
realpath <hub root>/projects/<slug>  # absolute path of the target
```

For a registered external project, write **directly into the target folder** (writing through the symlink gives the same result).
Files in subfolders are not collected — always the top level of that folder.

## Document skeleton

```mdx
export const title = 'Document title'
export const group = 'Sidebar group'
export const order = 10
export const date = '2026-08-31'

# Document title

Body…
```

- The top meta exports must be **literals only**. The sidebar index reads them with a regex, so variables, templates, and expressions are not picked up
  (`export const order = 10` works; `export const order = N + 1` does not)
- The sidebar groups by `group` and sorts by `order` ascending within each group (missing → 99 → title order)
- `date` is `YYYY-MM-DD`. The project card's "updated" value is the latest `date` across its documents
- The filename is the URL slug — English kebab-case recommended

## Shared components (no import needed — injected globally via MDXProvider)

`Stats` `DataTable` `Checks` `Issues` `Timeline` `Progress` `Callout` `Badge` `Lessons` `Rules` `MediaGrid` `Updated` `FooterNote`

```mdx
<Stats items={[{ label: 'Done', value: '2:30.4', sub: '27 clips' }, { label: 'Cost', value: '$120', accent: true }]} />

<DataTable cols={['Phase','Clips','Cost']} rows={[['P1','4','$10'],['Total','17','$42']]} note="※ footnote" />

<Checks items={['✅ Completed item', 'Not done yet']} />

<Issues items={[{ sev: 'high', t: 'Title', d: 'Description' }]} />     {/* sev: high | warn | done */}
<Timeline items={[{ d: '08-31', t: 'Task', accent: true, now: true }]} />
<Progress label="Progress" value={62} sub="17 of 27" />
<Callout type="warn" title="Caution">Body</Callout>                     {/* type: info | warn | success | danger */}
<Badge tone="live">In progress</Badge>                                  {/* tone: live | wait | done | muted */}
<Lessons keep={[{ t:'', d:'' }]} fix={[{ t:'', d:'', fix:'' }]} />
<Rules items={[{ no: 'R1', t: 'Rule', d: 'Description' }]} />
<MediaGrid cols={3} items={[{ src:'/<slug>/still-01.png', cap:'Shot 1' }, { src:'/<slug>/clip.mp4', cap:'Clip', video:true }]} />
<Updated at="2026-08-31" />
<FooterNote>Footer note</FooterNote>
```

Full catalog with live-rendered examples: `projects/guide/components.mdx` (in the browser at `/p/guide/components`).
Markdown tables (GFM) work too, and tables are automatically wrapped in a horizontal scroll box.

## Project-local components

Put them in `../src/*.jsx` next to the document and import them by relative path. **The only dependency is `react`** — no other npm packages can be imported.
JSON imports and relative-path imports work as-is (bundled with esbuild at request time).

## Media

Put files in `<hub root>/public/<slug>/` and reference them from the document by absolute path `/<slug>/filename`.
`public/` is untracked by git, so project media can't be committed by accident.

## Mobile (phone viewport 390px, content 350px)

**Fixed px lower bounds** in inline-style grid/flex push the page sideways. Cap only the upper bound:

- `minmax(380px, …)` → `minmax(min(380px, 100%), 1fr)`
- `minWidth: 380` → `minWidth: 'min(380px, 100%)'`
- fixed 3 columns `230px 1fr 74px` → `minmax(0, min(230px, 40%)) minmax(0, 1fr) 56px`

## Content rules

- Numbers must be **measured only**. Label estimates as estimates, and state clearly in the document when data is demo/fake
- Don't fill in things that don't exist as if they do — write "not verified" for anything you couldn't verify

## Verify — without a browser

Even when the server is locked behind owner login and curl gets 401, you can run the index and compile directly:

```bash
cd <hub root>
node --input-type=module -e '
import { buildIndex } from "<hub root>/lib/content.mjs";
import { bundleDoc } from "<hub root>/lib/bundle.mjs";
const p = buildIndex().projects.find(p => p.slug === "<slug>");
console.log(JSON.stringify(p.docs, null, 2));                       // did the meta get picked up?
const r = await bundleDoc("<absolute path to document>.mdx");
console.log(r.error ? "ERROR: " + r.error : "compile ok " + r.code.length + "B");
'
```

If `docs[]` shows the expected title/group/order/date and the compile passes, you're done.
View at `http://localhost:5001/p/<slug>/<document filename>`.
If the compile breaks, only that document shows an error — the hub stays up.
