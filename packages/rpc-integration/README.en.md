# `@migaia/rpc-integration`

[中文](./README.md)

Private integration-test workspace for eight RPC owners: `rpc-contract`, `rpc-host`, `rpc-plugin-process`, `rpc-plugin-thread`, `rpc-plugin-browser`, `rpc-plugin-coroutines`, `rpc-plugin-pool`, and `rpc-plugin-devtools`. It is not published and exports no runtime API.

Application construction uses one `createRpcHost` with one transport plugin and optional features. This workspace verifies the combined public behavior, native processes and Workers, foreign protocol interoperability, dependency direction, and packed consumers. Lower-level protocol baselines may import the exact built canonical owner; they do not copy its implementation or restore a retired public factory.

## What it covers

| Directory                                                                         | Responsibility                                                                                                                                     |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/host`                                                                       | Public Host/plugin examples, ordinary Host installation, direct targeting, forwarding, pool scalar calls, collector correlation, and final exports |
| `test/runtime-api`, `test/process`, `test/threads`                                | Native sessions, generations, cancellation, replacement, ownership, and cross-runtime preservation                                                 |
| `test/bridge`                                                                     | JSON-RPC framing, object ports, and real process interoperability                                                                                  |
| `test/control`, `test/error-format`, `test/streaming`, `test/serialize`           | Language-neutral protocol and codec vectors, including `schema/vectors`                                                                            |
| `test/layering`, `test/merge`                                                     | Package ownership, error vocabulary, dependency direction, and public boundary convergence                                                         |
| `test/core`, `test/devtools`, `test/plugins`, `test/remote`, `test/replay-window` | Canonical kernel and feature combinations                                                                                                          |
| `test/typing`                                                                     | Public static contracts                                                                                                                            |
| `test/e2e/fixtures`                                                               | Browser fixtures also consumed by `rpc-plugin-browser` e2e                                                                                         |

Package-local acceptance stays with its owner. Coroutine lifecycle and ordinary-plugin baselines moved to `rpc-plugin-coroutines/test/coroutine`; they are not duplicated here. Browser carrier acceptance belongs to `rpc-plugin-browser`.

## Running

Tests consume fresh built dependencies and reject stale `dist`. The real package scripts are:

| Script                        | Purpose                                                         |
| ----------------------------- | --------------------------------------------------------------- |
| `test`                        | Default integration suite                                       |
| `test:conformance`            | Native/foreign interoperability suite                           |
| `test:suite-parity`           | Existing cross-suite parity cases                               |
| `test:packed`                 | Bounded build of the eight RPC owners, then packed export smoke |
| `test:coverage:family`        | Shared family coverage, including moved/new owners              |
| `typecheck`, `typecheck:test` | The owning test TypeScript project                              |

Build only the selected dependency graph with bounded concurrency, and run heavy commands inside the shared window. From the repository root:

```bash
node "$(git rev-parse --path-format=absolute --git-common-dir)/../scripts/exclusive-window.mjs" run --window rpc-build --wait 2700 -- pnpm -r --filter "@migaia/rpc-integration..." --workspace-concurrency=2 run build
node "$(git rev-parse --path-format=absolute --git-common-dir)/../scripts/exclusive-window.mjs" run --window rpc-integration --wait 2700 -- pnpm --dir packages/rpc-integration run test
```

There is no integration runtime build entry of its own; the recursive filter builds matching dependencies that have a build script. Do not run an unbounded repository build. Bench scripts remain separate from delivery gates. See the [USEGUIDE](./USEGUIDE.en.md) for fixture setup and exact script usage.

## Related owners

| Package                                                          | Responsibility                                                    |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`rpc-contract`](../rpc-contract/README.en.md)                   | Pure contracts, schemas, framing, and errors                      |
| [`rpc-host`](../rpc-host/README.en.md)                           | The single `createRpcHost` entry, author SDK, and common features |
| [`rpc-plugin-process`](../rpc-plugin-process/README.en.md)       | Child-process and socket transport                                |
| [`rpc-plugin-thread`](../rpc-plugin-thread/README.en.md)         | Native Node/Bun/Deno thread transport                             |
| [`rpc-plugin-browser`](../rpc-plugin-browser/README.en.md)       | Browser carrier plugins                                           |
| [`rpc-plugin-coroutines`](../rpc-plugin-coroutines/README.en.md) | Supervised tasks and opaque parent connection                     |
| [`rpc-plugin-pool`](../rpc-plugin-pool/README.en.md)             | One logical pool target and original member scheduling            |
| [`rpc-plugin-devtools`](../rpc-plugin-devtools/README.en.md)     | Feature installation and collector records                        |
