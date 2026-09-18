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
  (`/api/chat`·`trigger`·`add`·`remove`·`browse`·`order`·`hide`·`share*`·`session*`·`users*`·`claude`)
  are double-guarded: middleware path blocking + route guards (`guardAdmin` in `lib/api.mjs`).
  `/api/projects`·`/api/doc`·`/api/watch` filter by the member's `projects`.
  (Note: `public/` media is reachable by any logged-in member who guesses the path.)
- **Invites**: a project sidebar's "👥 Invite" (that project only) or hub ⚙ settings →
  invite link (`/join/<token>`, 7 days, single-use) → invitee sets name/email/password.
  Per-member project access is editable in ⚙ settings.
  API: `GET /api/users` · `POST /api/users/invite {role?, projects?}` (`{remove: token}`
  revokes) · `POST /api/users/update {id, disabled|remove|projects}` ·
  `POST /api/signup {token,email,name,password}` (public).
- **Cookies**: owner `moa_owner` 30d · team `moa_user` 7d (HMAC-signed). Disabling an
  account takes effect immediately (`getAuth` checks users.json on every request).
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

Sort rule (`lib/content.mjs`): `order` ascending → missing = 99 → title `localeCompare`.
A `title` in `registry.json` overrides `_meta.json`.

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
     **literals only** (the sidebar index parses them with a regex)
   - Sidebar groups by `group`, sorts by `order` ascending. Readers can re-sort the groups by
     name (numeric-aware) or by file mtime from the sidebar's sort menu; the choice is kept per
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

## Shared components (no import needed — injected via MDXProvider)

`Stats` `DataTable` `Checks` `Issues` `Timeline` `Progress` `Callout` `Badge` `Lessons`
`Rules` `Figure` `MediaGrid` `Updated` `FooterNote`

Implementation: `components/shared.jsx` · usage with live examples:
`projects/guide/components.mdx` (in the browser: `/p/guide/components`)

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
