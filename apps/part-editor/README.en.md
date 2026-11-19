# apps/part-editor

The browser editor of the part platform. It runs locally and is not deployed. It reads a project's draft from the catalog service, edits blueprints and the TS source of remote modules, shows the result at once in an embedded preview, and saves every change back to the draft as one atomic changeset. Saving is not publishing: `partom pull`, `build` and `publish` still do that.

## Run

The editor needs a running catalog service (see `apps/part-catalog`) and a preview running in bridge mode inside the application repository:

```bash
partom preview --editor --editor-origin http://127.0.0.1:5174 --port 5175
```

```bash
bun src/main.ts serve --service http://127.0.0.1:5173 --preview http://127.0.0.1:5175/ --port 5174
```

- It listens on `127.0.0.1` only and prints `{ "url": … }` once started. The catalog's `--allow-origin` must include the editor's and the preview's origins.
- Open the page and sign in with a catalog token and the project name. The token is sent only to the catalog and to the preview page's origin.

## Editing

- **Blueprints:** the node tree on the left lets you select, move up and delete nodes. The property panel is generated from the part descriptor: fields with a props schema follow the schema, variants are drop-downs, and there is an `aria` group.
- **Issues:** issues from local rules and those the preview sends back (including the project's own rule plugins) appear next to both the node and the field. Issues with a suggested fix carry a "Fix" button.
- **Preview:** after every change the blueprint goes to the preview page at once, without reloading it. Remote modules are hot-replaced by module name. Press `Alt+Shift+D` in the preview to open devtools, pick a node and see its enhancement steps.
- **Remote modules:** in the module list, modules that have only build output and no source are read-only. New modules can start from a template. Issues after a save are listed as "file:line:column"; clicking one selects that line. After a successful save, the effects a new module exports appear in the handler drop-down.

## Saving and conflicts

Saving submits the changed blueprints and modules as one changeset and returns a result for each artifact (`accepted`, `rejected`, `conflict`, or `skipped` when another artifact failed). If any artifact is not accepted, nothing in the changeset is written.

- If someone changed another part of the same blueprint after you read the draft, the first save returns `conflict`; the editor merges automatically and asks you to save again.
- If someone changed the same field you changed, the editor lists the node address and configuration group of each conflict. Choose to keep your value or the server's, then save.

## Verification

```bash
bun run fmt && bun run lint && bun run typecheck && bun run typecheck:test && bun run test
```

The tests start the catalog, the preview and the editor as child processes and drive the pages with Playwright Chromium. `test/integration.test.ts` is the whole-program acceptance of platform stage 4: it compiles the `partom` executable, then runs through release, editing, pull, delivery, rejection, rollback, offline start and devtools. Run the heavy tests inside the repository exclusive window.
