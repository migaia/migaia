import { describe, expect, it } from 'vitest'
import { normalizeRpcEnvelope, RpcRouteProfile } from '@migaia/rpc-contract'
import type { IEndpointKernelHost, IEndpointKernelRoute } from '../../dist/core/endpoint-kernel.js'
import type { IPreparedEndpoint } from '../../dist/core/internal/endpoint-bootstrap.js'
import type {
  IRpcOutboundCommand,
  IRpcOutboundOperationsPort
} from '../../dist/core/internal/plugin-shared-keys.js'
import { RpcStreamOwner } from '../../dist/core/internal/stream/owner.js'
import { RPC_CORE_ERROR_SOURCE } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { deserializeRpcError } from '../../dist/host/error-wire-metadata.js'
import { createRpcError } from '../../dist/host/error-owner.js'
import { attachErrorIdentity } from '@migaia/utils/error'

/** Inspect a test frame after the contract normalizer has accepted it. */
function streamPayload(command: IRpcOutboundCommand) {
  return command.kind === 'frame'
    ? (command.message.data.payload as { event?: string; error?: { cause?: unknown } })
    : undefined
}

/** Drive only the stream-open physical completion boundary without an IPC queue. */
class HeldStreamOpen {
  /** Observe original send order without adding a queue or transport platform. */
  readonly #commands: IRpcOutboundCommand[] = []
  /** A case may select one original physical frame continuation after fixture construction. */
  #onFrame: ((command: IRpcOutboundCommand) => Promise<void>) | undefined
  /** The actual producer registration supplies its already-admitted request handler. */
  #accept!: (message: unknown) => void | Promise<void>
  /** The test resolves the exact original held initial write Promise. */
  #resolveOpen!: () => void
  /** The test rejects that same original initial write with its concrete failure identity. */
  #rejectOpen!: (error: unknown) => void
  /** All original stream-open writes retain the same held physical completion Promise. */
  #opening!: Promise<void>
  /** The real stream owner supplies the sole installed receive handler returned to the test. */
  #route!: IEndpointKernelRoute
  /** The case advances only its existing injected monotonic deadline clock. */
  #now = 0
  /** Original own fixture shape and callback order remain unchanged. */
  readonly value
  /** Construct only the same real stream owner and original per-case ports. */
  constructor() {
    this.#opening = new Promise<void>((resolve, reject) => {
      this.#resolveOpen = resolve
      this.#rejectOpen = reject
    })
    /** The original outbound port records physical effects without adding a queue or provider path. */
    const outbound: IRpcOutboundOperationsPort = {
      send: ((command: IRpcOutboundCommand) => {
        this.#commands.push(command)
        /** Snapshot the original selected frame callback before its receiver-free invocation. */
        const onFrame = this.#onFrame
        if (command.kind === 'frame' && onFrame) return onFrame(command)
        return command.kind === 'stream-open' ? this.#opening : Promise.resolve()
      }) as IRpcOutboundOperationsPort['send'],
      noteUnknownField: () => undefined
    }

    /** The original injected close signal stays separate from the case-controlled held write. */
    const closing = new AbortController()

    /**
     * Only the original stream port owner publishes receive routing and the injected lifetime
     * clock.
     */
    const kernel = {
      registerOwner: () => undefined,
      /** This isolated stream has no optional provider policy owner, as on the real kernel. */
      readOwner: () => undefined,
      generation: 0,
      closingSignal: closing.signal,
      state: 'active',
      assertActive: () => undefined,
      registerRoute: (_kind: string, handler: IEndpointKernelRoute) => {
        this.#route = handler
        return () => undefined
      },
      time: {
        now: () => this.#now,
        timestamp: () => this.#now,
        setTimeout: (task: () => void, delayMs: number) => {
          /** Keep this native timeout receipt paired with its original clear callback. */
          const timer = globalThis.setTimeout(task, delayMs)
          return { clear: () => globalThis.clearTimeout(timer) }
        },
        clearTimeout: (timer: { clear: () => void }) => timer.clear()
      }
    } as unknown as IEndpointKernelHost
    /** Retain the original endpoint identity and exact deterministic id generator. */
    const prepared = {
      id: 'client',
      options: { uuid: { generate: () => 'fixed' } }
    } as unknown as IPreparedEndpoint<string>
    /** Construct the same actual stream owner against these exact original per-case ports. */
    const owner = new RpcStreamOwner(kernel, prepared, outbound, (_method, handler) => {
      this.#accept = (message) => handler(message, (signal) => ({ signal }) as never)
      return () => undefined
    })
    this.value = {
      owner,
      commands: this.#commands,
      resolveOpen: this.#resolveOpen,
      rejectOpen: this.#rejectOpen,
      route: this.#route,
      advance: (elapsedMs: number) => {
        this.#now += elapsedMs
      },
      accept: (message: unknown) => (0, this.#accept)(message),
      onFrame: (handler: (command: IRpcOutboundCommand) => Promise<void>) => {
        this.#onFrame = handler
      }
    }
  }
}

