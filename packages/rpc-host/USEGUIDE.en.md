# rpc-host usage guide

[README](./README.en.md) · [中文](./USEGUIDE.md)

Configure one transport plugin with `createRpcHost`, then install features as needed. These scenarios use real public entries; existing owners retain transport preparation, directories, and native cleanup.

## Open and completely close a bidirectional connection

This complete example needs host, contract, and coroutines. The parent installs a timeout feature; the child creates its host from the generation-local connect handle. It asserts the business result, prints 42, and closes both sides through finally.

The complete runnable example appears under “Migrating from old packages”, covering parent/child hosts, the timeout feature, and finally cleanup.

Coroutines share the event loop rather than Worker isolation. With processPlugin or threadPlugin, business providers and calls stay the same. Each host has one actual call endpoint, including a host with multiple sessions.

## Provide functions, generators, and cooperative cancellation

provide is a nested function object. Return values become results and thrown errors use the existing error boundary. Registering a duplicate method rejects without replacing the original.

```ts doc-test=check
import type { IRpcHost, IRpcContext } from '@migaia/rpc-host'

export function exposeWork(host: IRpcHost) {
  host.provide({
    double: (value: number) => value * 2,
    values: async function* (end: number) {
      for (let value = 0; value < end; value++) yield value
    },
    wait: (_value: unknown, context: IRpcContext) => {
      if (context.signal.aborted) throw context.signal.reason
      return new Promise<void>((_resolve, reject) => {
        context.signal.addEventListener('abort', () => reject(context.signal.reason), {
          once: true
        })
      })
    }
  })
}
```

Callers cancel through options.signal; providers receive their own context.signal. Cancellation affects that call rather than killing a process or rolling back side effects. The wait example deliberately awaits cancellation; real work releases its own resources in finally.

## Select a target and consume streams

A declaration can describe one capability or map direct names to capabilities. This helper accepts an already connected host and preserves the relationship between target and method:

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'

type IWorkers = {
  worker: {
    double(value: number): number
    values(end: number): AsyncIterable<number>
  }
}

export async function useWorker(host: IRpcHost<IWorkers>) {
  const answer: number = await host.send('worker', 'double', 21)
  const values: number[] = []
  for await (const value of host.peers.worker.values(3)) values.push(value)
  return { answer, values }
}
```

An ordinary untargeted request/notify/group/outcome returns empty fulfilled/rejected maps with zero targets, a scalar with one target (rejecting on failure), and per-target fulfilled/rejected maps with multiple targets. Multi-target stream returns independent iterators; one return/cancellation does not cancel others. A pool is one logical target and selects one member per operation.

## Notifications, groups, and uncertainty

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'

type IApi = { update(value: number): number }
export async function sendUpdates(host: IRpcHost<IApi>) {
  await host.notify('update', 1, { targetId: 'worker' })
  const outcomes = await host.group([
    { method: 'update', payload: 2 },
    { method: 'update', payload: 3 }
  ])
  return outcomes
}
```

A notify Promise means physical sending completed, not that business work acknowledged it. dispatch returns void synchronously and reports failures. Each selected target owns its group; there is no cross-target transaction. outcome(key) reads the existing retained idempotency result. Reconnection does not prove that uncertain work never executed.

Call timeoutMs overrides host.defaultTimeoutMs, which overrides the timeoutFeature default. Transport connect.timeoutMs independently bounds handshake preparation. Aggregate and individual feature imports identify the same definition; install one spelling:

```ts doc-test=check
import timeoutFeature from '@migaia/rpc-host/features/timeout'

export const deadline = timeoutFeature({ ms: 1500 })
```

## Publish forwarding capabilities and automatic namespaces

Let b connect to c, publish this capability, then let callers obtain the resulting directory:

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'

type INext = { c: { render(value: string): string } }
export function publishHeldRender(b: IRpcHost<INext>) {
  b.provide({ render: b.peers.c.render })
}
```

A held function stays bound to c's original generation and rejects after retirement. It does not retarget a successor. Alternatively, a calls send('b', 'c.render', value): b first verifies c is a current live direct peer, then reads c's current directory. Disconnected/reconnecting targets reject with TARGET_UNKNOWN; missing methods retain the existing method error. Loops and a fourth forwarding hop reject before business execution. Names that cannot form a method segment remain usable through direct selection or explicit provide aliases, without changing method grammar.

## Generate types from accepted directories

```ts doc-test=check
import { typegenFeature } from '@migaia/rpc-host/features'

