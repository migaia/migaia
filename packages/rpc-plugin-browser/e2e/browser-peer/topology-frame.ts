/**
 * Cross-origin iframe of the forwarding topology: the origin of every call, reaching the top
 * window's dedicated worker through the top window.
 */
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { timeoutFeature } from '@migaia/rpc-host/features/timeout'
import { windowPlugin } from '@migaia/rpc-plugin-browser'
import {
  Topology,
  binaryPattern
} from '../../../rpc-integration/test/host/fixtures/topology-vocabulary.ts'
import { BrowserTopology } from './topology-names.ts'

/** Origin of the top window, passed as ordinary fixture configuration. */
const parentOrigin = new URL(location.href).searchParams.get('parentOrigin')!
/** Both topologies use the same operations; only their advertised leaf path differs. */
const leafPrefix = new URL(location.href).searchParams.has(BrowserTopology.nestedQuery)
  ? `${BrowserTopology.worker}.${BrowserTopology.sharedLeaf}`
  : BrowserTopology.worker
/** Options shared by every traced business call. */
const traced = { trace: Topology.trace } as const

/** Portable classification of one error and its `cause` chain for Playwright. */
function classify(error: unknown) {
  /** Codes, sources and messages along `cause`, bounded by the chain length. */
  const chain: { source?: string; code?: string; message?: string }[] = []
  /** Current node in the walk. */
  let node: unknown = error
  while (node && typeof node === 'object' && chain.length < 32) {
    /** One node's public classification. */
    const failure = node as { source?: string; code?: string; message?: string; cause?: unknown }
    chain.push({ source: failure.source, code: failure.code, message: failure.message })
    node = failure.cause
  }
  return { chain, route: (error as { route?: unknown })?.route ?? null }
}

/** Settle a call and return either its value or its classified error. */
async function settle(pending: Promise<unknown>) {
  try {
    return { value: await pending }
  } catch (error) {
    return { error: classify(error) }
  }
}

/** The iframe host connected to the top window. */
const host = (await (async () => {
  parent.postMessage({ topologyFixture: 'loaded' }, parentOrigin)
  return createRpcHost({
    self: {
      name: BrowserTopology.frame,
      instanceId: `${BrowserTopology.frame}-${crypto.randomUUID()}`
    },
    plugins: [
      windowPlugin({
        window: parent,
        origin: parentOrigin,
        receiver: window
      })
    ]
  })
})()) as unknown as IRpcHost

/** Forward one traced call through the top window to the worker leaf. */
function viaTop(method: string, payload?: unknown, options: Record<string, unknown> = {}) {
  return host.window.send(BrowserTopology.top, `${leafPrefix}.${method}`, payload as never, {
    ...traced,
    ...options
  })
}

/** Operations Playwright runs inside this iframe. */
globalThis.topologyFrame = {
  echo: (value: number) => settle(viaTop(Topology.echo, value)),
  fail: () => settle(viaTop(Topology.fail)),
  inspect: () => host.window.send(BrowserTopology.top, Topology.inspect),
  /** Pull three values through both hops, then cancel. */
  streamCancel: async () => {
    /** Lazy stream through the top window to the worker generator. */
    const stream = host.window
      .streamTo(BrowserTopology.top, `${leafPrefix}.${Topology.ticks}`, undefined, traced)
      [Symbol.asyncIterator]()
    /** Values pulled before cancelling. */
    const values: unknown[] = []
    for (let index = 0; index < 3; index++) values.push((await stream.next()).value)
    await stream.return?.()
    return values
  },
  /** Start an abortable wait, abort it with a reason once the leaf runs it, and settle. */
  abort: async () => {
    /** Caller-owned cancellation. */
    const controller = new AbortController()
    /** Forwarded wait that settles only on abort. */
    const pending = settle(viaTop(Topology.wait, undefined, { signal: controller.signal }))
    for (let attempt = 0; attempt < 100; attempt++) {
      /** Worker counters read through the top window. */
      const inspected = (await host.window.send(BrowserTopology.top, Topology.inspect)) as {
        worker: { waitCalls: number }
      }
      if (inspected.worker.waitCalls > 0) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    controller.abort(new Error('caller stopped'))
    return pending
  },
  deadline: () => settle(viaTop(Topology.remaining, undefined, { timeout: timeoutFeature({ ms: 5000 }) })),
  bytes: () => settle(viaTop(Topology.bytes, binaryPattern(1 << 20))),
  /** Keep a wait in flight, have the top window close its worker namespace, and settle. */
  closeMiddle: async () => {
    /** Forwarded wait that stays in flight until the worker hop closes. */
    const pending = settle(viaTop(Topology.wait))
    await new Promise((resolve) => setTimeout(resolve, 50))
    await host.window.send(BrowserTopology.top, BrowserTopology.closeWorker)
    return pending
  }
}

declare global {
  var topologyFrame: Record<string, (...args: never[]) => Promise<unknown>>
}