/** Construct the original fixture surface with its actual state held by one owner. */
function heldOpen() {
  return new HeldStreamOpen().value
}

/** Cancel cannot outrun the initial request's unresolved send Promise. */
describe('streaming send-order races', () => {
  it.each(['tag', 'decode'] as const)(
    '%s forged overload cannot claim that the initial stream frame was never sent',
    async (kind) => {
      /** The actual stream owner waits for its original outbound completion. */
      const fixture = heldOpen()
      /** Public diagnostics cannot prove the physical admission state. */
      const wire = {
        source: RPC_CORE_ERROR_SOURCE,
        code: RpcCoreErrorCode.overloaded,
        name: 'RpcError',
        message: 'overload fixture',
        stack: 'overload fixture stack'
      }
      const forged =
        kind === 'decode'
          ? deserializeRpcError(wire)
          : attachErrorIdentity(new Error(wire.message), { source: wire.source, code: wire.code })
      const pending = fixture.owner.open('server', 'count', null).next()
      fixture.rejectOpen(forged)
      await expect(pending).rejects.toMatchObject({
        code: RpcCoreErrorCode.streamResultUnknown,
        cause: forged
      })
      expect(fixture.commands.filter((command) => command.kind === 'frame')).toHaveLength(0)
      await fixture.owner.dispose()
    }
  )

  it('the original owner-minted overload keeps its exact no-send capacity refusal', async () => {
    /** A genuine original admission refusal retains its existing instance and semantic code. */
    const fixture = heldOpen()
    const original = createRpcError(RpcCoreErrorCode.overloaded, 'owner overload fixture')
    const pending = fixture.owner.open('server', 'count', null).next()
    fixture.rejectOpen(original)
    await expect(pending).rejects.toBe(original)
    expect(fixture.commands.filter((command) => command.kind === 'frame')).toHaveLength(0)
    await fixture.owner.dispose()
  })
  it('keeps an unopened iterator local and never issues a later request', async () => {
    const fixture = heldOpen()
    const iterator = fixture.owner.open('server', 'count', null)
    expect(await iterator.return?.('local')).toEqual({ done: true, value: 'local' })
    expect(await iterator.next()).toEqual({ done: true, value: undefined })
    expect(fixture.commands).toHaveLength(0)
    await fixture.owner.dispose()
  })

  it('passes the one stream scope and cumulative deadline to stream-open', async () => {
    const fixture = heldOpen()
    const iterator = fixture.owner.open('server', 'count', null, { timeoutMs: 500 })
    const pending = iterator.next()
    for (let index = 0; index < 3; index += 1) await Promise.resolve()
    const opening = fixture.commands.find((command) => command.kind === 'stream-open')
    expect(opening?.kind).toBe('stream-open')
    if (opening?.kind !== 'stream-open') return
    expect(opening.operation?.signal.aborted).toBe(false)
    expect(opening.operation?.remaining()).toBe(500)
    fixture.advance(300)
    expect(opening.operation?.remaining()).toBe(200)
    const returned = iterator.return?.('local')
    expect(opening.operation?.signal.aborted).toBe(true)
    fixture.resolveOpen()
    for (let index = 0; index < 3; index += 1) await Promise.resolve()
    await fixture.route({
      envelope: normalizeRpcEnvelope({
        kind: 'stream',
        id: opening.id,
        data: {
          route: {
            profile: RpcRouteProfile,
            type: 'stream',
            applicationVersion: '1',
            senderId: 'server',
            targetId: 'client',
            sentAt: 0
          },
          payload: { event: 'cancelled', seq: 0 }
        }
      })
    })
    expect(await returned).toEqual({ done: true, value: 'local' })
    expect(await pending).toEqual({ done: true, value: undefined })
    await fixture.owner.dispose()
  })

  it('waits for stream-open success before a single cancel and admits its acknowledgement', async () => {
    const fixture = heldOpen()
    const iterator = fixture.owner.open('server', 'count', null)
    const pending = iterator.next()
    for (let index = 0; index < 3; index += 1) await Promise.resolve()
    const opening = fixture.commands.find((command) => command.kind === 'stream-open')
    expect(opening?.kind).toBe('stream-open')
    const returned = iterator.return?.('local')
    expect(fixture.commands.filter((command) => command.kind === 'frame')).toHaveLength(0)
    fixture.resolveOpen()
    await Promise.resolve()
    await Promise.resolve()
    const cancel = fixture.commands.find((command) => command.kind === 'frame')
    expect(cancel?.kind).toBe('frame')
    if (cancel?.kind !== 'frame' || opening?.kind !== 'stream-open') return
    expect(cancel.message.data.payload).toEqual({ event: 'cancel', seq: 0 })
    await fixture.route({
      envelope: normalizeRpcEnvelope({
        kind: 'stream',
        id: opening.id,
        data: {
          route: {
            profile: RpcRouteProfile,
            type: 'stream',
            applicationVersion: '1',
            senderId: 'server',
            targetId: 'client',
            sentAt: 0
          },
          payload: { event: 'cancelled', seq: 0 }
        }
      })
    })
    expect(await returned).toEqual({ done: true, value: 'local' })
    expect(await pending).toEqual({ done: true, value: undefined })
    await fixture.owner.dispose()
  })

  it('does not emit cancel if stream-open itself rejects before physical completion', async () => {
    const fixture = heldOpen()
    const iterator = fixture.owner.open('server', 'count', null)
    const pending = iterator.next()
    for (let index = 0; index < 3; index += 1) await Promise.resolve()
    const returned = iterator.return?.('local')
    fixture.rejectOpen(new Error('not sent'))
    expect(await returned).toEqual({ done: true, value: 'local' })
    expect(await pending).toEqual({ done: true, value: undefined })
    expect(fixture.commands.filter((command) => command.kind === 'frame')).toHaveLength(0)
    await fixture.owner.dispose()
  })

  it('accepts a cancelled notification after end settled a sent cancel', async () => {
    const fixture = heldOpen()
    const iterator = fixture.owner.open('server', 'count', null)
    const pending = iterator.next()
    for (let index = 0; index < 3; index += 1) await Promise.resolve()
    const opening = fixture.commands.find((command) => command.kind === 'stream-open')
    if (opening?.kind !== 'stream-open') throw new Error('stream-open missing')
    fixture.resolveOpen()
    const returned = iterator.return?.('local')
    for (let index = 0; index < 3; index += 1) await Promise.resolve()
    const deliver = (event: 'end' | 'cancelled') =>
      fixture.route({
        envelope: normalizeRpcEnvelope({
          kind: 'stream',
          id: opening.id,
          data: {
            route: {
              profile: RpcRouteProfile,
              type: 'stream',
              applicationVersion: '1',
              senderId: 'server',
              targetId: 'client',
              sentAt: 0
            },
            payload: { event, seq: 0 }
          }
        })
      })
    await deliver('end')
    expect(await returned).toEqual({ done: true, value: 'local' })
    expect(await pending).toEqual({ done: true, value: undefined })
    await deliver('cancelled')
    expect(fixture.commands.filter((command) => command.kind === 'report')).toHaveLength(0)
    await fixture.owner.dispose()
  })

  it('isolates an uncertain item send and preserves its original cause', async () => {
    const fixture = heldOpen()
    fixture.owner.provide('count', function* () {
      yield 'one'
    })
    const sendError = new Error('write may have started')
    fixture.onFrame(async (command) => {
      if (
        command.kind === 'frame' &&
        command.message.id === 'first' &&
        streamPayload(command)?.event === 'item'
      )
        throw sendError
    })
    const envelope = (id: string) =>
      normalizeRpcEnvelope({
        kind: 'request',
        id,
        method: 'count',
        data: {
          route: {
            profile: RpcRouteProfile,
            type: 'request',
            applicationVersion: '1',
            senderId: 'server',
            targetId: 'client',
            sentAt: 0
          },
          payload: null
        }
      })
    await fixture.accept({ envelope: envelope('first') })
    await fixture.accept({ envelope: envelope('second') })
    const pull = (id: string) =>
      fixture.route({
        envelope: normalizeRpcEnvelope({
          kind: 'stream',
          id,
          data: {
            route: {
              profile: RpcRouteProfile,
              type: 'stream',
              applicationVersion: '1',
              senderId: 'server',
              targetId: 'client',
              sentAt: 0
            },
            payload: { event: 'pull', seq: 0 }
          }
        })
      })
    await pull('first')
    await pull('second')
    const failed = fixture.commands.find(
      (command) =>
        command.kind === 'frame' &&
        command.message.id === 'first' &&
        streamPayload(command)?.event === 'fail'
    )
    expect(failed).toMatchObject({
      message: { data: { payload: { error: { code: 'STREAM_RESULT_UNKNOWN' } } } }
    })
    if (failed?.kind === 'frame')
      expect(streamPayload(failed)?.error?.cause).toMatchObject({ message: sendError.message })
    expect(
      fixture.commands.some(
        (command) =>
          command.kind === 'frame' &&
          command.message.id === 'second' &&
          streamPayload(command)?.event === 'item'
      )
    ).toBe(true)
    await fixture.owner.dispose()
  })
})
