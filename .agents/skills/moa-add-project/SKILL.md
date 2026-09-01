---
name: moa-add-project
description: Register a project in the local MOA report hub (default port 5001) — either a plain folder under projects/, or a symlink to an external folder plus a registry.json entry. Use when asked to add/register a project to moa or the hub (모아/허브에 프로젝트 추가·등록), to make a workspace's reports show up on the hub home, or to link a project's moa-docs/docs into moa.
---

# Add a project to the MOA hub

`<hub root>` below means the directory where MOA runs — the checkout containing `registry.json` and `projects/`, commonly a folder named `moa`. If you don't know where it is, ask the user or check what's serving port 5001 (`lsof -i :5001`). All paths below are relative to this root. There are two ways.

| Method | When | Result |
| --- | --- | --- |
| **A. Built-in folder** | Documents only need to live inside moa (guides, tests, notes) | real folder `projects/<slug>/` + `_meta.json` |
| **B. Symlink registration** | The actual working folder lives elsewhere (e.g. `~/work/my-project`) | **symlink** `projects/<slug>` + `registry.json` entry |

If there is an external working folder, **B is the default**. The original folder is left untouched, and documents are written on the original side.

## A. Built-in folder

```bash
cd <hub root>
mkdir -p projects/<slug>
cat > projects/<slug>/_meta.json <<'JSON'
{ "title": "Title", "description": "One-line description", "status": "active", "order": 50 }
JSON
```

`status`: `active` | `paused` | `done` | `archived` · `order`: smaller sorts earlier on the home cards (use steps of 10).
A project with zero `.mdx` documents **does not appear** on the home page — follow up with the `moa-add-page` skill to add one.

## B. Symlink + registry entry

You need **both** the symlink and the registry entry. Registry only, with no symlink, means documents can't be found;
symlink only, without registration, means the project vanishes from the home page when it has zero documents.

```bash
cd <hub root>
TARGET=~/work/my-project/moa-docs/docs   # the folder containing the documents
SLUG=<slug>
ln -s "$TARGET" "projects/$SLUG"
```

Then add an entry to the `projects` array in `registry.json` (don't hand-edit the JSON into breakage — use node):

```bash
node -e '
const fs=require("fs"), f="<hub root>/registry.json";
const r=JSON.parse(fs.readFileSync(f,"utf8"));
r.projects.push({ slug:"<slug>", path:"<absolute TARGET path>", title:"<Title>", status:"active", order:50 });
fs.writeFileSync(f, JSON.stringify(r,null,2)+"\n");
'
```

### Which folder to link

Only the **top-level `.mdx` files of the registered folder** are collected. Subfolders are not scanned.
Hence the convention `<project>/moa-docs/docs` — if the documents are nested, link that folder itself.
If the documents folder doesn't exist yet, create it on the original side with `mkdir -p <project>/moa-docs/docs` and link that.

### Constraints

- The link target must be under the allowed root the hub is configured for (this is what the API enforces — match it when creating by hand)
- If `projects/<slug>` already exists, stop and ask the user (do not overwrite)
- Slugs may only contain `[\w.\-가-힣]` — replace spaces and slashes with `-`
- Broken symlinks (missing target) are silently skipped by the index. After linking, confirm `ls projects/<slug>/` actually shows files

## Doing it via the API (only when the server is up and you know the password)

The whole server is locked behind owner login. If you don't know the password, **direct file manipulation above is the right answer** — don't ask, just do it with files.

```bash
curl -s -c /tmp/moa.jar -X POST http://localhost:5001/api/login \
  -H 'Content-Type: application/json' -d '{"password":"…"}'
curl -s -b /tmp/moa.jar "http://localhost:5001/api/browse?path=$HOME/work"
curl -s -b /tmp/moa.jar -X POST http://localhost:5001/api/add \
  -H 'Content-Type: application/json' -d '{"path":"<absolute path>","title":"<Title>"}'
```

`/api/add` creates the symlink and the registry entry in one go, but does not set `description` or `order` —
if needed, edit `registry.json` afterwards or put a `_meta.json` in the target folder.
Unregister with `POST /api/remove {"slug":"…"}` (the original folder is left intact).

## Verify — without a browser

Even when curl can't see anything because the server returns 401, you can run the indexer directly:

```bash
cd <hub root>
node --input-type=module -e '
import { buildIndex } from "<hub root>/lib/content.mjs";
console.log(JSON.stringify(buildIndex().projects.find(p=>p.slug==="<slug>"), null, 2));
'
```

If `slug` · `title` · `docs[]` come out as expected, you're done. No server restart needed (fs is scanned at request time).
View at `http://localhost:5001/p/<slug>`.

## Meta precedence · sorting

- Card title: `title` in `registry.json` > `title` in the target folder's `_meta.json` > slug
- Sorting: `order` ascending → missing means 99 → title `localeCompare`. Dragging cards on the home page saves to `registry.json` in steps of 10
- To hide a project from the home page, add its slug to the `hidden` array in `registry.json`
