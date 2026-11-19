# `@migaia/part-plugin-remote` usage guide

## Start order

1. Read the last good snapshot from the cache. If there is one, install it; its module bytes also come from the cache, without network access.
2. When the cache is empty or its snapshot fails to install, install `fallback` (snapshot bytes inlined at build time).
3. Without either, wait for the first fetch. If it fails, `ready()` rejects with `REMOTE_FETCH_FAILED`.
4. After `ready()`, request `GET <service>/p/<project>/env/<env>/snapshot` in the background with `If-None-Match` and the read token (when set).

After that the snapshot is checked every `revalidateMs` (default 300000), when the page becomes visible and on `revalidate()`. One request runs at a time; later calls wait for the same result. `304` does nothing; `200` hashes the response bytes and installs them. Do not put a read token into a public bundle: production clients should use an environment the catalog serves with public read.

## Installing a version

1. Parse the snapshot.
2. Delivery check: each id in `lock.definitions` must be in `manifest` or exported by a remote module of the snapshot. Otherwise the version is rejected with `REMOTE_VERSION_REJECTED`, carrying `tag` and `missing`.
3. Call the loaders in `chunks` for referenced parts and wait.
4. Get module bytes (cache, then network) and check `integrity` (SHA-384) and `id` (SHA-256). A mismatch rejects with `REMOTE_MODULE_INTEGRITY`.
5. Hand every isolated module to the Worker as one set, then install or replace all remote definitions as one plugin, `remote:modules`.
6. Call `host.blueprint.update` for each blueprint. The host runs every installed rule here; an error fails the step.

If step 5 or 6 fails, updated blueprints get their old documents back, `remote:modules` goes back to the old version (or is removed on a first install) and the Worker reloads the old isolated modules. The rejection is reported once through the host's diagnostics and the current version stays. On success the snapshot and module bytes are cached, module keys only the old version used are deleted, and `host.diagnostics.setContext({ version, snapshot })` is updated.

When a snapshot no longer carries a blueprint that was loaded, the plugin does not unload it; unmounting is the application's job.

## Trust tiers

| Tier | Runs in | ctx |
|---|---|---|
| `page` | page | full ctx |
| `restricted` (default) | page | grant-checked ctx; `features` and `models` are empty objects |
| `isolated` | Worker | only `resources.run`, `state.read`, `state.write`, `dispatch`; in the Worker `state.read` returns a promise |

Isolated modules may export only effects. By default the Worker is created with `new URL('./browser/isolated-worker.js', import.meta.url)`, so the application bundler must emit that file. You can also create it yourself with the `isolatedWorker` option. Isolated modules cannot import `react`.

## Editor preview

`loadRemoteModules(host, refs, { base, token, shared, trust })` fetches, checks and imports `refs`, and replaces entries of the same name in `remote:modules`; other entries stay. `remoteModulesPlugin(entries)` builds that plugin; `current()` of its Feature `remoteModules` returns the current module set. `loadRemoteModules` gives isolated modules placeholders only and does not start a Worker.

## Production errors

`forwardPartErrors(log)` returns a function for `createPartHost({ onError })`. Each report becomes one log-host `error` entry: `{ address, version, snapshot, source, code, message }`, without configuration values. `log` needs `levelPlugin()`.

## Error codes

Domain `part.remote`: `REMOTE_VERSION_REJECTED`, `REMOTE_MODULE_INTEGRITY`, `REMOTE_FETCH_FAILED`, `REMOTE_ISOLATED_EFFECT_MISSING` (the Worker was asked to run an effect the current table no longer has; the host ends that run with `EFFECT_FAILED`).

## Build and verify

```bash
pnpm --filter @migaia/part-plugin-remote run fmt
pnpm --filter @migaia/part-plugin-remote run lint
pnpm --filter @migaia/part-plugin-remote run typecheck
pnpm --filter @migaia/part-plugin-remote run test
```

Tests run in Chromium. The global setup runs in Node: it builds the fixture modules with `partom remote build` and starts a fake catalog.
