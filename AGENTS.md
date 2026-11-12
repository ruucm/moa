# MOA — self-hosted hub for AI work reports

One Next.js (App Router) server on port **5001** serves MDX reports from every project —
no per-project web servers. Docs are bundled on request with esbuild (runtime compile),
so a broken `.mdx` only errors that one page; the hub stays up. Relative imports inside
docs (`../src/*.jsx`) and JSON imports work.

## Layout

- `projects/<slug>/` — a project (plain folder, or a **symlink** to an external folder)
- `demo/projects/<slug>/` — demo/sample data (shown in a separate "Demo" section)
- `registry.json` — externally registered projects `{ slug, path, title, status }` (untracked)
- `shares.json` — share-link tokens (untracked — contains secrets)
- `pins.json` — each account's pinned pages (untracked)
- `app/` pages & API routes · `lib/` server logic · `components/` UI
  (`components/shared.jsx` = global MDX components)
- `middleware.js` — global auth gate · `scripts/set-password.mjs` — owner password setup

## Auth (team accounts + owner login)

The whole server is locked. Unauthenticated page loads redirect to `/login`; APIs return 401.

Two account kinds — **team accounts** (`users.json`, email + password, role `admin`|`member`)
and the **owner password** (`.env.local`; log in with the email field empty = admin).

```bash
npm run set-password -- <password>              # owner password (.env.local, restart required)
npm run add-user -- <email> <name> <pw> admin   # add an account directly (users.json — no restart)
```

