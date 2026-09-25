# MOA

**Your agents do the work. MOA is where you read it.**

A self-hosted report hub for the AI-agent era. Agents (Claude Code etc.) write MDX
reports straight to your disk — MOA serves them as a live, shareable workspace on one
port. No uploads, no typing.

<img src="docs/images/home.png" alt="MOA home hub: a quiet project list with search, status filters, and report counts" width="100%">

<img src="docs/images/report.png" alt="An MDX report rendered with built-in components: stat tiles, tables, callouts" width="100%">

Screenshots show fictional sample projects in the English interface.

## Quickstart

```bash
git clone https://github.com/ruucm/moa.git && cd moa
npm install
npm run set-password -- <your-password>
npm run dev        # → http://localhost:5001
```

Local-only, no auth: `MOA_NO_AUTH=1 npm run dev`

## Publishing a report

The whole contract — for humans and agents alike:

```mdx
// projects/my-project/week-1.mdx
export const title = 'Week 1 results'
export const group = 'Weekly'
export const date = '2026-09-01'

<Stats items={[{ label: 'Done', value: '12', accent: true }]} />
```

Save the file — open browsers refresh in seconds. Media goes in `public/<slug>/`.
Built-in components (no imports): `Stats` `DataTable` `Checks` `Issues` `Timeline`
`Progress` `Callout` `Badge` `Lessons` `Rules` `MediaGrid` `Updated` `FooterNote`.

**Point your agent at [`AGENTS.md`](AGENTS.md)** — full conventions + HTTP API. Ready-made
Claude Code skills ship in [`.agents/skills/`](.agents/skills).

## Features

- **Live reload** — SSE file watching, no restarts
- **Reader controls** — collapsible sidebar, plus view options for small text, full width and the table of contents; remembered across documents
- **Register any folder** — external projects are symlinked in, originals untouched
- **Share one doc** — tokenized link, recipient sees that doc only
- **Team accounts** — per-project invites, admin/member roles
- **Claude chat in the browser** — headless `claude` per project, streamed live, resumable sessions
- **Locked by default** — password auth, safe on an open port

## Config

All optional — see [`.env.example`](.env.example). Production: `npm run build && npm start`.
macOS-first (Claude chat assumes it); the viewer runs anywhere Node 18+ does.

## Design system and verification

Shared styles live in `styles/`, interface components in `components/ui/`, and
MDX report components in `components/report/`. See [the verification guide](docs/design-verification.md)
for feature coverage and instructions to reproduce the English screenshots.

[MIT](LICENSE)
