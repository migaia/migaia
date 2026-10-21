# @migaia/lifecycle

[中文](./README.md)

The hardest part of asynchronous code to get right is the ending: what closes first and what closes last, what happens when cleanup fails halfway, what to do when an old request answers late, and whether to wait for unfinished work and for how long. `@migaia/lifecycle` turns those ending rules into small tools you can combine, so shutdown, cancellation and replacement stay correct under concurrency. It depends on neither the DOM nor Node, and works in browsers, Node, Bun, Deno and Workers.

## Sound familiar?

- **Deploys cut off in-flight requests.** The container exits as soon as it receives SIGTERM; a request that was writing to the database gets a 502 and half its data is lost. The shutdown had no "stop accepting, wait for work in flight, then close connections" sequence.
- **The search box shows stale results.** The user types "a" and then "ab"; the slow response for "a" arrives after "ab" and overwrites it. Nothing checked whether a result still belonged to the latest request.
- **After navigating away, messages repeat and memory grows.** One subscription or timer was not cleaned up when the page closed, so coming back handles every message twice. Cleanup functions were scattered and depended on someone remembering them.
- **Initialisation fails halfway and leaves a half-built object.** The database is connected and the cache is open when step three fails, and nobody closes the first two.
- **Cleanup code throws.** Closing the database in `finally` fails, the cache after it never closes, and the original error is lost.

## Start here

Below is a graceful shutdown for a Node HTTP server. Shutdown begins while a request is still being handled: the server stops accepting new requests, waits up to 5 seconds for in-flight requests, and then closes the database pool. Run it directly with Node 24.