- **Roles**: `member` sees only invited projects (the account's `projects` array), with live
  updates. `admin` sees everything. Admin-only APIs
  (`/api/chat`·`trigger`·`add`·`remove`·`browse`·`order*`·`hide`·`projects/update`·`doc/update`·`share*`·`session*`·`users*`·`claude`)
  are double-guarded: middleware path blocking + route guards (`guardAdmin` in `lib/api.mjs`).
  `/api/projects`·`/api/doc`·`/api/watch` filter by the member's `projects`.
  (Note: `public/` media is reachable by any logged-in member who guesses the path.)
- **Invites**: a project sidebar's "👥 Invite" (that project only) or hub ⚙ settings →
  invite link (`/join/<token>`, 7 days, single-use) → invitee sets name/email/password.
  Per-member project access is editable in ⚙ settings.
  API: `GET /api/users` · `POST /api/users/invite {role?, projects?}` (`{remove: token}`
  revokes) · `POST /api/users/update {id, disabled|remove|projects}` ·
  `POST /api/signup {token,email,name,password}` (public).
- **Password reset** (team accounts only — there is no self-service "forgot password"): an admin
  clicks a member's "Reset password" in ⚙ settings → Team members, which copies a reset link
  (`/reset/<token>`, 24 hours, single-use) to hand over. Its holder sets a new password (6+
  characters) and is logged in; the account id, role, projects and pins stay. The old password
  works until the link is used, a new link replaces the account's earlier one, and pending links
  are listed under "Pending password resets" with Revoke (disabling the account drops its pending
  link, so Reactivate doesn't revive it). users.json keeps only a sha256 of each
  token (`resets`), so a lost link can't be copied again — make a new one. The reset ends every
  session issued before it: `getAuth` refuses a `moa_user` cookie whose `iat` predates the
  account's `passwordChangedAt`, and the UI sends such a tab to `/login`. The owner password
  is reset with `npm run set-password` instead.
  API: `POST /api/users/reset {id}` → `{token, exp}` (`{id, remove: true}` revokes) ·
  `GET /api/reset-password?token=…` · `POST /api/reset-password {token,password}` (public).
- **Cookies**: owner `moa_owner` 30d · team `moa_user` 7d (HMAC-signed). Disabling an
  account or resetting its password takes effect immediately for every API (`getAuth` checks
  users.json on every request); the edge middleware can't read users.json, so a stale cookie
  still opens page shells and `public/` media until it expires.
- Agents using the HTTP API log in first to get a cookie:
  ```bash
  curl -s -c /tmp/moa.jar -X POST http://localhost:5001/api/login \
    -H 'Content-Type: application/json' -d '{"password":"…"}'   # or {"email":"…","password":"…"}
  curl -s -b /tmp/moa.jar http://localhost:5001/api/projects     # then pass -b /tmp/moa.jar
  ```
- `GET /api/me` → `{role, name, email}`. `/api/projects` marks `owner:true` (admin) /
  `member:true` for the UI.
- `MOA_NO_AUTH=1` disables auth — only for machine-local use.
- With no password/accounts configured, everything stays locked (safe default on an open port).

## Sharing one document externally

The **🔗 Share** button in a doc's sidebar copies a share URL (`/s/<token>`). The recipient
sees **that one document only** — other docs, projects, APIs and media are blocked.

- Creating a share scans the doc source and whitelists only the media paths it uses
  (`/<slug>/…`) plus any configured proxies for embeds.
- Link previews in chat apps: scrapers often refuse og:images on non-standard ports. If you
  care, port-forward external 80 → 5001 and set `MOA_PUBLIC_ORIGIN=http://<public-host>`
  in `.env.local` to pin the OG base URL (otherwise the request Host is used).
- Manage/revoke from hub ⚙ settings → "Shared doc links". Revocation is immediate
  (already-issued guest media cookies expire within 6h).
- API: `GET /api/share` list · `POST /api/share {slug,doc}` create (token reused, scope
  rescanned) · `POST /api/share/remove {token}` revoke.
- Guest cookie: 6h signed cookie, renewed on each doc open while the token lives.

## Registering external projects

Home ⚙ → browse folders → `+ Add`. Registering a real folder creates a
`projects/<name>` symlink + a `registry.json` entry. Originals are never modified.

Via API (agents — login cookie required):

```bash
curl -s -b /tmp/moa.jar "http://localhost:5001/api/browse?path=$HOME/work"
curl -s -b /tmp/moa.jar -X POST http://localhost:5001/api/add \
  -H 'Content-Type: application/json' -d '{"path":"'$HOME'/work/my-project"}'   # register
curl -s -b /tmp/moa.jar -X POST http://localhost:5001/api/remove \
  -H 'Content-Type: application/json' -d '{"slug":"my-project"}'                # unregister (folder kept)
```

- Browsing/registration is confined to `MOA_BROWSE_ROOT` (default: home directory).
- Only **top-level** `.mdx` files of a registered folder are collected. If docs live
  deeper (e.g. `…/docs`), register that subfolder.

### Card order (drag to sort)

Drag home cards to reorder; saved instantly (mouse only). Stored as `order` in steps of 10
in `registry.json` (unregistered projects go under `registry.order[slug]`).

```bash
curl -s -b /tmp/moa.jar -X POST http://localhost:5001/api/order \
  -H 'Content-Type: application/json' -d '{"slugs":["a","b","c"]}'   # order 10/20/30
```

### Sidebar group order (drag to sort)

The top of a project's sidebar list holds its groups and the pages outside any group. By default the groups come
first, by `order`, and the pages outside any group after them. An admin drags a group onto the place of another item
there — a group or a page outside any group — or focuses a group and presses Alt+↑/↓ to move it one place. A page
is dragged there too, out of its group when it was in one: onto the top edge of a group's heading to go above the
group (the bottom edge of a closed group's heading to go below it), onto the upper or lower half of a page outside
any group to go above or below it, or into the gap between two items; dropped on the middle of a group's heading or
on its pages, it joins the group instead (see "Renaming and moving pages" below). The arrangement is saved at once
under `registry.groupOrder[slug]` and shown to every reader: saved items first, as saved; a group not in it after the
last saved group, by `order`; a page outside any group not in it at the end. What is saved is the list down to the
last group, the moved item, or a page saved before, so pages outside any group below that are left out: they keep
following the sort menu, like a new page. The sidebar's sort menu orders the pages inside each group and the pages
outside any group that are left out, and never moves a group or a saved page. Only the project's current group names
and `{ "doc": slug }` items for its pages outside any group are kept; `[]` resets to the default.

A group that isn't in the saved order has its place by the `order` of its first page, so a page that changes groups
could carry a group to another place. The sidebar keeps the groups where they stand: when a page's move would shift
them — or when a new group, or a page taken out of its group, wouldn't stand where it is put — it saves the top of
the list along with the move, from its start as far down as it takes. What stands below keeps following `order` and
the sort menu, so a group written later still finds its place among the groups nobody arranged.

```bash
curl -s -b /tmp/moa.jar -X POST http://localhost:5001/api/order/groups \
  -H 'Content-Type: application/json' -d '{"slug":"my-project","groups":["Overview",{"doc":"read-me-first"},"References"]}'
```

### Pinned pages

Every signed-in reader — admin or invited member — pins pages for themselves with the pin at the end
of a page's row in a project's sidebar (it shows with the pointer or keyboard focus on the row, and
always on a touch screen). The reader's pinned pages gather in a **Pinned** group above everything
else in the sidebar, the latest pin first, in any browser they sign in from; other people do not see
them. Each page also stays in its own group, and in the Pinned group it is shown with its group's
name. The Pinned group shows only while something is pinned and folds like any group. Saved instantly
in `pins.json` per account (`owner` for the owner password, `user:<id>` for a team account) as
document slugs: a pin goes by the file name, so renaming the file unpins it, and a pin whose file is
missing shows again when the file is back. A member pins only in invited projects.

```bash
curl -s -b /tmp/moa.jar -X POST http://localhost:5001/api/pin \
  -H 'Content-Type: application/json' -d '{"slug":"my-project","doc":"weekly-report","pinned":true}'
```

### Renaming and moving pages

An admin renames a page from its menu — a right click on its row, a long press on a touch screen, or Shift+F10 on
its link — or with F2 on the link: Enter or leaving the field saves, Esc keeps the old title. The menu also opens
the page in a new tab (one of moa's own, see "Tabs" below) or a new window and copies its link (what the browser's
own link menu offered before the menu took the right click; a right click with Shift held still opens the browser's
menu), moves the page into a new group or out of its group, and pins or archives it.

An admin moves a page by dragging it, with Alt+↑/↓ on its link, or from its menu:

- **Inside its group.** Dragged over the pages of its group, a page goes above the page whose upper half it is
  dropped on, or below the one whose lower half; a line shows the place. Alt+↑/↓ moves it one place up or down.
- **Into another group.** Dropped among that group's pages, it goes to that place; dropped on the group's heading,
  it becomes the group's last page, and a closed group opens to show it arrive. Alt+↑ on the first page of a group
  takes it into the group above, as its last page; Alt+↓ on the last page, into the group below, as its first. A
  page outside any group goes into the nearest group above or below it the same way.
- **Into a new group.** Move to new group in the menu: the group's name is typed in a field above the page (Enter
  or leaving the field moves the page into it; Esc, no name, or the name of the group it is in leaves it there).
  The new group gets a place of its own: right below the group the page left (in that group's place, when the page
  was its only one); in the page's own place, when it stood outside any group where an admin had put it; or right
  above the pages outside any group that follow the sort menu. A name some group already has puts the page at the
  end of that group; an archived group's is refused, as the page would be archived with it.
- **Out of its group.** Remove from group in the menu puts the page right below the group it leaves, at the top of
  the list; dragged between the groups, it goes where it is dropped. Its place is saved like that of any page
  outside any group ("Sidebar group order" above). A group left without a page is gone.

A title and a group are saved at once in the page's `.mdx` — its `export const title` or `group` literal is
rewritten where it stands (a missing group goes on the line after the title) and the rest of the file is kept byte
for byte — so every open reader sees the change through the usual live reload. The text is kept on one line, at
most 200 characters, without a backslash, between quotes it doesn't contain (`'` or `"`; a backtick only for text
with both). A page that sets its title or group in code, and a demo project, can't be changed this way. A tool that
regenerates a page writes its own title and group back.

```bash
curl -s -b /tmp/moa.jar -X POST http://localhost:5001/api/doc/update \
  -H 'Content-Type: application/json' -d '{"slug":"my-project","doc":"weekly-report","title":"Week 12","group":"Reports"}'
```

Send `title`, `group` or both; `"group": ""` takes the page out of its group.

The place of a page among the pages of its group is saved in the registry, under `pageOrder[slug][group]`, as the
file names of the group's pages in order; the files are not touched. Those pages come first, as saved, and a page
not among them — written into the group since — follows them, by `order`. That is the sort menu's Default order.
Sorted by name or by last update, no page has a place of its own: a page dropped among the pages of its own group
goes nowhere (the list says why), one dropped on another group joins it where the sort puts it, and Alt+↑/↓ takes
it straight into the next group. Only the pages the group holds are kept, once each; `[]` goes back to the pages'
`order`.

```bash
curl -s -b /tmp/moa.jar -X POST http://localhost:5001/api/order/pages \
  -H 'Content-Type: application/json' -d '{"slug":"my-project","group":"Reports","docs":["week-12","week-11","summary"]}'
```

Sort rule (`lib/content.mjs`): `order` ascending → missing = 99 → title `localeCompare`.
A `title` in `registry.json` overrides `_meta.json`.

### Archived pages and groups

An admin archives a page from its menu (Archive), or a whole group from the menu of the group's heading (a right
click, a long press, or Shift+F10). Archived pages and groups leave the list for an Archived group at its end,
closed until opened, where every reader finds them — a page with the name of its group beside it, a group with its
pages. The files are untouched: the pages still open, search and share. Unarchive (or Unarchive group) brings them
back. Saved under `registry.archived[slug]` as `{ groups: [...], docs: [...] }`, by group name and file name like
the group order and the pins, so a page written later into an archived group is archived with it. A pinned page
that is archived leaves the Pinned group until it is back.

