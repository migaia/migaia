<p align="center">
  <img src="./website/app/favicon.svg" width="48" height="48" alt="migaia" />
</p>

<h1 align="center">migaia</h1>

<p align="center">
  <strong>TypeScript libraries that keep async code correct through shutdown, cancellation and crashes.</strong>
</p>

<p align="center">
  <img alt="Status: pre-release" src="https://img.shields.io/badge/status-pre--release-orange" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-ESM-3178c6" />
  <img alt="Runtimes" src="https://img.shields.io/badge/runtimes-browser%20%7C%20Node%20%7C%20Bun%20%7C%20Deno%20%7C%20Worker-555" />
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green" />
</p>

<p align="center">
  <a href="https://hk.vps.kaeo.app/migaia/en/">Docs site</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#packages">Packages</a> ·
  <a href="#documentation">Documentation</a> ·
  <a href="#contributing">Contributing</a> ·
  <a href="./README.md">中文</a>
</p>

---

In asynchronous programs the business logic is rarely the hard part. The edges are: what happens to requests still running when the service stops, whether a slow old response can overwrite a newer one, whether work inside a Worker can be cancelled, and whether a crashed background task should restart, and how many times.

migaia turns those rules into a set of small, independent packages. Each package does one job and is installed on its own. They share the same conventions for cancellation, cleanup and error tracing, so they behave consistently when combined.

> [!WARNING]
> migaia is pre-release. Versions are `0.0.x` and no stable version has shipped yet. Until then any public API may change without a compatibility layer, and breaking changes are not recorded separately.

## Features

- **Cleanup you can rely on.** Resources are released in the reverse order they were registered. If one cleanup fails, the rest still run, and the original error is never replaced by a cleanup error. Closing twice runs cleanup once.
- **Cancellable everywhere.** Timeouts, retries, remote calls and data loading all accept a standard `AbortSignal`. Once cancelled, no late result is written back into state.
- **Traceable errors.** Every error a package throws carries a `source` (which package) and a `code` (which situation). The original error stays on the `cause` chain instead of being lost behind wrappers. When errors cross threads or processes over RPC, their type, `code` and `cause` chain travel with them.
- **Write once, run anywhere.** Most packages use no DOM-only or Node-only APIs, so they behave the same in browsers, Node, Bun, Deno and Workers. Packages that target one platform say so in their README.
- **Pay only for what you use.** Packages depend on each other in layers, so a low-level package never pulls in state management or RPC. Every package is marked side-effect free, so bundlers can drop exports you do not use.
- **Fully typed.** The source is TypeScript and type declarations ship with each package; there is no separate `@types` package.

## Quick start

### 1. Point npm at the registry

All packages are published to GitHub Packages under the `@migaia` scope. Add this to your project's `.npmrc`:

```ini
@migaia:registry=https://npm.pkg.github.com
```

GitHub Packages requires you to sign in before installing, with a token that has at least the `read:packages` scope. Keep the token in an environment variable or in your user-level `~/.npmrc`, never in the repository.

### 2. Install what you need

```bash
pnpm add @migaia/lifecycle
```

Any other `@migaia` packages it depends on are installed automatically.

### 3. Write your first lines

The code below registers two resources and then releases them together. The last one registered is released first: the HTTP server closes before the database, so requests still being handled do not fail because the database went away first.

```ts
import { createLifecycleScope } from '@migaia/lifecycle/scope'

const app = createLifecycleScope()

app.own('database', { force: () => console.log('close database') })
app.own('http-server', { force: async () => console.log('close http-server') })

// In a real service: process.once('SIGTERM', () => void app.dispose())
await app.dispose()
```

Output:

```text
close http-server
close database
```

For a complete graceful shutdown (stop accepting requests, wait for in-flight requests with a deadline, then close the connection pool), see the [`@migaia/lifecycle` README](./packages/lifecycle/README.en.md).

## Packages

Not sure where to start? Begin with the problem you have:

| The problem                                                                                   | Start here                                                       |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| A deploy cuts off running requests and half-written data is lost                              | [`lifecycle`](./packages/lifecycle/README.en.md)                 |
| A search box shows stale results because a slow earlier request arrived last                  | [`resource`](./packages/resource/README.en.md)                   |
| A crashing background task restarts in a tight loop and one bad config takes the machine down | [`supervision`](./packages/supervision/README.en.md)             |
| Moving work into a Worker broke cancellation and timeouts                                     | [`rpc-plugin-thread`](./packages/rpc-plugin-thread/README.en.md) |
| A plugin fails halfway through install and nothing rolls back the ones before it              | [`plugin-host`](./packages/plugin-host/README.en.md)             |
| Several micro-frontends on one page write the same state                                      | [`micro-hub`](./packages/micro-hub/README.en.md)                 |

