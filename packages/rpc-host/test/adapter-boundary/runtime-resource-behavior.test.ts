/** Native carrier lifecycle receivers replace the removed bootstrap/ACK resource shapes. */
import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { createRpcMessageCarrier, type IRpcMessageIO } from '@migaia/rpc-host/sdk'
import { createRpcHost } from '@migaia/rpc-host'
import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'
import { deferred } from '@migaia/utils/promise'
import { managedMemoryTransport } from '../host/managed-memory-fixture.js'
import { createSharedWorkerCarrier } from '../../../rpc-plugin-browser/dist/browser/adapters/shared-worker.js'
import { createDedicatedWorkerCarrier } from '../../../rpc-plugin-browser/dist/browser/adapters/dedicated-worker.js'
import { reaches } from './audit-byte-fixture.js'
import type { IRpcCarrierFrame } from '@migaia/rpc-contract/interfaces'

/** Only native callback registration and physical close belong to this fixture. */
class NativeMessageIO implements IRpcMessageIO {
  /** Native registrations remain observable independently from the carrier's receiver. */
  readonly events = new EventEmitter()
  /** Physical sends are counted without parsing or manufacturing accepted protocol data. */
  readonly send = vi.fn()
  /** The native termination receipt is distinct from the carrier's shared close Promise. */
  readonly close = vi.fn()

  /** Install the original native message callback and retain its exact remover. */
  onMessage(listener: (value: unknown) => void): () => void {
    this.events.on('message', listener)
    return () => {
      this.events.off('message', listener)
    }
  }
  /** Native EOF uses the same callback/remover boundary as ordinary acquisition. */
  onClose(listener: (reason?: unknown) => void): () => void {
    this.events.on('close', listener)
    return () => {
      this.events.off('close', listener)
    }
  }
  /** Failure identity belongs to the native source rather than a bootstrap wrapper. */
  onError(listener: (error: unknown) => void): () => void {
    this.events.on('error', listener)
    return () => {
      this.events.off('error', listener)
    }
  }
}

it('preserves the original close Promise and removes every original native listener once', async () => {
  /** Only the SDK acquires subscriptions from this actual raw IO owner. */
  const io = new NativeMessageIO()
  /** Reports cannot replace the original successful native cleanup. */
  const report = vi.fn()
  /** No initial, capability offer, ACK or preparation DTO participates in construction. */
  const carrier = createRpcMessageCarrier({ id: 'shared-close', io, report })
  /** One native close joins all concurrent and repeated callers. */
  const closed = carrier.close()
  expect(carrier.close()).toBe(closed)
  await closed
  expect(io.events.listenerCount('message')).toBe(0)
  expect(io.events.listenerCount('close')).toBe(0)
  expect(io.events.listenerCount('error')).toBe(0)
  expect(io.close).toHaveBeenCalledTimes(1)
  expect(report).not.toHaveBeenCalled()
})

it('hands off one cold frame exactly once and removes only the current native receiver', async () => {
  /** The held source delivers before the Session-style receiver is admitted. */
  const io = new NativeMessageIO()
  /** The genuine SDK owns the sole cold slot rather than a test-side handoff queue. */
  const carrier = createRpcMessageCarrier({ id: 'cold-slot', io, report: () => undefined })
  /** Current frames keep their original native object identity through this raw boundary. */
  const initial: IRpcCarrierFrame = { kind: 'message', data: 'buffered' }
  io.events.emit('message', initial)
  /** A receiver is removed before the next physical frame is delivered. */
  const first = vi.fn()
  /** Admission consumes the cold slot synchronously and clears it before callback reentrancy. */
  const removeFirst = carrier.subscribe({
    frame: first,
    close: () => undefined,
    error: () => undefined
  })
  expect(first).toHaveBeenCalledExactlyOnceWith(initial)
  await removeFirst()
  /** Replacing the previous receiver never replays an already consumed cold frame. */
  const second = vi.fn()
  /** Only this registration owns the current receiver. */
  const removeSecond = carrier.subscribe({
    frame: second,
    close: () => undefined,
    error: () => undefined
  })
  expect(second).not.toHaveBeenCalled()
  /** Live data bypasses the now empty cold slot. */
  const live: IRpcCarrierFrame = { kind: 'message', data: 'live' }
  io.events.emit('message', live)
  expect(second).toHaveBeenCalledExactlyOnceWith(live)
  await removeSecond()
  io.events.emit('message', { kind: 'message', data: 'after-remove' })
  expect(second).toHaveBeenCalledTimes(1)
  await carrier.close()
  expect(io.events.listenerCount('message')).toBe(0)
})