export const declarations = typegenFeature({
  out: {
    write: (fileName, text) => {
      console.log(fileName, text)
    }
  }
})
```

Install declarations in plugins. write is application-owned output; this example displays filename and text, while the application chooses actual file I/O. Generation follows accepted directories regardless of peer language. Method input/output/yield schemas come from the real contract description; a new generation writes only after acceptance. Uninstall stops further writes, and output failures reach host.report.

## Migrating from old packages

Rename packages first: rpc-core→rpc-host, rpc-process→rpc-plugin-process, rpc-threads→rpc-plugin-thread, rpc-browser→rpc-plugin-browser, rpc-pool→rpc-plugin-pool, rpc-devtools→rpc-plugin-devtools. Coroutines live in rpc-plugin-coroutines. Old names below identify migrations rather than compatibility entries.

| Retired API family                                                                  | Replacement                                                                           |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `createEndpoint` / `createFullEndpoint`                                             | `createRpcHost` + one transport; local `provide`, direct `send`, untargeted `request` |
| `createClientEndpoint` / `createProviderEndpoint`                                   | Same host entry; omit or supply local `provide`                                       |
| `createComposedEndpoint` / old outbound/provider/discovery/control presets          | Install supported public features on the host; no preset or root graph                |
| `createFullOneWayEndpoint` / `sendOneWay`                                           | `host.notify` for physical-send completion; `dispatch` for fire-and-report            |
| `createRuntimeApiEndpoint`                                                          | Host owns the one call endpoint; authors supply raw deployment through `/plugin`      |
| `createRuntimePeer` / `createManagedRuntimePeer` / `createRuntimePlugin`            | Host plus transport; original native supervision owns generations                     |
| `createRemoteHost` / `createRemotePlugin` / `serveRemoteHost` / `serveRemotePlugin` | Host + transport + provide, or native plugin-host installation                        |
| `createProcessPeer`                                                                 | `createRpcHost` + `processPlugin`; explicit parent child source                       |
| `createThreadPeer`                                                                  | `createRpcHost` + `threadPlugin`; browser Worker uses browser plugin                  |
| `createBrowserPeer` / old web adapter user setup                                    | Host plus one of the seven browser carrier plugins                                    |
| `createProcessPlugin` / `createThreadPlugin`                                        | `processPlugin` / `threadPlugin` installed on host or ordinary PluginHost             |
| old coroutine host/plugin factories                                                 | `coroutinePlugin` from its own package; child receives opaque connect handle          |
| `createPool` / `createThreadPool` / `createProcessPool`                             | Transport + `poolPlugin`; logical target pool, one scalar execution                   |
| `createRpcDevtools`                                                                 | `devtoolsPlugin().collector`; install that same definition for observation            |

This complete replacement uses only new public entries. It runs the parent, child, and timeout feature, then closes them in finally.

```ts doc-test=run
import assert from 'node:assert/strict'
import { createRpcHost } from '@migaia/rpc-host'
import { timeoutFeature } from '@migaia/rpc-host/features'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'

const host = await createRpcHost<{ double(value: number): number }>({
  plugins: [
    coroutinePlugin({
      spawn: async ({ connect, signal }) => {
        const child = await createRpcHost({
          plugins: [coroutinePlugin({ connectToParent: connect })],
          provide: { double: (value: number) => value * 2 }
        })
        try {
          if (!signal.aborted)
            await new Promise<void>((resolve) => {
              signal.addEventListener('abort', () => resolve(), { once: true })
            })
        } finally {
          await child.close()
        }
      }
    }),
    timeoutFeature({ ms: 1500 })
  ]
})
try {
  const value = await host.request('double', 21)
  assert.equal(value, 42)
  console.log(value)
} finally {
  await host.close()
}
```

Each host accepts one transport and one member assembler, with each feature definition appearing at most once. Keep the factory's actual registered object; copying/spreading it does not preserve registration authority. connect options configure preparation at installation, not repeated installation or hot replacement.

## Errors and closure

Branch on source/code: rpc.endpoint owns host/call errors, rpc.remote managed uncertainty, and rpc.transport.* native carriers. Keep native types, stack, cause, and errors. Do not match messages or assume unknown results are safely retryable. close/asyncDispose share the original close Promise and release owned resources; applications retain borrowed native ownership.

Ordinary PluginHost installs the same genuine definitions, retaining original replacement and reverse cleanup. Source authors use cold raw deployments and scope capabilities from @migaia/rpc-host/plugin, never a complete legacy call object as a source. Individual transport, pool, and observation guides explain their native ownership.
