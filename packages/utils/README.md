# `@migaia/utils`

Runtime-neutral utility primitives for library code: deadlines, cooperative abort, error identity, bytes/text, immutable object paths, owned configuration, and once-only functions. It has no runtime dependencies and declares `sideEffects: false`.

## Suitable and unsuitable use

Use it when a package needs a small host-neutral primitive with explicit failure, scheduler, or ownership semantics. Typical cases: waiting under a deadline, canonical Base64 at a protocol boundary, read-only config snapshots, and immutable nested writes.

Do not use it as an application framework, event bus, lifecycle owner, storage layer, or forced Promise cancellation mechanism. `withTimeout` and `raceWithAbort` notify cooperative work through a signal; they cannot stop a Promise that ignores it.

## Install and quick start

```bash
pnpm add @migaia/utils
```

```ts
import { withTimeout } from '@migaia/utils/promise';
import { ownConfig, patchConfig } from '@migaia/utils/config';

const config = ownConfig({ retries: 2, enabled: true });
const nextConfig = patchConfig(config, { retries: 3 });

const result = await withTimeout(
  async ({ signal }) => {
    if (signal.aborted) throw signal.reason;
    return nextConfig.retries;
  },
  { timeoutMs: 500 }
);
```

## Public API and subpath map

Root `@migaia/utils` re-exports every module. Prefer explicit subpaths when a bundle boundary matters:

| Entry | Main exports |
| --- | --- |
| `/promise` | Scheduler, `deferred`, `sleep`, `withTimeout`, `raceWithAbort`, `retry`, `createConcurrencyLimiter`, abort/reporter types. |
| `/error` | `UtilsError`, abort/deadline errors, identity/cause helpers, guards, `UtilsErrorCode`. |
| `/bytes` | Canonical Base64 plus UTF-8 encode/decode/splitting. |
| `/object` | Plain-object/probe/snapshot helpers and typed immutable object paths. |
| `/config` | Owned/readonly config, root patch, path read, controlled merge, profiles and delete marker. |
| `/function` | `noop`, `once`, `onceAsync`. |

`object-path` is re-exported only through root and `/object`; it is not a package export subpath. Exact API/config reference and workflows: [USEGUIDE.md](./USEGUIDE.md).

## Error, lifecycle, and runtime boundaries

`UtilsAbortError` and `UtilsTimeoutError` carry `source: '@migaia/utils'` and stable codes. `attachErrorIdentity` adds identity without replacing native errors; `toError`, `walkErrorCauses`, and `combineErrors` preserve original values through `cause`/`AggregateError` chains.

Utilities do not retain application resources across calls except an explicitly created concurrency limiter, which exposes `close()` and awaitable `dispose()`. Scheduler-based APIs accept injected schedulers for deterministic tests. No Node `Buffer`, DOM, or framework API is required for byte/text or object/config helpers.

## Build gate

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```
