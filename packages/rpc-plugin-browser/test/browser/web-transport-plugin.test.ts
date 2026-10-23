import { expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import {
  createRuntimeWebByteStream,
  createRpcTransportError,
  defineByteAdapter,
  defineTransportPlugin
} from '@migaia/rpc-host/plugin'
import { RpcRouteProfile, normalizeRpcEnvelope } from '@migaia/rpc-contract'
import { encodeRpcStreamTextFrame } from '@migaia/rpc-contract/framing/stream'
import { webTransportPlugin } from '@migaia/rpc-plugin-browser'
import * as endpointOwner from '../../../rpc-host/dist/core/runtime-api-endpoint.js'

/** The test models a reliable native stream, not a browser WebTransport server. */
type INativeSide = Readonly<{
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
}>

/** Native WHATWG streams own every byte queue and write acknowledgement in both directions. */
function nativePair() {
  /** Each direction has one independent native ordered byte stream. */
  const outgoing = new TransformStream<Uint8Array, Uint8Array>()
  /** Response bytes return over the other half of the same bidirectional connection. */
  const incoming = new TransformStream<Uint8Array, Uint8Array>()
  return {
    client: { readable: incoming.readable, writable: outgoing.writable },
    server: { readable: outgoing.readable, writable: incoming.writable }
  }
}

/** The genuine responder reuses the same SDK pump and byte handshake as the tested initiator. */
const responder = defineByteAdapter<INativeSide>({
  open: openNativeSide,
  listen: openNativeSide
})

/** Adapt only native I/O; this fixture never constructs a complete Peer or a second protocol. */
function openNativeSide(side: INativeSide) {
  return createRuntimeWebByteStream(side.readable, side.writable, () => undefined, {
    openFailed: (error) => createRpcTransportError('fixture byte acquisition failed', error),
    closedError: () => createRpcTransportError('fixture byte stream closed'),
    cleanupFailed: (errors) =>
      createRpcTransportError(
        'fixture byte cleanup failed',
        new AggregateError(errors, 'fixture byte cleanup failed', { cause: errors[0] })
      ),
    report: () => undefined
  })
}

/** Open two real hosts concurrently and abort the opposing handshake if either opening fails. */
async function connected(
  clientStream: INativeSide,
  serverStream: INativeSide,
  clientProvide: Parameters<typeof createRpcHost>[0]['provide'] = {},
  serverProvide: Parameters<typeof createRpcHost>[0]['provide'] = {}
) {
  /** Native session ownership stays outside the plugin's created-stream lifetime. */
  const session = {
    ready: Promise.resolve(),
    createBidirectionalStream: vi.fn(async () => clientStream),
    close: vi.fn()
  }
  /** One cancellation source unblocks the other original byte owner on partial construction. */
  const cancellation = new AbortController()
  /** The responder's original raw listen operation selects the canonical responder role. */
  const serverTransport = defineTransportPlugin({
    name: 'reliable-byte-responder',
    mode: 'listen',
    connect: { timeoutMs: 1000 },
    deployment: responder.deployment({ listen: serverStream, peerId: 'pre-hello-placeholder' })
  })
  /** Both attempts stay observed while native hello/accept and directory exchange are in flight. */
  const opening = [
    createRpcHost({
      self: { name: 'wt-client', instanceId: 'wt-client' },
      plugins: [webTransportPlugin({ session, connect: { timeoutMs: 1000 } })],
      provide: clientProvide,
      signal: cancellation.signal,
      report: () => undefined
    }),
    createRpcHost({
      self: { name: 'wt-server', instanceId: 'wt-server' },
      plugins: [serverTransport],
      provide: serverProvide,
      signal: cancellation.signal,
      report: () => undefined
    })
  ] as const
  try {
    /** Actual accepted host facades are returned without substituting any endpoint operation. */
    const hosts = await Promise.all(opening)
    return { hosts, session }
  } catch (primary) {
    cancellation.abort(primary)
    /** Close any completed side as well as observing both original rejected opening Promises. */
    const settled = await Promise.allSettled(opening)
    await Promise.allSettled(
      settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value.close()] : []))
    )
    throw primary
  }
}

/** Consume only the real single-target iterator yielded by the host's canonical stream owner. */
async function items(host: IRpcHost, method: string) {
  /** The actual values stay portable and are never decoded by the fixture. */
  const result: unknown[] = []
  for await (const value of host.stream(method) as AsyncIterableIterator<unknown>)
    result.push(value)
  return result
}

