# `@migaia/utils` 使用指南

This guide maps real exported APIs to boundary-focused workflows. See [README](./README.md) for package scope and entry points.

## 目录

- [Deadline + configuration workflow](#deadline-config-workflow)
- [API 与配置参考](#api-reference)
- [Error、abort 与资源边界](#error-abort-boundaries)
- [排查与构建门禁](#troubleshooting-build)

<a id="deadline-config-workflow"></a>

## Deadline + configuration workflow

```ts
import { createManualScheduler, retry, withTimeout } from '@migaia/utils/promise';
import { CONFIG_DELETE, ownConfig, patchConfig, readonlyConfig } from '@migaia/utils/config';

const scheduler = createManualScheduler();
const initial = ownConfig({ endpoint: '/v1', retries: 2, debug: true });
const next = patchConfig(initial, { debug: CONFIG_DELETE });
const publicConfig = readonlyConfig(next);

const request = withTimeout(
  ({ signal }) =>
    retry(
      async () => {
        if (signal.aborted) throw signal.reason;
        return publicConfig.endpoint;
      },
      { maxAttempts: publicConfig.retries, scheduler }
    ),
  { timeoutMs: 100, scheduler }
);

scheduler.advance(100);
await request.catch(() => undefined);
```

`createManualScheduler()` makes time deterministic. Timeout abort is cooperative; retry/operation code must read its supplied signal to stop early. `ownConfig` clones and brands accepted data; `readonlyConfig` is a cached mutation-rejecting facade; `patchConfig` returns a new owned root and `CONFIG_DELETE` only deletes root patch keys.

<a id="api-reference"></a>

## API 与配置参考

| Entry | Exports and contract |
| --- | --- |
| `/promise` | `systemScheduler`, `createManualScheduler`, `deferred`; `sleep(delay, controls)`; `withTimeout(operation, controls)`; `raceWithAbort(operation, controls)`; `retry(operation, options)`; `createConcurrencyLimiter(options)`; `hostRethrowReporter`. Types: `IAbortSignal`, `IUtilsScheduler`, `IAsyncControls`, retry/reporter/limiter types. `signal` and `signals` are mutually exclusive. |
| `/error` | `UtilsError`, `UtilsAbortError`, `UtilsTimeoutError`; `attachErrorIdentity`, `toError`, `walkErrorCauses`, `combineErrors`; `isUtilsError`, `isUtilsAbortError`, `isUtilsTimeoutError`, `UtilsErrorCode`. |
| `/bytes` | `bytesToBase64`, `base64ToBytes`, `streamBase64Chunks`, `utf8ByteLength`, `encodeUtf8`, `decodeUtf8`, `splitUtf8`. Base64 decoding accepts canonical RFC 4648 form only; decode `fatal` controls malformed UTF-8 behavior. |
| `/object` | `isPlainObject`, `probeProperty`, `immutableSnapshot`, `diagnosticSnapshot`, `identitySnapshot`; `parseObjectPath`, `probeObjectPath`, `get`, `set`, `createPathAccessor` and related path/probe/accessor types. String array segments use `users.[0].name`; tuples may include symbols. |
| `/config` | `ConfigProfile`, `CONFIG_DELETE`, `ownConfig`, `readonlyConfig`, `patchConfig`, `parseConfigPath`, `readConfigPath`, `combineConfig`, plus ownership, limits, merge and conflict types. `data` profile is portable default; `richRuntime` intentionally admits richer runtime values. |
| `/function` | `noop`, `once`, `onceAsync`. `once` caches first return or throw; `onceAsync` returns same first native Promise. |

<a id="error-abort-boundaries"></a>

## Error、abort 与资源边界

`sleep`, `raceWithAbort`, and `withTimeout` clean up registered listeners/timers. `raceWithAbort` has no deadline timer; `withTimeout` defaults to an internal controller and can use `cooperativeCancellation: false` for deadline-only work. Cleanup diagnostics default to host rethrow; use supplied reporter options where API exposes them when caller owns diagnostics.

`createConcurrencyLimiter` is sole long-lived primitive: `run` queues work, `whenIdle` waits for active/pending work, `close(reason?)` rejects future/pending admission, and `dispose(reason?)` completes terminal cleanup. It does not replace lifecycle ownership for external resources.

For object paths, `get` returns `undefined` for missing/blocked path but rethrows getter/Proxy failure. `set` is immutable with structural sharing and creates missing objects/arrays; it rejects traversal through a primitive. `createPathAccessor` exposes callback hooks for missing, blocked, failed, get, and set probes.

<a id="troubleshooting-build"></a>

## 排查与构建门禁

- Timeout did not stop I/O: expected without cooperative signal handling; pass signal to operation and make it honor abort.
- `base64ToBytes` rejected input: normalize producer to canonical padded RFC 4648 text; URL-safe/unpadded forms are not accepted.
- Config mutation throws: expose readonly config intentionally; patch the owned value instead.
- `once` reentrancy error: first invocation called wrapper again before completing; move recursion outside wrapper.
- Need current-value/replay or resource disposal: use owning reactive/lifecycle package, not a utils helper.

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```