```ts doc-test=run
import { createServer } from 'node:http'
import { boundedWait } from '@migaia/lifecycle'
import { createPendingTracker } from '@migaia/lifecycle/quiescence'
import { createLifecycleScope } from '@migaia/lifecycle/scope'

const app = createLifecycleScope()
const inFlight = createPendingTracker()

// Registered first, released last: the database pool closes at the end.
app.own('db-pool', { force: () => console.log('3. database pool closed') })

const server = createServer((request, response) => {
  // Every request is registered as work in flight; handling takes 200 ms.
  void inFlight.track(
    new Promise<void>((resolve) =>
      setTimeout(() => {
        response.end('order saved')
        resolve()
      }, 200)
    )
  )
})
app.own(server, {
  force: async () => {
    server.close() // stop accepting new connections
    console.log('1. stopped accepting requests, waiting for in-flight ones')
    const finished = await boundedWait(inFlight.drain(), performance.now() + 5_000)
    console.log(finished ? '2. all in-flight requests finished' : '2. timed out, closing anyway')
    server.closeAllConnections() // drop remaining idle keep-alive connections
  }
})
server.listen(0)

// In a real service: process.once('SIGTERM', () => void app.dispose())
const { port } = server.address() as { port: number }
const order = fetch(`http://localhost:${port}/orders`, { method: 'POST' }).then((r) => r.text())
await new Promise((resolve) => setTimeout(resolve, 50)) // shut down while the request is in progress
await app.dispose()
console.log('client received:', await order)
```

Output:

```text
1. stopped accepting requests, waiting for in-flight ones
2. all in-flight requests finished
3. database pool closed
client received: order saved
```

The `boundedWait` deadline is an absolute time on the `performance.now()` clock, not `Date.now()`.

Next steps:

- To keep only the latest result in search or navigation, read [USEGUIDE: Use only the latest request's result](./USEGUIDE.en.md#use-only-the-latest-requests-result).
- To clean up automatically when initialisation fails, read [USEGUIDE: Reclaim what was created when initialisation fails](./USEGUIDE.en.md#reclaim-what-was-created-when-initialisation-fails).
- To see what happens when cleanup fails, read [USEGUIDE: One cleanup fails, the rest still run](./USEGUIDE.en.md#one-cleanup-fails-the-rest-still-run).

## What hand-written shutdown gets wrong

Many services shut down like this:

```ts doc-test=skip reason="Illustrates hand-written shutdown code that references undefined service objects"
process.on('SIGTERM', async () => {
  server.close()
  // Pitfall 1: in-flight requests are not awaited; a request writing to the database is cut off.
  await db.end()
  // Pitfall 2: if db.end() throws, cache.quit() below never runs and the first error is lost.
  await cache.quit()
  // Pitfall 3: if any step hangs, the process never exits until the platform kills it.
})
```

With a scope, release order follows registration order, one failure does not stop the others, and every wait has a deadline. A new resource needs a single `own()` call where it is created, instead of another line in the shutdown code.

## What makes it different

- **Even when one cleanup throws, every other resource is still released.** The original error reaches you with a `code` attached (several failures become one `AggregateError`), and no later error hides it. You can also collect failures into an array (`collect`) or pass them to a logger (`report`).
- **Even when `dispose()` is called several times at once, release runs only once.** Every caller receives the same Promise, so no connection is closed twice.
- **Release order is the reverse of registration order by default.** The pool registered first closes last; the service registered later, which depends on it, closes first. You can also order by priority, or try a graceful close first and force it after a timeout.
- **A late answer to an old request never overwrites a newer result.** Starting a new request aborts the old one's signal, and a resource the old request already obtained can be handed to a release function.
- **Every wait has a limit.** `boundedWait` returns at its deadline, so one stuck task cannot hang the whole shutdown; it does not cancel that task on its own.
- **Initialisation either reclaims or hands over everything.** Resources created before a failure are released in reverse order; on success they move to a long-lived scope in one step.
- **It works with native `using`.** The async scope supports `await using` and the sync scope supports `using`. Compared with hand-written `try/finally`, you get concurrency-safe release, error policies and deadlines.

## The model in three minutes

First decide which question you are answering, then pick the matching tool. Tools combine, but each piece of state should be managed by only one of them.

| Your question | Tool |
| --- | --- |
| Who releases these resources, and in what order? | Scope: `createLifecycleScope` (async), `createSyncLifecycleScope` (sync) |
| Initialisation failed halfway; what happens to what was created? | Provisional scope: `createProvisionalScope` |
| Does this async result still count? | Request generations: `createGenerationController` |
| Is any work still unfinished? How long do I wait at most? | `createPendingTracker`, `createQuiescenceTracker`, `boundedWait` |
| Which of several changes goes first? | Mutation queue: `createMutationQueue` |
| How do I close a set of resources gracefully, then by force? | Dispose transaction: `createDisposeTransaction` |
| How do I tell an operation to cancel? | `createAbortController`, `abortableDelay` |

| Term | Meaning |
| --- | --- |
| scope | An object responsible for releasing a set of resources. Register a resource with `own(resource, descriptor)`; release all of them with `dispose()`. |
| descriptor | How one resource is released: `force` is required; `graceful` (try a gentle close first), `gracefulTimeoutMs` and `order` are optional. |
| `close()` / `dispose()` | `close()` stops accepting new resources immediately and runs no cleanup; `dispose()` actually releases everything and returns a Promise. |
| generation | One request started by `begin()`. Once a newer one starts, the older one is stale. |
| token | The ticket for one request. `isCurrent(token)` tells whether that request is still the latest. |
| `deadlineAt` | A deadline on the scheduler's clock (by default `performance.now()`), not `Date.now()`. |
| error policy | What happens when cleanup fails: `throw` (default; throws after everything is released), `collect` (returned as an array), `report` (sent to a callback). |

## Typical scenarios

| Scenario | Building blocks | Details |
| --- | --- | --- |
| Graceful service shutdown | `createLifecycleScope` + `createPendingTracker` + `boundedWait` | [Graceful service shutdown](./USEGUIDE.en.md#graceful-service-shutdown) |
| Show only the latest result for search or navigation | `createGenerationController` | [Use only the latest request's result](./USEGUIDE.en.md#use-only-the-latest-requests-result) |
| Clean up connections, subscriptions and timers when a page closes | `createLifecycleScope` | [Clean up together when a page closes](./USEGUIDE.en.md#clean-up-together-when-a-page-closes) |
| Reclaim resources when plugin install or module setup fails | `createProvisionalScope` | [Reclaim what was created when initialisation fails](./USEGUIDE.en.md#reclaim-what-was-created-when-initialisation-fails) |
| Autosave without reordering | `createMutationQueue` | [Save in submission order](./USEGUIDE.en.md#save-in-submission-order) |
| Keep the original error when cleanup fails | Error policies | [One cleanup fails, the rest still run](./USEGUIDE.en.md#one-cleanup-fails-the-rest-still-run) |

## Install

```bash
pnpm add @migaia/lifecycle
```

Its only dependency is `@migaia/utils`.

## Essential API

| API | Purpose |
| --- | --- |
| `createLifecycleScope()` | Registers a set of resources and releases them together, in reverse order, on `dispose()`. |
| `createGenerationController()` | Issues a ticket per request and accepts only the latest request's result. |
| `createPendingTracker()` + `boundedWait()` | Registers work in flight and waits for it until a deadline. |
| `createProvisionalScope()` | Hands resources to a long-lived scope only if initialisation succeeds; reclaims them otherwise. |
| `createMutationQueue()` | Runs changes one at a time, in submission order. |
| `createDisposeTransaction()` | Closes a set of resources in order: gracefully first, by force after a timeout. |

Full signatures, options, edge cases and error codes for every API are in [USEGUIDE.en.md](./USEGUIDE.en.md).
