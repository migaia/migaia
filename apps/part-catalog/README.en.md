# apps/part-catalog

The catalog service of the part platform. It runs locally and is not deployed. It stores a project's version snapshots, remote modules with their sources and environment pointers; serves snapshots with ETags; handles promotion and rollback; keeps the editor's draft and applies atomic changesets; and answers catalog queries and audit reads.

## Run

```bash
bun src/main.ts token create --data ./catalog-data --project orders --envs dev,staging,prod --scope write --actor alice
bun src/main.ts env set --data ./catalog-data --project orders --env prod --public-read true
bun src/main.ts serve --data ./catalog-data --project-dir ../my-app --allow-origin http://127.0.0.1:5173
```

- Listens on `127.0.0.1` only and prints `{ "url": … }`; data lives in `<data>/catalog.sqlite`.
- A token is printed once and only its SHA-256 is stored; it is bound to one project, a set of environments and a `read`/`write` scope. Drafts, changesets, uploads and audit belong to the `dev` environment; each token may make 60 write requests per minute.
- Environments set to public read serve their snapshot without a token; uploaded published modules at `/p/<project>/m/<file>` are public.
- Origins listed with `--allow-origin` get CORS headers; others get none.
- `--project-dir` points at the application repository: TS modules in changesets are built there with `partom remote build`. That runs the submitter's code on this machine, so treat write tokens like repository write access.

## Interface

| Method and path | Access | Purpose |
|---|---|---|
| `PUT /p/:project/m/:file` | write | Upload module bytes; the file name must be their content hash |
| `PUT /p/:project/snapshots/:hash` | write | Upload raw `snapshot.json` bytes; checks hash, modules, built-in rules and definitions |
| `PUT /p/:project/snapshots/:hash/sources` | write | Upload the sources of the snapshot's modules |
| `GET /p/:project/env/:env/snapshot` | read / public | Raw snapshot bytes; `ETag` is the snapshot hash |
| `POST /p/:project/env/:env/publish\|promote\|rollback` | write | Move an environment pointer and record history |
| `GET /p/:project/env/:env/history` | read | Pointer history, newest first |
| `GET /p/:project/drafts` | read | The draft, with catalog-computed hashes and conflicts |
| `POST /p/:project/drafts/changesets` | write | Atomic changeset; returns per-artifact results |
| `GET /p/:project/drafts/m/:file` | read | Draft module bytes |
| `GET /p/:project/catalog` | read | Descriptor query with `ETag` |
| `GET /p/:project/audit` | write | Audit records |

Error bodies are `{ error: { source: 'part.catalog', code, message } }`, plus `issues` for validation failures. When the dev pointer moves the draft is rebased automatically; conflicts are listed in the draft's `conflicts`.

## Verify

```bash
bun run fmt && bun run lint && bun run typecheck && bun run typecheck:test && bun run test
```
