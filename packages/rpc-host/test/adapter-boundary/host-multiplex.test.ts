/** Genuine namespaces and Sessions replace the removed logical transport multiplex adapter. */
import { expect, it, vi } from 'vitest'
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { createRpcHost } from '@migaia/rpc-host'
import {
  RpcJsonCarrierCodec,
  createRpcMessageCarrier,
  defineTransportPlugin,
  type IRpcMessageIO
} from '@migaia/rpc-host/sdk'
import { coreMemoryServer } from '../host/core-fixture.ts'

/** The original native MessagePort owns delivery; SDK alone owns its subscriptions and close. */
class FailingMessageIO implements IRpcMessageIO {
  /** This is the actual native endpoint whose error callback initiates the physical failure. */
  readonly #port: MessagePort
  /** Retain no protocol state or receive queue outside the canonical carrier. */
  constructor(port: MessagePort) {
    this.#port = port
  }
  /** Preserve the actual native structured-clone operation and optional transfer list. */
  send(value: unknown, transfer?: readonly ArrayBuffer[]): void {
    this.#port.postMessage(value, transfer === undefined ? undefined : [...transfer])
  }
  /** Release only the exact original message callback. */
  onMessage(listener: (value: unknown) => void): () => void {
    this.#port.on('message', listener)
    return () => {
      this.#port.off('message', listener)
    }
  }
  /** Native EOF remains a different event from physical error. */
  onClose(listener: (reason?: unknown) => void): () => void {
    this.#port.on('close', listener)
    return () => {
      this.#port.off('close', listener)
    }
  }
  /** Physical errors reach the existing carrier error port with their exact native instance. */
  onError(listener: (error: unknown) => void): () => void {
    this.#port.on('error', listener)
    return () => {
      this.#port.off('error', listener)
    }
  }
  /** The SDK carrier owns the once-only native close invocation. */
  close(): void {
    this.#port.close()
  }
}

it('routes two actual physical codec selections without sharing peer identity or business data', async () => {
  /** Actual JSON execution remains on the text carrier's codec rather than a mux projection. */
  const text = coreMemoryServer('host', 'host', 'text', {}, [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** The opposite namespace uses its original whole-object carrier codec. */
  const object = coreMemoryServer('host', 'host', 'object')
  /** The same actual report port observes both local and remote native deliveries. */
  const report = vi.fn()
  /** One public Host owns both native namespaces and no transport facade. */
  const host = await createRpcHost({
    self: { name: 'host', instanceId: 'host' },
    plugins: [text.transport, object.transport],
    report
  })
  /** Original target-specific business values are recorded by real remote providers. */
  const received: string[] = []
  /** The first accepted peer retains its actual text medium. */
  const a = await text.connect('a', {
    report,
    provide: {
      echo: (value: string) => {
        received.push(value)
        return value
      }
    }
  })
  /** A separate physical codec retains its own receiver and native lifetime. */
  const b = await object.connect('b', {
    report,
    provide: {
      echo: (value: string) => {
        received.push(value)
        return value
      }
    }
  })
  /** Physical send inspection observes the selected output instead of re-encoding it in the test. */
  const textWrites = vi.spyOn(a.pair[0], 'write')
  /** Object delivery remains independent from the text framing implementation. */
  const objectWrites = vi.spyOn(b.pair[0], 'write')
  try {
    expect(await host.text.send('a', 'echo', 'one')).toBe('one')
    expect(await host.object.send('b', 'echo', 'two')).toBe('two')
    expect(received).toEqual(['one', 'two'])
    expect(objectWrites).toHaveBeenCalledTimes(1)
    expect(report).not.toHaveBeenCalled()
    expect([text.lookup('a')!.view.peerId, object.lookup('b')!.view.peerId]).toEqual(['a', 'b'])
    expect(textWrites.mock.calls.some(([frame]) => typeof frame.data === 'string')).toBe(true)
    expect(objectWrites.mock.calls.some(([frame]) => typeof frame.data === 'object')).toBe(true)
    expect(text.lookup('b')).toBeUndefined()
    expect(object.lookup('a')).toBeUndefined()
  } finally {
    textWrites.mockRestore()
    objectWrites.mockRestore()
    await Promise.all([host.close(), a.host.close(), b.host.close()])
  }
})

it('retires only a failed physical Session while its other accepted peer remains writable', async () => {
  /** Both real peers share one namespace but keep different original carrier/Session owners. */
  const server = coreMemoryServer('host')
  /** Reports retain the same native Error object when a physical source actually fails. */
  const report = vi.fn()
  /** No separate host-multiplex transport is constructed. */
  const host = await createRpcHost({ ...server.options, report })
  /** Both native endpoints subscribe before either actual Host begins its handshake. */
  const ports = new MessageChannel()
  /** The failing local carrier is lent by its actual native source. */
  const local = createRpcMessageCarrier({
    id: 'physical-local',
    io: new FailingMessageIO(ports.port1),
    report
  })
  /** The remote source is independently owned by its own public Host. */
  const remote = createRpcMessageCarrier({
    id: 'physical-remote',
    io: new FailingMessageIO(ports.port2),
    report: () => undefined
  })
  /** Real SDK attachment performs both original Session admissions. */
  const a = await createRpcHost({
    self: { name: 'a', instanceId: 'a' },
    provide: { echo: (value: string) => value },
    report: () => undefined,
    plugins: [
      defineTransportPlugin({
        name: 'fault-native',
        namespace: 'memory',
        async open(context) {
          const accepted = server.accept(local)
          const connected = context.attach(remote)
          await Promise.all([accepted.ready, connected.ready])
          return { dispose: () => undefined }
        }
      })
    ]
  })
  /** Positive delivery proves B's live state after A is physically retired. */
  const writeB = vi.fn((value: string) => value)
  /** The second accepted peer has its own native subscription and close operation. */
  const b = await server.connect('b', { provide: { echo: writeB } })
  /** The original native cause reaches the actual installed Session receiver directly. */
  const cause = new Error('physical departure')
  try {
    /** The original failing event reaches Session.error, rather than the distinct graceful EOF path. */
    const closed = server.lookup('a')!.handle.closed
    ports.port1.emit('error', cause)
    await closed
    expect(server.lookup('a')).toBeUndefined()
    expect(await host.memory.send('b', 'echo', 'live')).toBe('live')
    expect(writeB).toHaveBeenCalledTimes(1)
    expect(ports.port1.listenerCount('message')).toBe(0)
    expect(b.pair[0].unsubscribed).toBe(0)
    // Preserve the original native report oracle; any failure remains explicit in the local ledger.
    expect(report).toHaveBeenCalledWith(cause)
  } finally {
    await Promise.all([a.close(), b.host.close(), host.close()])
    ports.port1.close()
    ports.port2.close()
  }
})
