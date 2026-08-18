# `@migaia/lifecycle` 使用指南

`@migaia/lifecycle` 是资源所有权与终止语义的底座。先看 [README](./README.md) 了解边界；这里说明如何选择 API、配置释放和验证行为。

## 目录

- [作用域工作流](#scope-workflow)
- [API 与配置参考](#api-reference)
- [生命周期、释放与错误](#lifecycle-errors)
- [常见问题与构建门禁](#troubleshooting-build)

<a id="scope-workflow"></a>

## 作用域工作流

```ts
import { createLifecycleScope, type IReleaseDescriptor } from '@migaia/lifecycle';

const scope = createLifecycleScope({
  errorPolicy: 'collect',
  report: (error) => console.error('release diagnostic', error)
});

const socket = { close: () => undefined };
const descriptor: IReleaseDescriptor = {
  graceful: async ({ signal }) => {
    if (!signal.aborted) await Promise.resolve();
  },
  gracefulTimeoutMs: 200,
  force: () => socket.close()
};

scope.own(socket, descriptor);
scope.close();
const failures = await scope.dispose();
```

`close()` is synchronous and runs no callback. It moves `open` to `closing`, so later `own()` fails. `dispose()` is always async, releases owned resources in reverse registration order, then reaches `terminal`. Calling it externally more than once joins its one completion Promise; a disposer cannot reenter its own scope.

<a id="api-reference"></a>

## API 与配置参考

| API | Use when | Key contract |
| --- | --- | --- |
| `createLifecycleScope(options?)` | General async ownership | `own`, `release`, `close`, async `dispose`; options: `errorPolicy`, `report`, `deadlineAt`, `scheduler`. |
| `createSyncLifecycleScope(options?)` | Every disposer must be synchronous | Requires `syncSafe: true`; rejects thenables and async scopes. |
| `createLifecycleUnit(options?)` | One load/restartable value | `start`/`restart` adopt only current generation; inspect `state`, `value`, `error`, `lifecycle`. |
| `createGenerationController(options?)` | Supersede async work | `begin`, `adopt`, `invalidate`, `dispose`; request signal aborts on replacement, timeout, parent abort, or disposal. |
| `createQuiescenceTracker` / string variant | Named leases | `retain`, `count`, `seal`, `whenZero`, `whenZeroOnce`; `whenZero` requires sealing. |
| Lease registry helpers | Same lease protocol, domain-friendly name | Object keys use `WeakMap`; string keys prune pristine entries. |
| `createPendingTracker()` | Track then drain in-flight Promises | `track(promise)` returns exact promise; `drain()` observes work added while draining. |
| `createProvisionalScope(options?)` | Setup needs commit-or-rollback ownership | `commitTo(parent)` transfers prefix then compensates remaining ownership; `rollback()` is idempotent. |
| `createMutationQueue(options?)` | Strict FIFO mutation admission | `enqueue`; options control admission timeout/diagnostic and scheduler. No concurrency pool. |
| `createDisposeTransaction(mode, options?)` | Execute caller-supplied release plan | `order` sorts higher `descriptor.order` first; `plan` never reads order and follows input sequence. |
| `boundedWait(task, deadlineAt, options?)` | Stop waiting at absolute deadline | Returns `false` at deadline; does not cancel task and still observes rejection. |
| Abort / scheduler helpers | Host-neutral timing and abort | `createAbortController`, `systemScheduler`, `createManualScheduler`, `snapshotScheduler`; use one scheduler time domain for deadlines. |

`IReleaseDescriptor` is resource contract: `force` required; optional `graceful`, `gracefulTimeoutMs`, `custom`, `order`, `gcFallback`, `syncSafe`. `custom` replaces graceful/force. A graceful error still runs `force`; timeout abandons waiting and also runs `force` without cancelling graceful work.

<a id="lifecycle-errors"></a>

## 生命周期、释放与错误

Use `LifecycleErrorPolicy.throw` (default) for normal fail-fast delivery: one raw error is thrown, multiple errors become `AggregateError`. `collect` returns `ICollectedError[]`; `report` reports and resolves; `firstError` preserves first failure for compatibility-only callers. Reporter failures are contained.

Package-owned boundary errors have `source: '@migaia/lifecycle'` and a `LifecycleErrorCode`; raw release errors remain reachable as the primary error, `cause`, or `AggregateError.errors`. `close`/`dispose` never infer business dependency order. Build the dependency order outside this package, then use `DisposeTransaction` `plan` mode or register in intended LIFO order.

Do not use lifecycle as an event bus, current-value store, capability graph, or transport. It owns resource/lifecycle mechanics only.

<a id="troubleshooting-build"></a>

## 常见问题与构建门禁

- Need deterministic tests? Inject `createManualScheduler()`; do not mix its clock with `Date.now()` deadlines.
- Need timeout cancellation? A graceful timeout only abandons waiting. Descriptor code must cooperate with `context.signal` if it can stop work.
- Need a one-off cleanup? Use a direct `try/finally`; create a scope only when ownership outlives one call or composes with other resources.
- `whenZero()` throws? Call `seal(key)` first, or use non-exclusive `whenZeroOnce()`.

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```
