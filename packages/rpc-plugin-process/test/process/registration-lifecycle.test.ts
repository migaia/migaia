/** Native listener/candidate lifetime uses actual Process serve and SDK owners after the migration. */
import { expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { walkErrorCauses } from '@migaia/utils/error'
import { createManualScheduler } from '@migaia/utils/testing'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { defineTransportPlugin, type IRpcTransportSetupContext } from '@migaia/rpc-host/sdk'
import { serveProcessSessions } from '../../dist/process/plugin/serve.js'
import { openProcessConnectionBootstrap } from '../../dist/process/connection-bootstrap.js'
import { PROCESS_CONNECTION_RUNTIME } from '../../dist/process/constants.js'
import { createProcessResilience } from '../../dist/process/resilience/index.js'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../dist/process/adapters/node-socket.js'
import type {
  IListenProcessByteChannel,
  IProcessByteChannel,
  IProcessByteListener,
  IProcessPendingByteConnection
} from '../../dist/process/types.js'

/** Test configuration only lends real native acquisition and original application callbacks. */
type IListenerSource = Readonly<{
  name: string
  listen: IListenProcessByteChannel
  capture?(context: IRpcTransportSetupContext): void
  createConnectionContext?(): {
    peerId: string
    ipc: { connectionId: string; sessionId: string; log(): void }
  }
}>

/** Normal native metadata remains separate from accepted RPC identity and authentication. */
function connectionContext() {
  return {
    peerId: 'native-route',
    ipc: { connectionId: 'registration', sessionId: 'registration', log: () => undefined }
  }
}

/** Delegate all actual preparation, capacity, drain and physical cleanup to original serve. */
function listenerSource(config: IListenerSource) {
  return defineTransportPlugin({
    name: config.name,
    namespace: 'process',
    open: async (context) => {
      config.capture?.(context)
      /** This complete original receipt retains the actual listener and all adopted Sessions. */
      const serving = await serveProcessSessions(
        {
          kind: 'listener',
          address: 'tcp://127.0.0.1:0',
          listen: config.listen,
          verify: () => 'principal',
          createConnectionContext: config.createConnectionContext ?? connectionContext
        },
        context,
        { maxConnections: 1 }
      )
      return { namespaceExtensions: { members: serving.members }, dispose: serving.close }
    }
  })
}

/** Observe current native pending calls while forwarding the same original capabilities. */
function observePending(
  pending: IProcessPendingByteConnection,
  calls: { accept: number; close: number; physicalClose: number }
): IProcessPendingByteConnection {
  return {
    accept<T>(adopt: (raw: IProcessByteChannel) => Promise<T>): Promise<T> {
      calls.accept += 1
      return pending.accept((raw) => {
        raw.onClose(() => {
          calls.physicalClose += 1
        })
        return adopt(raw)
      })
    },
    close: () => {
      calls.close += 1
      return pending.close()
    }
  }
}

it('rejects excess actual native candidates before accept and returns quota after physical retirement', async () => {
  /** Every incoming native pending capability has its own original forwarding counters. */
  const arrivals: { accept: number; close: number; physicalClose: number }[] = []
  /** Only the real adapter supplies the bound address and listener cleanup. */
  let listener: IProcessByteListener | undefined
  /** Original SDK lookup supplies the exact first adopted Session close Promise. */
  let context: IRpcTransportSetupContext | undefined
  /** Original report payloads remain identifiable, including the native connection-limit code. */
  const reports: unknown[] = []
  /** The original native diagnostic is the deterministic excess-candidate completion barrier. */
  const rejected = deferred<void>()
  /** Native member publication follows client readiness and proves server lookup is selectable. */
  const firstReady = deferred<void>()
  /** The replacement's independent original publication proves exact slot reuse completed. */
  const replacementReady = deferred<void>()
  /** This finite two-member observation never supplies readiness to the native owner. */
  let published = 0
  /** Both actual client roots retain independent physical ownership. */
  const clients: { close(): Promise<void> }[] = []
  /** The public root installs the actual one-slot Process admission owner. */
  const host = await createRpcHost({
    self: { name: 'registration-server', instanceId: 'registration-server' },
    plugins: [
      listenerSource({
        name: 'capacity-listener',
        capture: (value) => {
          context = value
        },
        listen: async (options) => {
          listener = await listenProcessByteChannel({
            ...options,
            onConnection: (pending) => {
              /** Counters only observe the original pending functions; they do not grant admission. */
              const calls = { accept: 0, close: 0, physicalClose: 0 }
              arrivals.push(calls)
              return options.onConnection(observePending(pending, calls))
            }
          })
          return listener
        }
      })
    ],
    report: (error) => {
      reports.push(error)
      rejected.resolve()
    }
  })
  /** Original native events, rather than client startup, delimit canonical server publication. */
  const removeReady = host.process.members.on('ready', () => {
    published += 1
    if (published === 1) firstReady.resolve()
    else replacementReady.resolve()
  })
  /** Native clients use the actual public Process dialer and Session handshake. */
  const connect = (name: string) =>
    createRpcHost({
      self: { name, instanceId: name },
      plugins: [
        processPlugin({
          connect: {
            target: {
              kind: 'connect',
              address: listener!.address,
              token: 'token',
              supervision: { restart: { mode: 'never' } },
              dial: (address, signal) =>
                dialProcessByteChannel({ address, signal: signal as AbortSignal })
            }
          }
        })
      ],
      report: () => undefined
    })
  /** The excess raw peer never sends hello and cannot be admitted or authenticated. */
  let excess: IProcessByteChannel | undefined
  try {
    /** This first genuine native Session owns the sole original quota receipt. */
    const first = await connect('native-first')
    clients.push(first)
    await firstReady.promise
    /** Only its actual original handle can prove physical retirement before quota reuse. */
    const adopted = context!.lookup('native-first')!.handle
    excess = await dialProcessByteChannel({ address: listener!.address })
    await rejected.promise
    expect(arrivals[1]!.accept).toBe(0)
    expect(arrivals[1]!.close).toBe(1)
    expect(arrivals.filter((value) => value.accept === 1)).toHaveLength(1)
    expect(reports).toEqual([
      expect.objectContaining({ source: 'rpc.transport.process', code: 'PROCESS_CONNECTION_LIMIT' })
    ])
    /** Direct callers join the exact same original adopted Session close operation. */
    const closing = adopted.close()
    expect(adopted.close()).toBe(closing)
    await closing
    await adopted.closed
    expect(arrivals[0]!.physicalClose).toBe(1)
    await first.close()
    /** A later actual Session proves the same capacity owner released its exact original slot. */
    const replacement = await connect('native-replacement')
    clients.push(replacement)
    await replacementReady.promise
    expect(context!.lookup('native-replacement')).toBeDefined()
  } finally {
    removeReady()
    await excess?.close()
    await Promise.all(clients.map((client) => client.close()))
    await host.close()
  }
})

it('reports the original application preparation failure and releases each native slot before reuse', async () => {
  /** The exact original application failure must cross the existing native report hook unchanged. */
  const failure = new Error('candidate rejected by application')
  /** Native source callbacks preserve both real failures and their original order. */
  const reports: unknown[] = []
  /** The second report proves both actual callbacks ran rather than a capacity rejection. */
  const reported = deferred<void>()
  /** Each independent real peer observes exactly one physical close. */
  const closes: number[] = []
  /** The real adapter publishes only this actual bound listener. */
  let listener: IProcessByteListener | undefined
  /** Every acquired socket remains finally-owned even if an assertion fails. */
  const peers: IProcessByteChannel[] = []
  /** Actual current connection-context preparation is the supported application callback boundary. */
  const host = await createRpcHost({
    plugins: [
      listenerSource({
        name: 'failing-candidate-listener',
        createConnectionContext: () => {
          throw failure
        },
        listen: async (options) => {
          listener = await listenProcessByteChannel(options)
          return listener
        }
      })
    ],
    report: (error) => {
      reports.push(error)
      if (reports.length === 2) reported.resolve()
    }
  })
  try {
    for (let index = 0; index < 2; index++) {
      /** Only each actual acquired peer supplies this original EOF observation. */
      const closed = deferred<void>()
      /** The original raw adapter retains its physical close and callback identity. */
      const raw = await dialProcessByteChannel({ address: listener!.address })
      peers.push(raw)
      closes[index] = 0
      /** The actual paused native reader must be subscribed before EOF can be consumed. */
      raw.onData(() => undefined)
      raw.onClose(() => {
        closes[index]! += 1
        closed.resolve()
      })
      /** The existing native admission must finish before the application callback can fail. */
      await openProcessConnectionBootstrap(
        raw,
        'token',
        { id: `native-failing-${index}`, runtime: PROCESS_CONNECTION_RUNTIME },
        { signal: new AbortController().signal, report: (error) => reports.push(error) }
      )
      await closed.promise
    }
    await reported.promise
    expect(closes).toEqual([1, 1])
    expect(reports).toEqual([failure, failure])
  } finally {
    await Promise.all(peers.map((raw) => raw.close()))
    await host.close()
  }
})

it('retires an actual listener acquired after its native installation has already closed', async () => {
  /** Public cancellation closes the actual pending native installation, not a stand-in governor. */
  const controller = new AbortController()
  /** Source entry is observed before the original asynchronous native bind is released. */
  const entered = deferred<Parameters<IListenProcessByteChannel>[0]>()
  /** The original native listener factory is allowed to settle after cancellation. */
  const acquired = deferred<IProcessByteListener>()
  /** This captures the actual original serve preparation for deterministic late-cleanup joining. */
  let preparing: Promise<unknown> | undefined
  /** Late physical close remains independently observable. */
  const close = vi.fn(async () => {
    await listener!.close()
  })
  /** A real bound resource is retained for final cleanup even when product cleanup fails. */
  let listener: IProcessByteListener | undefined
  /** Original reports remain separate from the directly observed startup error. */
  const reports: unknown[] = []
  /** This source invokes only the genuine current native serve owner. */
  const source = defineTransportPlugin({
    name: 'late-native-listener',
    namespace: 'process',
    open: (context) => {
      preparing = serveProcessSessions(
        {
          kind: 'listener',
          address: 'tcp://127.0.0.1:0',
          verify: () => 'principal',
          createConnectionContext: connectionContext,
          listen: (options) => {
            entered.resolve(options)
            return acquired.promise
          }
        },
        context
      )
      return preparing.then((value) => ({
        dispose: (value as Awaited<ReturnType<typeof serveProcessSessions>>).close
      }))
    }
  })
  /** The real root startup remains observed while native resource acquisition is pending. */
  const opening = createRpcHost({
    plugins: [source],
    signal: controller.signal,
    report: (error) => reports.push(error)
  }).then(
    () => undefined,
    (error: unknown) => error
  )
  try {
    /** This exact actual listener request is pending at the moment the original root closes. */
    const options = await entered.promise
    /** Native source cancellation, not unfinished root startup, exposes the real close boundary. */
    const nativeClosing = deferred<void>()
    options.signal!.addEventListener('abort', () => nativeClosing.resolve(), { once: true })
    controller.abort(new Error('native listener installation cancelled'))
    await nativeClosing.promise
    listener = await listenProcessByteChannel({ ...options, signal: undefined })
    acquired.resolve({ address: listener.address, close })
    await Promise.allSettled([preparing])
    await opening
    expect(close).toHaveBeenCalledOnce()
    expect(reports).toEqual([])
  } finally {
    await listener?.close()
  }
})

it('joins repeated native close and preserves every independent original listener cleanup error', async () => {
  /** Both native failure objects must remain reachable with their exact identities. */
  const first = new Error('first listener close failed')
  /** The second actual native resource must still close after another disposer rejects. */
  const second = new Error('second listener close failed')
  /** Resource cleanup calls remain separate from wrapper/error-chain shape. */
  const closes = [0, 0]
  /** Existing diagnostics preserve any separately reported native cleanup error. */
  const reports: unknown[] = []
  /** One real source lends both complete receipts to the canonical native core cleanup owner. */
  const source = defineTransportPlugin({
    name: 'cleanup-listeners',
    namespace: 'process',
    open: async (context) => {
      // This fixture has exactly two failure objects from the literal above; no growable sort exists.
      for (const [index, failure] of [second, first].entries()) {
        /** Original serve owns each actual listener and its native cleanup error. */
        const serving = await serveProcessSessions(
          {
            kind: 'listener',
            address: 'tcp://127.0.0.1:0',
            verify: () => 'principal',
            createConnectionContext: connectionContext,
            listen: async (options) => {
              /** The real OS resource closes before its original injected native failure. */
              const listener = await listenProcessByteChannel(options)
              return {
                address: listener.address,
                close: async () => {
                  closes[index]! += 1
                  await listener.close()
                  throw failure
                }
              }
            }
          },
          context
        )
        context.owner.onDispose(serving.close)
      }
      return { dispose: () => undefined }
    }
  })
  /** Native core owns collection, ordering and error aggregation; the fixture adds no runner. */
  const host = await createRpcHost({ plugins: [source], report: (error) => reports.push(error) })
  /** Every caller joins the original current root close promise. */
  const closing = host.close()
  expect(host.close()).toBe(closing)
  /** Only the original native/resource owners construct error wrappers. */
  const observed = await closing.catch((error: unknown) => error)
  /** Canonical graph traversal preserves actual errors through current Host/PluginHost ownership. */
  const chain = walkErrorCauses(observed)
  expect(chain).toContain(first)
  expect(chain).toContain(second)
  expect(chain.indexOf(first)).toBeLessThan(chain.indexOf(second))
  expect(closes).toEqual([1, 1])
  expect(reports).toEqual([])
})

it('rejects terminal subscriptions after the original resilience owner closes', async () => {
  /** Native diagnostic policy keeps its original manual scheduler without any acquired listener. */
  const scheduler = createManualScheduler()
  /** The same actual native resilience owner still owns terminal subscription admission. */
  const owner = createProcessResilience({ scheduler, report: () => undefined })
  await owner.close()
  expect(() => owner.onTerminal(() => undefined)).toThrow(
    expect.objectContaining({ code: 'PROCESS_CHANNEL_CLOSED' })
  )
  expect(scheduler.pendingCount).toBe(0)
})
