/** Native Window startup may drop messages before the remote realm installs its listener. */
import { createRpcHost } from '@migaia/rpc-host'
import { defineFlowPlugin, HostObservationKind } from '@migaia/rpc-host/sdk'
import { deferred } from '@migaia/utils/promise'
import { expect, it } from 'vitest'
import { windowPlugin, sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'
import { windowPair, portPair } from './message-fixture.js'

/** Read only the public semantic handshake discriminator from the original native frame. */
function hello(value: unknown): boolean {
  /** The actual common carrier emits text while its native transport retains the wrapper. */
  const frame = value as { kind?: string; data?: unknown }
  /** Fixture observation does not admit, mutate, or supply any protocol frame. */
  const message = (typeof frame.data === 'string' ? JSON.parse(frame.data) : frame.data) as
    | { kind?: string; step?: string }
    | undefined
  return message?.kind === 'handshake' && message.step === 'hello'
}

it('recovers a lost initiator Window hello and ignores duplicate hellos without another session', async () => {
  /** Real source/origin filtering remains in the production Window carrier. */
  const pair = windowPair()
  /** Observe native delivery while the responder has no listener; the first hello must be lost. */
  const lost = deferred<void>()
  /** A genuine lifecycle observation counts published sessions instead of deriving them from frames. */
  const joinedLeft: unknown[] = []
  /** The responder must publish only its original candidate despite duplicated native delivery. */
  const joinedRight: unknown[] = []
  /** Unexpected protocol failures remain independently visible at both actual Hosts. */
  const reports: unknown[] = []
  pair.right.setSend((message, origin) => {
    if (origin !== 'https://right.test') return
    queueMicrotask(() => {
      pair.right.emit('message', structuredClone(message), pair.left.target, 'https://left.test')
      lost.resolve()
    })
  })
  /** Fixed lexical identities force the first-started endpoint to be the non-responder. */
  const openingLeft = createRpcHost({
    self: { name: 'left', instanceId: 'a-startup-window' },
    plugins: [
      defineFlowPlugin({
        name: 'left-ready-observer',
        setup: () => ({
          observe: (event) => {
            if (event.kind === HostObservationKind.peerReady) joinedLeft.push(event.peerId)
          }
        })
      }),
      windowPlugin({
        window: pair.right.target,
        receiver: pair.left.target,
        origin: 'https://right.test',
        connect: { timeoutMs: 100 }
      })
    ],
    report: (error) => reports.push(error)
  })
  void openingLeft.catch(() => undefined)
  await lost.promise
  expect(pair.right.listeners.get('message')?.size ?? 0).toBe(0)
  expect(pair.right.sent.filter(hello)).toHaveLength(1)
  /** Native duplication affects only the retry hello; every other physical frame keeps one delivery. */
  pair.right.setSend((message, origin) => {
    if (origin !== 'https://right.test') return
    queueMicrotask(() => {
      pair.right.emit('message', structuredClone(message), pair.left.target, 'https://left.test')
      if (hello(message))
        pair.right.emit('message', structuredClone(message), pair.left.target, 'https://left.test')
    })
  })
  /** The second realm now subscribes and sends its own original hello. */
  const openingRight = createRpcHost({
    self: { name: 'right', instanceId: 'z-startup-window' },
    plugins: [
      defineFlowPlugin({
        name: 'right-ready-observer',
        setup: () => ({
          observe: (event) => {
            if (event.kind === HostObservationKind.peerReady) joinedRight.push(event.peerId)
          }
        })
      }),
      windowPlugin({
        window: pair.left.target,
        receiver: pair.right.target,
        origin: 'https://left.test',
        connect: { timeoutMs: 100 }
      })
    ],
    provide: { echo: (value: unknown) => value },
    report: (error) => reports.push(error)
  })
  /** Cleanup joins successful endpoints even when the pre-fix handshake rejects by its real timer. */
  const opened = await Promise.allSettled([openingLeft, openingRight])
  try {
    expect(reports.map((error) => (error as { code: unknown }).code)).toEqual([])
    expect(opened.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
    if (opened[0].status !== 'fulfilled' || opened[1].status !== 'fulfilled') return
    expect(await opened[0].value.window.request('echo', 'recovered')).toBe('recovered')
    expect(Object.keys(opened[0].value.window.peers)).toHaveLength(1)
    expect(Object.keys(opened[1].value.window.peers)).toHaveLength(1)
    expect(joinedLeft).toEqual(['z-startup-window'])
    expect(joinedRight).toEqual(['a-startup-window'])
    expect(pair.right.sent.filter(hello)).toHaveLength(2)
    expect(pair.left.sent.filter(hello)).toHaveLength(1)
    /** A duplicate that arrives after readiness must remain inert as well. */
    pair.right.emit(
      'message',
      structuredClone(pair.right.sent.find(hello)),
      pair.left.target,
      'https://left.test'
    )
    await opened[0].value.window.request('echo', 'after duplicate')
    expect(joinedRight).toEqual(['a-startup-window'])
    expect(reports).toEqual([])
  } finally {
    await Promise.all(
      opened.map((result) => (result.status === 'fulfilled' ? result.value.close() : undefined))
    )
  }
})

it('keeps one hello per side on buffered native MessagePorts', async () => {
  /** Buffered MessagePorts preserve the original hello until their opposite listener starts. */
  const pair = portPair()
  /** The earlier endpoint deliberately uses the same lexical role as the lossy Window scenario. */
  const openingLeft = createRpcHost({
    self: { name: 'left', instanceId: 'a-buffered-port' },
    plugins: [sharedWorkerPlugin({ sharedWorker: { port: pair.left.target } })]
  })
  /** The original queued delivery completes the ordinary bilateral handshake without retry. */
  const openingRight = createRpcHost({
    self: { name: 'right', instanceId: 'z-buffered-port' },
    plugins: [sharedWorkerPlugin({ sharedWorker: { port: pair.right.target } })]
  })
  /** Both actual public Hosts own their independent port subscriptions and Session handles. */
  const hosts = await Promise.all([openingLeft, openingRight])
  try {
    expect(pair.left.sent.filter(hello)).toHaveLength(1)
    expect(pair.right.sent.filter(hello)).toHaveLength(1)
    expect(Object.keys(hosts[0].sharedWorker.peers)).toHaveLength(1)
    expect(Object.keys(hosts[1].sharedWorker.peers)).toHaveLength(1)
  } finally {
    await Promise.all(hosts.map((host) => host.close()))
  }
})