it('runs bidirectional operations and cancellation through one endpoint per reliable-stream host', async () => {
  /** The spy observes construction without replacing the actual canonical endpoint factory. */
  const construction = vi.spyOn(endpointOwner, 'createRuntimeApiEndpoint')
  /** Native streams alone carry the protocol bytes between the two real host installations. */
  const pair = nativePair()
  /** Each side records notification execution independently from physical-send completion. */
  const notes = [[], []] as string[][]
  /** Provider admission and cooperative abort remain independently observable. */
  const admitted = deferred<void>()
  /** Cancellation must reach the actual remote provider's existing signal. */
  const cancelled = deferred<void>()
  /** Every provider result crosses the same negotiated reliable byte pipeline. */
  const providers = (side: number) => ({
    echo: (value: number) => value + side,
    note: (value: string) => {
      notes[side]!.push(value)
    },
    notes: () => notes[side],
    values: async function* () {
      yield side
      yield side + 10
    },
    hold: (_payload: unknown, context: { signal: AbortSignal }) =>
      new Promise<void>((_resolve, reject) => {
        admitted.resolve()
        context.signal.addEventListener(
          'abort',
          () => {
            cancelled.resolve()
            reject(context.signal.reason)
          },
          { once: true }
        )
      })
  })
  /** The public entry is the only operation that may construct either endpoint. */
  let fixture: Awaited<ReturnType<typeof connected>> | undefined
  try {
    fixture = await connected(pair.client, pair.server, providers(0), providers(1))
    expect(fixture.session.createBidirectionalStream).toHaveBeenCalledTimes(1)
    for (const [index, host] of fixture.hosts.entries()) {
      expect(await host.request('echo', 20)).toBe(21 - index)
      await host.notify('note', `from-${index}`)
      expect(await host.request('notes')).toEqual([`from-${index}`])
      expect(await items(host, 'values')).toEqual([1 - index, 11 - index])
      expect(
        await host.group([{ method: 'echo', payload: 30 }], { idempotencyKey: `wt-group-${index}` })
      ).toMatchObject([{ state: 'success', result: 31 - index }])
      expect(await host.outcome(`wt-group-${index}`)).toMatchObject({ state: 'done' })
    }
    /** The caller's abort travels over the existing runtime cancel operation to the remote owner. */
    const controller = new AbortController()
    /** Observe rejection before triggering cancellation of an already-admitted remote call. */
    const pending = fixture.hosts[0]
      .request('hold', undefined, { signal: controller.signal })
      .catch((error: unknown) => error)
    await admitted.promise
    controller.abort(new Error('stop reliable-stream call'))
    expect(await pending).toMatchObject({ code: 'CANCELLED' })
    await cancelled.promise
    expect(
      construction.mock.calls.filter(([config]) => 'id' in config && config.id === 'wt-client')
    ).toHaveLength(1)
    expect(
      construction.mock.calls.filter(([config]) => 'id' in config && config.id === 'wt-server')
    ).toHaveLength(1)
    expect(construction).toHaveBeenCalledTimes(2)
  } finally {
    /** Native stream cancellation is observed before explicitly closing the opposing owner. */
    const failures: unknown[] = []
    for (const host of fixture?.hosts ?? []) {
      try {
        await host.close()
      } catch (error) {
        failures.push(error)
      }
    }
    construction.mockRestore()
    expect(failures).toEqual([])
  }
})

it('rejects pre-handshake business bytes and applies the original silent handshake deadline', async () => {
  /** The provider must remain unreachable before actual byte hello/accept finishes. */
  let executions = 0
  /** Native readable ownership is retained until the tested plugin actually creates its stream. */
  let incoming!: ReadableStreamDefaultController<Uint8Array>
  /** A valid canonical business envelope is still not a valid handshake reply. */
  const early = encodeRpcStreamTextFrame(
    JSON.stringify(
      normalizeRpcEnvelope({
        kind: 'request',
        id: 'early-request',
        method: 'attack',
        data: {
          route: {
            profile: RpcRouteProfile,
            type: 'request',
            applicationVersion: '1.0',
            senderId: 'unaccepted',
            targetId: 'wt-prehandshake',
            sentAt: 0
          },
          payload: null
        }
      })
    ),
    new TextEncoder()
  )
  /** Native write delivery injects the business frame only after the client's real hello write. */
  const attacked = {
    readable: new ReadableStream<Uint8Array>({
      start(controller) {
        incoming = controller
      }
    }),
    writable: new WritableStream<Uint8Array>({
      write() {
        incoming.enqueue(early)
      }
    })
  }
  /** No wire agreement, peer identity or capability is injected by the fixture. */
  const session = { createBidirectionalStream: vi.fn(async () => attacked), close: vi.fn() }
  await expect(
    createRpcHost({
      self: { name: 'wt-prehandshake', instanceId: 'wt-prehandshake' },
      plugins: [webTransportPlugin({ session, connect: { timeoutMs: 30 } })],
      provide: { attack: () => ++executions },
      report: () => undefined
    })
  ).rejects.toMatchObject({ name: 'TypeError', code: 'HANDSHAKE_INVALID' })
  expect(session.createBidirectionalStream).toHaveBeenCalledTimes(1)
  expect(executions).toBe(0)
  expect(session.close).not.toHaveBeenCalled()
  /** This native stream accepts hello but never supplies any incoming byte or fabricated close. */
  const silent = {
    readable: new ReadableStream<Uint8Array>(),
    writable: new WritableStream<Uint8Array>()
  }
  /** Only the existing handshake timer can end this silent preparation. */
  const quiet = { createBidirectionalStream: vi.fn(async () => silent), close: vi.fn() }
  await expect(
    createRpcHost({
      plugins: [webTransportPlugin({ session: quiet, connect: { timeoutMs: 5 } })],
      report: () => undefined
    })
  ).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
  expect(quiet.createBidirectionalStream).toHaveBeenCalledTimes(1)
  expect(quiet.close).not.toHaveBeenCalled()
})

