# `@migaia/rpc-integration`

[中文](./README.md)

The integration test workspace for the RPC packages. It is private (`private: true`): it is not published to npm and exports no runtime API.

The package tests of `@migaia/rpc-contract`, `@migaia/rpc-core`, `@migaia/rpc-process`, `@migaia/rpc-threads` and `@migaia/rpc-browser` each check only their own package. This workspace checks how they behave together: real child processes, real Workers, interoperability across runtimes, wire-format vectors, the direction of dependencies between layers, and the packed public entries.

## Why a separate package

- **It tests the real public entries.** Tests here import the `@migaia/rpc-*` package names and run each package's built `dist`, not its source. A change that passes a package's own unit tests but breaks an export path or a build output fails here.
- **Cross-package dependencies live in one place.** Cross-package scenarios need several RPC packages at once. Putting them in any one RPC package would give that package a reverse dependency.
- **Heavy scenarios are managed together.** Real child processes, large frames and foreign-language peers take time and resources. Keeping them here lets them run serially when needed without slowing down each package's own tests.

## What it covers

| Directory | What it checks |
| --- | --- |
| `test/runtime-api` | Connecting, calling and closing through the public API on each runtime (Node, Bun, Deno, browsers) |
| `test/process` | Real child processes: health checks, reverse registration, whole-process replacement, failure recovery |
| `test/threads` | Real Worker threads: authentication, which side owns `serve` teardown, lazy replay on child ports |
| `test/bridge` | The JSON-RPC bridge: physical frame boundaries, object port contracts, real process health |
| `test/control`, `test/error-format`, `test/streaming`, `test/serialize` | The wire protocol: control messages, error format, streaming and codec interoperability, checked against the vectors in `schema/vectors` |
| `test/layering`, `test/merge` | Architecture rules: who owns error text, naming boundaries, dependency direction between layers, tree-shaking cost of the root entries |
| `test/core`, `test/devtools`, `test/plugins`, `test/remote`, `test/replay-window` | Core capabilities combined with the surrounding packages |
| `test/typing` | Public types (`*.test-d.ts`) |
| `test/e2e/fixtures` | Browser-side fixtures loaded by the e2e tests of `@migaia/rpc-browser` |

`schema/vectors` holds language-neutral wire-format vectors (JSON); implementations in other languages can use them for their own tests.

## Running

Build the RPC packages under test first. At startup the tests check that each dependency's `dist` matches its source; if not, they fail immediately and list the packages to rebuild.

```bash
pnpm --filter "@migaia/rpc-integration..." --workspace-concurrency=2 run build
pnpm --filter @migaia/rpc-integration run test
```

Do not run a full build from the repository root. See the [USEGUIDE](./USEGUIDE.en.md) for every script and how to run each kind of test.

## Related packages

| Package | Relationship |
| --- | --- |
| [`@migaia/rpc-contract`](../rpc-contract/README.en.md) | Contracts and schemas |
| [`@migaia/rpc-core`](../rpc-core/README.en.md) | Runtime core and transport toolkit |
| [`@migaia/rpc-process`](../rpc-process/README.en.md) | Child-process transport |
| [`@migaia/rpc-threads`](../rpc-threads/README.en.md) | Worker-thread transport |
| [`@migaia/rpc-browser`](../rpc-browser/README.en.md) | Browser transports; its e2e tests use the fixtures here |
| [`@migaia/rpc-devtools`](../rpc-devtools/README.en.md) | Debugging and observation |