```bash
curl -s -b /tmp/moa.jar -X POST http://localhost:5001/api/archive \
  -H 'Content-Type: application/json' -d '{"slug":"my-project","group":"2025 episodes","archived":true}'
```

Send `doc` or `group` with `archived` true or false.

### Title and description

Edit what the hub shows for a project from its card's `···` menu ("Edit details"), or via API:

```bash
curl -s -b /tmp/moa.jar -X POST http://localhost:5001/api/projects/update \
  -H 'Content-Type: application/json' -d '{"slug":"my-project","title":"New title","description":"One line"}'
```

A registered project keeps the change in `registry.json` (the connected folder is untouched);
a local project writes it to its `_meta.json`. The title is required; an empty description hides
the line.

## Claude chat (headless runs from the web)

A project sidebar's **💬 Claude chat** opens a chat panel. The server spawns
`claude -p <prompt> --output-format stream-json --verbose` in the project root and streams
stdout (NDJSON) — text, tool calls, results. No API key needed (uses the local `claude` login).

- `POST /api/chat` — `{ slug, prompt, sessionId?, dangerous? }` → NDJSON stream. First line
  `{type:"moa-run",runId}`, then claude stream-json events; `{type:"moa-error"}` on failure.
- `POST /api/chat/stop` — `{ runId }` aborts; the process dies even if the browser is gone.
- Continue a conversation: send the response's `session_id` back as `sessionId` (`--resume`).
- Permissions: default `--permission-mode acceptEdits` (file edits auto-approved, Bash
  denied). The UI's **auto-approve** toggle (= `dangerous: true`) uses `bypassPermissions` —
  everything runs, use with care.