<details open>
<summary><strong>Shutdown, cancellation and error tracing</strong></summary>

| Package                                                              | What it does                                                                                                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`utils`](./packages/utils/README.en.md)                             | Add deadlines, cancellation, and error tracing to code and handle common data conversions and object updates.                                                                   |
| [`lifecycle`](./packages/lifecycle/README.en.md)                     | Keep shutdown, cancellation and replacement correct under concurrency: release resources in order, accept only the latest result, and wait for work in flight with a deadline.  |
| [`supervision`](./packages/supervision/README.en.md)                 | Watch background tasks, child processes and threads: restart crashes with a growing delay, give up when failures pile up, stop on time, and free a slot only after a real exit. |
| [`event-subscriber`](./packages/event-subscriber/README.en.md)       | Subscribe to and broadcast events between local modules and coordinate synchronous or asynchronous listeners.                                                                   |
| [`middleware-pipeline`](./packages/middleware-pipeline/README.en.md) | Combine processing steps into synchronous, asynchronous, or generator middleware pipelines and stop or cancel processing when needed.                                           |
| [`logger`](./packages/logger/README.en.md)                           | Send logs to a console or service, filter and format them as needed, and wait for asynchronous output to finish.                                                                |

</details>

<details open>
<summary><strong>Plugins and feature switches</strong></summary>

| Package                                              | What it does                                                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [`capability`](./packages/capability/README.en.md)   | Enable or disable optional features, keep tenant feature settings separate, and start and release features in dependency order.               |
| [`plugin-host`](./packages/plugin-host/README.en.md) | Install and remove plugins for libraries or applications, configure shared features and processing steps, and roll back failed installations. |
| [`tray`](./packages/tray/README.en.md)               | Start, find, call, and restart plugin hosts, including Node Workers and child processes, and release them on shutdown.                        |

</details>

<details open>
<summary><strong>Reactive state</strong></summary>

| Package                                                        | What it does                                                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [`reactive`](./packages/reactive/README.en.md)                 | Update derived values and effects when state changes and keep state separate across contexts.                                         |
| [`resource`](./packages/resource/README.en.md)                 | Load asynchronous data as inputs change, cancel stale requests, retry failures, and refresh cached results.                           |
| [`store-light`](./packages/store-light/README.en.md)           | Manage object state, asynchronous data, and updates so related computations respond to field changes.                                 |
| [`store-keyed`](./packages/store-keyed/README.en.md)           | Manage state by business key in separate scopes and subscribe only to the parts you need.                                             |
| [`store-indexed`](./packages/store-indexed/README.en.md)       | Subscribe to keys or indices in objects, arrays, Maps, and Sets so related computations respond to collection updates.                |
| [`store-react`](./packages/store-react/README.en.md)           | Use Stores, Atoms, and asynchronous resources in React components and manage subscriptions and cleanup.                               |
| [`store-middleware`](./packages/store-middleware/README.en.md) | Trace Store state and actions, enforce write rules, and connect to Redux DevTools.                                                    |
| [`store-devtools`](./packages/store-devtools/README.en.md)     | Inspect Store state and action history and use time travel and dependency trees to investigate changes.                               |
| [`store-persist`](./packages/store-persist/README.en.md)       | Automatically save and restore object, keyed, and collection state and migrate saved data when versions change.                       |
| [`store-ssr`](./packages/store-ssr/README.en.md)               | Keep Stores and Resources separate for each SSR request and restore the server's initial state in the browser.                        |
| [`store-worker`](./packages/store-worker/README.en.md)         | Move expensive computation and data encoding and decoding into Workers and use cancellation, deduplication, and caching for requests. |
| [`store-shared`](./packages/store-shared/README.en.md)         | Read and write the same reactive 32-bit integer state from the main thread and Workers.                                               |
| [`store-wasm`](./packages/store-wasm/README.en.md)             | Manage observable numbers, strings, arrays, and records in WASM.                                                                      |

</details>

<details open>
<summary><strong>Storage and encoding</strong></summary>

| Package                                                        | What it does                                                                                          |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [`storage-contract`](./packages/storage-contract/README.en.md) | Define common interfaces for key-value and record storage so applications can use different backends. |
| [`storage-web`](./packages/storage-web/README.en.md)           | Read and write data in Web Storage, cookies, IndexedDB, and memory through a common interface.        |
| [`serialize`](./packages/serialize/README.en.md)               | Encode application data for storage or transmission and decode it when reading.                       |
| [`wasm`](./packages/wasm/README.en.md)                         | Allocate reusable byte buffers and transcode between JSON and MessagePack.                            |

</details>

<details open>
<summary><strong>Calls across threads, processes and pages (RPC)</strong></summary>

RPC (remote procedure call) lets you call a function in another thread, process or page as if it were local, while keeping timeouts, cancellation and error details.