it('waits for native readiness and closes only its created reader and writer once', async () => {
  /** The real transport still uses native streams; spies observe only acquisition and cleanup. */
  const pair = nativePair()
  /** Each successful stream acquisition yields the original native reader handle. */
  const readers: Array<ReturnType<typeof vi.fn>> = []
  /** Each successful acquisition similarly retains the native writer's original abort operation. */
  const writers: Array<ReturnType<typeof vi.fn>> = []
  /** Capture the exact built-in operation before observation changes its object property. */
  const getReader = pair.client.readable.getReader
  /** Native writers preserve their own write ordering and cleanup semantics. */
  const getWriter = pair.client.writable.getWriter
  vi.spyOn(pair.client.readable, 'getReader').mockImplementation(() => {
    /** Exact built-in receiver semantics are required for native stream methods. */
    const reader = Reflect.apply(getReader, pair.client.readable, [])
    readers.push(vi.spyOn(reader, 'cancel'))
    return reader
  })
  vi.spyOn(pair.client.writable, 'getWriter').mockImplementation(() => {
    /** The canonical pump receives this same native writer after observation is attached. */
    const writer = Reflect.apply(getWriter, pair.client.writable, [])
    writers.push(vi.spyOn(writer, 'abort'))
    return writer
  })
  /** Cold plugin configuration cannot open a stream before installation. */
  const cold = { createBidirectionalStream: vi.fn(async () => pair.client), close: vi.fn() }
  webTransportPlugin({ session: cold })
  expect(cold.createBidirectionalStream).not.toHaveBeenCalled()
  /** Readiness belongs to the enclosing borrowed native session, before the one created stream. */
  const ready = deferred<void>()
  /** Observe entry into the native ready boundary before asserting that stream creation is held. */
  const readinessRead = deferred<void>()
  /** A plain native shape lets the test observe the public session boundary directly. */
  const session = {
    get ready() {
      readinessRead.resolve()
      return ready.promise
    },
    createBidirectionalStream: vi.fn(async () => pair.client),
    close: vi.fn()
  }
  /** Abort is only a fallback to clean the opposing attempt if construction fails. */
  const cancellation = new AbortController()
  /** The responder uses the same existing raw byte deployment as the full-operations case. */
  const server = createRpcHost({
    plugins: [
      defineTransportPlugin({
        name: 'close-responder',
        mode: 'listen',
        deployment: responder.deployment({ listen: pair.server, peerId: 'pre-hello-placeholder' })
      })
    ],
    provide: { echo: (value: number) => value },
    signal: cancellation.signal,
    report: () => undefined
  })
  /** Attach failure observers immediately while the public client waits for native readiness. */
  const client = createRpcHost({
    plugins: [webTransportPlugin({ session })],
    signal: cancellation.signal,
    report: () => undefined
  })
  try {
    /** The installation cannot run createBidirectionalStream while ready is pending. */
    await Promise.race([readinessRead.promise, client])
    expect(session.createBidirectionalStream).not.toHaveBeenCalled()
    ready.resolve()
    const hosts = await Promise.all([client, server])
    expect(await hosts[0].request('echo', 42)).toBe(42)
    expect(session.createBidirectionalStream).toHaveBeenCalledTimes(1)
    const closing = hosts[0].close()
    expect(hosts[0].close()).toBe(closing)
    expect(hosts[0][Symbol.asyncDispose]()).toBe(closing)
    await closing
    expect(readers).toHaveLength(1)
    expect(writers).toHaveLength(1)
    expect(readers[0]).toHaveBeenCalledTimes(1)
    expect(writers[0]).toHaveBeenCalledTimes(1)
    expect(session.close).not.toHaveBeenCalled()
    await hosts[1].close()
  } finally {
    cancellation.abort()
    const settled = await Promise.allSettled([client, server])
    await Promise.allSettled(
      settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value.close()] : []))
    )
  }
})