it('releases a synchronously failed native registration after its exact remover is returned', async () => {
  /** The native failure object must reach late receiver replay without replacement. */
  const original = new Error('synchronous native failure')
  /** The registration itself owns this precise release operation. */
  const removeFailure = vi.fn()
  /** Original message subscription cleanup remains independently observable. */
  const removeMessage = vi.fn()
  /** The native message callback identity remains visible at the original registration boundary. */
  const add = vi.fn<(listener: (value: unknown) => void) => void>()
  /** The native remover receives exactly the callback that registration acquired. */
  const remove = vi.fn<(listener: (value: unknown) => void) => void>()
  /** The same acquired resource owns physical retirement. */
  const terminate = vi.fn()
  /** Construction may receive failure synchronously before onError returns its remover. */
  const carrier = createRpcMessageCarrier({
    id: 'synchronous-failure',
    report: () => undefined,
    io: {
      send() {},
      onMessage(listener) {
        add(listener)
        return () => {
          removeMessage()
          remove(listener)
        }
      },
      onClose: () => () => undefined,
      onError(listener) {
        listener(original)
        return removeFailure
      },
      close: terminate
    }
  })
  /** A late subscriber sees exactly the original native terminal reason. */
  const closed = vi.fn()
  carrier.subscribe({ frame: () => undefined, close: closed, error: () => undefined })
  await carrier.close()
  expect(removeFailure).toHaveBeenCalledTimes(1)
  expect(removeMessage).toHaveBeenCalledTimes(1)
  expect(remove).toHaveBeenCalledWith(add.mock.calls[0]![0])
  expect(terminate).toHaveBeenCalledTimes(1)
  expect(closed).toHaveBeenCalledExactlyOnceWith(original)
})

it('keeps the native failure identity and one termination across failure and repeated close', async () => {
  /** This original resource owns message, terminal and diagnostic subscriptions. */
  const io = new NativeMessageIO()
  /** The SDK is the single lifetime owner for this acquisition. */
  const carrier = createRpcMessageCarrier({ id: 'native-failure', io, report: () => undefined })
  /** Original error and close notifications are counted separately. */
  const failed = vi.fn(),
    closed = vi.fn()
  carrier.subscribe({ frame: () => undefined, error: failed, close: closed })
  /** Failure is a native callback input rather than an invalid bootstrap envelope. */
  const original = 'native-cause'
  io.events.emit('error', original)
  await carrier.close()
  await carrier.close()
  expect(failed).toHaveBeenCalledExactlyOnceWith(original)
  expect(closed).toHaveBeenCalledExactlyOnceWith(original)
  expect(io.close).toHaveBeenCalledExactlyOnceWith(original)
  expect(io.events.listenerCount('message')).toBe(0)
})