Create one host with `createRpcHost`, select one transport plugin, and add optional features. That host owns connections, calls, streams, and cleanup.

| Package                                                                  | What it does                                                                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| [`rpc-contract`](./packages/rpc-contract/README.en.md)                   | Validate, encode, and decode messages for custom RPC implementations so peers can communicate through the same protocol. |
| [`rpc-host`](./packages/rpc-host/README.en.md)                           | Call remote functions across runtimes with timeouts, cancellation, and streaming results.                                |
| [`rpc-plugin-thread`](./packages/rpc-plugin-thread/README.en.md)         | Move heavy computation into Workers and call, manage, and restart threads through RPC.                                   |
| [`rpc-plugin-process`](./packages/rpc-plugin-process/README.en.md)       | Run isolated work in child processes or local services and call and manage them through RPC.                             |
| [`rpc-plugin-pool`](./packages/rpc-plugin-pool/README.en.md)             | Distribute RPC calls across thread or process pools and queue requests within bounded limits when busy.                  |
| [`rpc-plugin-browser`](./packages/rpc-plugin-browser/README.en.md)       | Call functions across browser windows, iframes, SharedWorkers, and reliable ordered WebRTC channels.                     |
| [`rpc-plugin-coroutines`](./packages/rpc-plugin-coroutines/README.en.md) | Supervise coroutine tasks in the same runtime and call them through the same host.                                       |
| [`rpc-plugin-devtools`](./packages/rpc-plugin-devtools/README.en.md)     | Collect, query, and record RPC metadata and inspect timelines and call statistics across hosts.                          |

</details>

<details open>
<summary><strong>Micro-frontends</strong></summary>

| Package                                          | What it does                                                                                                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`micro-hub`](./packages/micro-hub/README.en.md) | Share state, events, and requests between micro-frontend apps on one page. Each piece of state has one owner, and unmounting an app releases its subscriptions and request handlers together. |

</details>

## Architecture

The packages form layers. A higher layer may depend on a lower one, never the other way round, so using a low-level package never pulls in code from the layers above it.

```text
Integration            micro-hub   tray
State and storage      store-*     storage-web
RPC                    rpc-host + rpc-plugin-{process,thread,browser,coroutines,pool,devtools}
Plugins and switches   plugin-host   capability
Shared foundations     reactive   resource   serialize   storage-contract   supervision
                       lifecycle   event-subscriber   middleware-pipeline
Bottom                 utils   wasm
```

`utils` and `wasm` depend on no other `@migaia` package. A package's `package.json` is the authority on what it depends on.

## Requirements

| Environment   | Requirement                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Node.js       | 18 or later; `rpc-plugin-pool` needs 24 or later                                                                             |
| Bun, Deno     | Current stable release                                                                                                       |
| Browsers      | Current versions of major browsers. Package READMEs list extra needs, such as cross-origin isolation for `SharedArrayBuffer` |
| Module format | ESM only; load with `import`                                                                                                 |

## Documentation

| Document  | Location                                                     | What it covers                                                                                                              |
| --------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| README    | `packages/<name>/README.en.md`                               | The problem the package solves, a runnable starting example, and why you would pick it                                      |
| USEGUIDE  | `packages/<name>/USEGUIDE.en.md`                             | Complete usage organized by scenario, each with code and output                                                             |
| Docs site | [hk.vps.kaeo.app/migaia](https://hk.vps.kaeo.app/migaia/en/) | Guides and API reference for every package, searchable. Source lives in `website/`; preview locally with `pnpm website:dev` |

Every document also has a Chinese version without the `.en` suffix.

## Contributing

Tool versions are pinned in [`mise.toml`](./mise.toml): Node 24, pnpm, and Bun (used by the docs site).

```bash
mise install
```

```bash
pnpm install
```

During day-to-day work, check only the package you changed. The root `package.json` has an `@<name>` shortcut for every package; run format, lint and test in that order:

```bash
pnpm @lifecycle fmt
```

```bash
pnpm @lifecycle lint
```

```bash
pnpm @lifecycle test
```

Read [AGENTS.md](./AGENTS.md) before you start; it holds the code conventions. The ones people trip over most:

- **Do not run a full build from the root.** Building thirty-plus packages at once exhausts memory. When you need several packages built, cap parallelism with `--workspace-concurrency`.
- **Long-running commands go through the exclusive-window script** `scripts/exclusive-window.mjs`: full test runs, builds and benchmarks. It keeps several jobs from fighting over the machine.
- **Tests live in each package's `test/` directory**, apart from source. Integration tests across the RPC packages live in the private package `packages/rpc-integration`.
- **Register an error code before you throw a new error.** Each package declares its codes in one place, `src/error-code.ts`.
- **Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)**, for example `fix(lifecycle): ...`.

## License

All packages are released under the MIT license; each package's `package.json` `license` field is authoritative.