- Only registered projects can run; all of this is admin-only.

### Session persistence & history

- **localStorage**: per-project `hub.chat.<slug>` stores `{sessionId, items}` (last 200
  items, tool output truncated at 4000 chars). Reload restores; next message resumes.
  **New session** clears both.
- **History**: reads `~/.claude/projects/<encoded-cwd>/*.jsonl` and lists sessions;
  picking one restores it in the panel and continues it. Terminal-run sessions with the
  same project root appear too.
- `GET /api/sessions?slug=…` → `{ root, dir, sessions: [{id, mtime, size, title}] }`
  (latest 40; title = first user message)
- `GET /api/session?slug=…&id=…` → `{ id, items, skipped }` — transcript converted to chat
  items. Long sessions return the last 400 items and report the rest as `skipped`.
  Sidechains (subagents) and thinking blocks are excluded.

## Search (⌘K)

**⌘K** (Ctrl+K elsewhere), or the search icon at the top of a project's sidebar and in the hub's top bar,
opens one search over every page the reader may open — admins: every project the hub shows; members: their
invited projects. It finds a page by its title, its group, its project or the words on the page, lists the
best matches first (the current project's pages ahead of equal matches elsewhere) with the passage around the
match, and ↑ ↓ ↵ open one (⌘↵ in a new tab of moa's own, see "Tabs" below). Before anything is typed it lists
the pages updated last. The sidebar has no filter box of its own any more.

Beside the list, on screens 768px and wider, the selected page is previewed as it renders — the same bundle
the reader shows (`/api/doc`), read-only: the page is inert, so nothing in it takes a click or a key. The
preview follows ↑ ↓ and the pointer, its header copies the page's link or opens it in a new tab, and a click on
the page opens it. The panel icon in the search field hides the preview; the choice is kept in the browser
(`hub.search.preview`). Phones show the list only.

```bash
curl -s -b /tmp/moa.jar "http://localhost:5001/api/search?q=weekly%20report&from=my-project"
# → { query, terms, total, results: [{ slug, project, doc, title, group, date, mtime, excerpt, match, score }] }
```

`from` is the project the reader is in (ranked up, and searched even if hidden from the hub); `limit` caps the
results (40 by default, 100 at most); without `q` the response lists the most recently updated pages. The page
text is read once and kept in memory until the file changes (`lib/search.mjs`).

## Tabs

A page opened in a new tab — Open in new tab in a page's menu, ⌘↵ in the search or the new-tab link of its
preview — joins a strip of tabs across the top of the window, like a browser's or Notion's. The strip shows only while
the window holds two tabs or more, and takes no room otherwise. A tab shows its page where the reader left it (its
scroll position); a page followed in a tab becomes that tab's page; Back and Forward return to the tab a page was
opened in. The × or a middle click closes a tab (the one on screen gives its place to its neighbour), a tab dragged
along the strip moves there, + opens the projects in a new tab, and from the keyboard the strip is one stop on the
tab on screen: the arrow keys go along it and Delete closes a tab. A link clicked with a modifier key still opens a
browser tab or window.

The tabs are each window's own, kept in its sessionStorage (`moa.tabs`, `lib/tabs.js`): a reload keeps them, and a
new window — Open in new window, another browser tab, the installed app opened again — starts with its page alone.
Every page is a full page load, so the strip (`features/tabs/TabStrip.jsx`, in the root layout) renders once the page
has loaded, into room a script in the page's head made before the first paint (`html[data-tabs]`). A sticky part of a
page sticks under the strip with `top: var(--moa-tabs-h)` (0 without the strip).

## Agent contract (publishing reports)

1. **New project**: create `projects/<slug>/` + `_meta.json` (or use the register API):
   ```json
   { "title": "Title", "description": "One-liner", "status": "active", "order": 10 }
   ```
   - `status`: `active` | `paused` | `done` | `archived`
   - `order`: home-card sort (lower = first)
2. **Report**: `projects/<slug>/<doc>.mdx` — saving the file refreshes open browsers within
   seconds (SSE watch), no restart.
   - Top-of-file meta: `export const title / group / order / date` (`YYYY-MM-DD`) —
     **literals only** (the sidebar index parses them with a regex). An admin's rename or move in the sidebar
     rewrites the `title` / `group` literal in the file, so read a page again before rewriting it
   - Sidebar groups by `group`, sorts by `order` ascending — the groups first, then the pages without a
     `group`, unless an admin dragged them into another arrangement ("Sidebar group order" above; the pages
     inside a group, "Renaming and moving pages"), and below the reader's own Pinned group ("Pinned pages" above). Readers can sort the pages inside each group by
     title (numeric-aware) or by file mtime from the sidebar's sort menu; the choice is kept per
     project in the browser
   - For registered external projects, write the `.mdx` into the original folder
     (the symlink target)
   - Project-local components live next to the docs (`../src/*.jsx`, relative import) —
     the only dependency available is `react` (no other npm imports)
3. **Media**: put files in `public/<slug>/` and reference them as `/<slug>/<file>` absolute paths
4. **Mobile**: fixed px minimums in inline grid/flex styles push the page sideways on
   phones (viewport 390px, content 350px).
   `minmax(380px, …)` → `minmax(min(380px, 100%), 1fr)` ·
   `minWidth: 380` → `minWidth: 'min(380px, 100%)'` ·
   fixed 3-col (`230px 1fr 74px`) → `minmax(0, min(230px, 40%)) minmax(0, 1fr) 56px`.
   Tables are auto-wrapped in a horizontal scroll box (`.table-wrap`) — use them as-is.
   Markdown tables and `DataTable` size their columns for a narrow screen: under 40rem a column of
   long text keeps 10–18em so its lines stay readable and the table scrolls sideways in its box.
   A component wider than a phone screen is cut at the column's edge rather than pushing the whole
   page sideways — so a `white-space: nowrap` line longer than ~350px is cut there; let it wrap.

## Shared components (no import needed — injected via MDXProvider)

`Stats` `DataTable` `Checks` `Issues` `Timeline` `Progress` `Callout` `Badge` `Lessons`
`Rules` `Figure` `MediaGrid` `Updated` `FooterNote` — and for slide decks `Deck` `Slide` `Notes`
`SlideGrid` `SlideChecklist`

Implementation: `components/shared.jsx` · usage with live examples:
`projects/guide/components.mdx` (in the browser: `/p/guide/components`)

- **Slide decks** — `<Deck>` holding `<Slide>`s makes the document a presentation: every slide is a
  card in the page, **Present** shows them full screen (keys: → · N notes · O overview · T timer · F ·
  Esc). A slide is a fixed 960 px canvas scaled as one piece, so it looks the same as a card and on a
  projector; Markdown and the components above work inside it. Saving the file updates an open
  presentation in place — same slide, running timers kept. Layouts, props and keys:
  `projects/guide/slides.mdx` (`/p/guide/slides`) · implementation `components/report/deck.jsx`.

- **Images are click-to-zoom** — `Figure`, `MediaGrid` and Markdown `![]()` images all open the
  same viewer (`components/report/lightbox.jsx`); every image on the page is one gallery, so
  ← / → steps through them. A raw `<img>` tag in MDX is left alone by MDX, so it stays static —
  use `<Figure src cap wide />` instead. Don't hand-roll a lightbox in a document.

- Record measured numbers only; mark estimates as estimates. Label demo/fake data clearly.

## Proxies to other local tools

`next.config.mjs` reads `MOA_PROXIES` (e.g. `studio:5300,review:5318`) and rewrites
`/<name>/*` → `http://127.0.0.1:<port>/*`, so docs can embed live local tools same-origin.
Matching is per path segment — no prefix collisions.

## Server

```bash
npm run dev                   # next dev -p 5001 -H 0.0.0.0 (development / daily use)
npm run build && npm start    # production — recommended when exposed (no error overlay)
```

- Routes: `/` hub · `/p/<project>` · `/p/<project>/<doc>` · `/s/<token>` · `/login`
  (legacy hash URLs `#/<project>/<doc>` redirect automatically)
- macOS double-click launcher: `start-moa.command` — frees port 5001, starts dev, opens
  the browser. Ctrl+C in the window to stop.
- Background: `nohup npm run dev > /tmp/moa.log 2>&1 &`
- If 5001 is taken, check with `lsof -i :5001` (`next dev` silently picks another port —
  avoid that).