it.each([
  'exit',
  'exit-rejection',
  'exit-close-failure',
  'carrier-error-first',
  'caller-abort-first',
  'native-first-abort'
] as const)(
  'retains an early native %s cause and closes its original carrier once',
  async (mode) => {
    /** The original native cause must survive every real candidate/installation wrapper. */
    const cause = { startup: mode }
    /** The earlier supported failure must remain primary when native departure follows it. */
    const primary = new Error('before native departure')
    /** Public construction cancellation is a real competing input, not a test-side error selector. */
    const controller = new AbortController()
    /** Only this original launcher receipt reports native execution completion. */
    const execution = deferred<void>()
    /** An actual first native send proves the failed unit owns an acquired Session candidate. */
    const written = deferred<void>()
    /** A later caller abort waits only for the actual native close boundary, never a timer. */
    const physicallyClosed = deferred<void>()
    /** The original native cleanup error stays secondary to the selected startup failure. */
    const cleanup = new Error('native candidate close failed')
    /** Count the original physical close; only its selected failure branch rejects cleanup. */
    const close = vi.fn(() => {
      physicallyClosed.resolve()
      if (mode === 'exit-close-failure') throw cleanup
    })
    /** Native registrations remain observable after actual candidate rollback. */
    const events = new EventEmitter()
    /** The same actual budget remains empty after native candidate retirement. */
    const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1, launchRate: false })
    /** Reports retain raw native values without inventing another error normalization boundary. */
    const reports: unknown[] = []
    /** The canonical launcher turns task throw/reject into fulfilled native exit data. */
    const supervisor = createCoroutineSupervisor({
      id: 'early-native',
      budget,
      spec: {
        name: 'early-native',
        task:
          mode !== 'exit-rejection'
            ? async () => {
                await execution.promise
                throw cause
              }
            : () => execution.promise
      },
      report: (error) => reports.push(error),
      restart: { mode: 'never' }
    })
    /** The genuine native generation is installed by the public transport SDK. */
    const transport = managedMemoryTransport({
      name: 'early-native',
      handshakeTimeoutMs: 1000,
      binding: {
        ownership: 'owned',
        supervisor,
        openCarrier: async () => ({
          carrier: createRpcMessageCarrier({
            id: 'early-native',
            report: (error) => reports.push(error),
            io: {
              send() {
                written.resolve()
              },
              onMessage(listener) {
                events.on('message', listener)
                return () => {
                  events.off('message', listener)
                }
              },
              onClose() {
                return () => undefined
              },
              onError(listener) {
                events.on('error', listener)
                return () => {
                  events.off('error', listener)
                }
              },
              close
            }
          })
        })
      },
      report: (error) => reports.push(error)
    })
    /** Public installation owns candidate rollback and the final native rejection. */
    const opening = createRpcHost({
      self: { name: 'local', instanceId: 'local' },
      signal: controller.signal,
      plugins: [transport],
      report: (error) => reports.push(error)
    })
    /** Observe rejection before triggering the actual native execution receipt. */
    const failure = opening.then(
      () => undefined,
      (error: unknown) => error
    )
    try {
      await written.promise
      if (mode === 'carrier-error-first') events.emit('error', primary)
      if (mode === 'caller-abort-first') controller.abort(primary)
      if (mode === 'exit' || mode === 'exit-close-failure') execution.resolve()
      else execution.reject(cause)
      if (mode === 'native-first-abort') {
        await physicallyClosed.promise
        controller.abort(primary)
      }
      /** Exact original native cause remains reachable; no old INVALID_CONFIG wrapper is recreated. */
      const error = await failure
      expect
        .soft(
          reaches(
            error,
            mode === 'carrier-error-first' || mode === 'caller-abort-first' ? primary : cause
          )
        )
        .toBe(true)
      expect(close).toHaveBeenCalledTimes(1)
      expect(events.listenerCount('message')).toBe(0)
      if (mode === 'exit-close-failure') {
        expect(reports.some((value) => reaches(value, cleanup))).toBe(true)
      }
    } finally {
      execution.resolve()
      const result = await Promise.allSettled([opening])
      if (result[0]?.status === 'fulfilled') await result[0].value.close()
      await supervisor.dispose()
      budget.close()
    }
    expect(budget.inUse).toBe(0)
  }
)

it('releases a borrowed EventTarget source without invoking its native close', async () => {
  /** The actual browser acquisition uses only the original native callback surface. */
  const events = new EventEmitter()
  /** Borrowed physical close remains owned by the caller rather than the SDK carrier. */
  const close = vi.fn()
  /** The real SharedWorker source delegates callback custody to its original native object. */
  const port = {
    postMessage() {},
    start() {},
    close,
    addEventListener(type: string, listener: (event: unknown) => void) {
      events.on(type, listener)
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      events.off(type, listener)
    }
  }
  /** No initial or static-capability DTO is minted. */
  const carrier = createSharedWorkerCarrier(port, { report: () => undefined })
  await carrier.close()
  expect(close).not.toHaveBeenCalled()
  expect(events.listenerCount('message')).toBe(0)
})

it.each([undefined, 42, {}, { error: undefined }, { error: null }, { error: 'native-error' }])(
  'preserves the original EventTarget failure cause for %j and releases native hooks',
  async (event) => {
    /** Original native error inputs are delivered by this held source without preprocessing. */
    const events = new EventEmitter()
    /** Current concrete Worker acquisition owns the original EventTarget error mapping. */
    const port = {
      postMessage() {},
      addEventListener(type: string, listener: (event: unknown) => void) {
        events.on(type, listener)
      },
      removeEventListener(type: string, listener: (event: unknown) => void) {
        events.off(type, listener)
      }
    }
    /** SDK receiver and physical cleanup remain the sole terminal owner. */
    const carrier = createDedicatedWorkerCarrier(port, { report: () => undefined })
    /** Actual failure delivery and late replay are observed independently. */
    const failure = vi.fn()
    carrier.subscribe({ frame() {}, error: failure, close() {} })
    events.emit('error', event)
    /**
     * The current native error code differs from the removed bootstrap failure; raw cause is
     * unchanged.
     */
    expect.soft(failure).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        code: 'TRANSPORT',
        cause:
          event && typeof event === 'object' && 'error' in event ? (event.error ?? event) : event
      })
    )
    await carrier.close()
    expect(events.listenerCount('error')).toBe(0)
    expect(events.listenerCount('messageerror')).toBe(0)
    /** The same actual failure object remains the canonical closed-source replay value. */
    const late = vi.fn()
    carrier.subscribe({ frame() {}, error() {}, close: late })
    expect(late).toHaveBeenCalledExactlyOnceWith(failure.mock.calls[0]![0])
  }
)
