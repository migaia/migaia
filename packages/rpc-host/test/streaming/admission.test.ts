import { createRpcError } from '../../dist/host/error-owner.js'
import { describe, expect, it } from 'vitest'
import { normalizeRpcEnvelope, RpcRouteProfile, RpcStreamLimit } from '@migaia/rpc-contract'
import type { IEndpointKernelHost, IEndpointKernelRoute } from '../../dist/core/endpoint-kernel.js'
import type { IPreparedEndpoint } from '../../dist/core/internal/endpoint-bootstrap.js'
import type {
  IRpcOutboundCommand,
  IRpcOutboundOperationsPort
} from '../../dist/core/internal/plugin-shared-keys.js'
import { RpcStreamOwner } from '../../dist/core/internal/stream/owner.js'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcStreamErrorText } from '../../dist/core/internal/stream/error-text.js'

/** Uses the stream ports directly because IPC queue admission belongs to its later leaf. */
class StreamAdmissionPorts {
  /** Original outbound effects stay ordered for the actual admission assertions. */
  readonly #commands: IRpcOutboundCommand[] = []
  /** The real stream owner publishes its sole admitted receive handler. */
  #route!: IEndpointKernelRoute
  /** The original registered provider callback receives only already admitted requests. */
  #accept!: (message: unknown) => void | Promise<void>
  /** Only this fixture close operation changes its existing kernel admission. */
  #closed = false
  /** Generate the original per-fixture monotonic stream identity without shared factory captures. */
  #issued = 0
  /** The selected per-case physical refusal callback retains its original receiver-free invocation. */
  readonly #rejectFrame: ((command: IRpcOutboundCommand) => unknown) | undefined
  /** Original own fixture shape and callback order remain unchanged. */
  readonly value
  /** Construct only the same real stream owner and original per-case ports. */
  constructor(rejectFrame?: (command: IRpcOutboundCommand) => unknown) {
    this.#rejectFrame = rejectFrame

    /**
     * Only the original stream port owner publishes receive routing and the injected lifetime
     * clock.
     */
    const kernel = {
      registerOwner: () => undefined,
      /** This isolated stream has no optional provider policy owner, as on the real kernel. */
      readOwner: () => undefined,
      generation: 0,
      closingSignal: new AbortController().signal,
      state: 'active',
      assertActive: () => {
        if (this.#closed) throw new Error('connection closed')
      },
      registerRoute: (_kind: string, handler: IEndpointKernelRoute) => {
        this.#route = handler
        return () => undefined
      },
      time: {
        now: () => 0,
        timestamp: () => 0,
        setTimeout: (task: () => void, delayMs: number) => {
          /** Keep this native timeout receipt paired with its original clear callback. */
          const handle = globalThis.setTimeout(task, delayMs)
          return { clear: () => globalThis.clearTimeout(handle) }
        },
        clearTimeout: (timer: { clear: () => void }) => timer.clear()
      }
    } as unknown as IEndpointKernelHost

    /** Retain the original endpoint identity and exact deterministic id generator. */
    const prepared = {
      id: 'server',
      options: { uuid: { generate: () => `local-${this.#issued++}` } }
    } as unknown as IPreparedEndpoint<string>
    /** The original outbound port records physical effects without adding a queue or provider path. */
    const outbound = {
      send: ((command: IRpcOutboundCommand) => {
        this.#commands.push(command)
        /**
         * Snapshot only the externally supplied refusal callback to preserve receiver-free
         * invocation.
         */
        const rejectFrame = this.#rejectFrame
        /** Retain the exact selected refusal value before completing the original physical send. */
        const rejected = rejectFrame?.(command)
        if (rejected !== undefined) return Promise.reject(rejected)
        return command.kind === 'frame' || command.kind === 'stream-open'
          ? Promise.resolve()
          : undefined
      }) as IRpcOutboundOperationsPort['send'],
      noteUnknownField: () => undefined
    }
    /** Construct the same actual stream owner against these exact original per-case ports. */
    const owner = new RpcStreamOwner(kernel, prepared, outbound, (_method, handler) => {
      this.#accept = (message) => handler(message, (signal) => ({ signal }) as never)
      return () => undefined
    })
    this.value = {
      owner,
      commands: this.#commands,
      route: (message: unknown) => (0, this.#route)(message),
      accept: (message: unknown) => (0, this.#accept)(message),
      close: () => {
        this.#closed = true
      }
    }
  }
}

/** Construct the original fixture surface with its actual state held by one owner. */
function streamPorts(rejectFrame?: (command: IRpcOutboundCommand) => unknown) {
  return new StreamAdmissionPorts(rejectFrame).value
}

/** Read only the already-normalized frame event in an outbound test command. */
function eventOf(command: IRpcOutboundCommand): string | undefined {
  return command.kind === 'frame'
    ? (command.message.data.payload as { event?: string }).event
    : undefined
}

/** Deliver one stream frame to the owner's installed route. */
function frame(
  id: string,
  event: 'open' | 'pull' | 'item' | 'cancel',
  senderId: string,
  targetId: string,
  value?: string
) {
  return {
    envelope: normalizeRpcEnvelope({
      kind: 'stream',
      id,
      data: {
        route: {
          profile: RpcRouteProfile,
          type: 'stream',
          applicationVersion: '1',
          senderId,
          targetId,
          sentAt: 0
        },
        payload: { event, seq: 0, ...(event === 'item' ? { value } : {}) }
      }
    })
  }
}

/** A producer request is already admitted by the ordinary endpoint identity owner. */
function request(id: string, senderId = 'client') {
  return {
    envelope: normalizeRpcEnvelope({
      kind: 'request',
      id,
      method: 'count',
      data: {
        route: {
          profile: RpcRouteProfile,
          type: 'request',
          applicationVersion: '1',
          senderId,
          targetId: 'server',
          sentAt: 0
        },
        payload: null
      }
    })
  }
}

describe('streaming admission', () => {
  it('bounds early-cancel keys per peer and rejects late opens after saturation', async () => {
    const fixture = streamPorts()
    let calls = 0
    fixture.owner.provide('count', function* () {
      calls += 1
      yield calls
    })
    try {
      for (let index = 0; index <= RpcStreamLimit.maxOpenStreamsPerPeer; index += 1)
        await fixture.route(frame(`early-${index}`, 'cancel', 'client', 'server'))
      await fixture.accept(request('early-0'))
      await fixture.accept(request('late-open'))
      expect(calls).toBe(0)
      expect(
        fixture.commands.find(
          (command) => command.kind === 'frame' && command.message.id === 'early-0'
        )
      ).toMatchObject({ message: { data: { payload: { event: 'cancelled' } } } })
      expect(
        fixture.commands.find(
          (command) => command.kind === 'frame' && command.message.id === 'late-open'
        )
      ).toMatchObject({
        message: { data: { payload: { event: 'fail', error: { code: 'OVERLOADED' } } } }
      })
      await fixture.accept(request('other-peer', 'second-client'))
      expect(calls).toBe(0)
      expect(
        fixture.commands.find(
          (command) => command.kind === 'frame' && command.message.id === 'other-peer'
        )
      ).toMatchObject({ message: { data: { payload: { event: 'open' } } } })
    } finally {
      await fixture.owner.dispose()
    }
  })

  it('rejects the 257th active stream from one peer before invoking its provider', async () => {
    const fixture = streamPorts()
    let calls = 0
    fixture.owner.provide('count', () => {
      calls += 1
      return (function* () {
        yield calls
      })()
    })
    try {
      for (let index = 0; index <= RpcStreamLimit.maxOpenStreamsPerPeer; index += 1)
        await fixture.accept(request(`stream-${index}`))
      expect(calls).toBe(RpcStreamLimit.maxOpenStreamsPerPeer)
      const rejected = fixture.commands.find(
        (command) => command.kind === 'frame' && command.message.id === 'stream-256'
      )
      expect(rejected).toMatchObject({
        message: { data: { payload: { event: 'fail', seq: 0, error: { code: 'OVERLOADED' } } } }
      })
      await fixture.accept(request('other-peer', 'second-client'))
      expect(calls).toBe(RpcStreamLimit.maxOpenStreamsPerPeer + 1)
    } finally {
      await fixture.owner.dispose()
    }
  })

  it('keeps an overloaded pull error by identity and withdraws its queued admission', async () => {
    const overload = createRpcError(RpcCoreErrorCode.overloaded, RpcStreamErrorText.peerOverloaded)
    const fixture = streamPorts((command) => (eventOf(command) === 'pull' ? overload : undefined))
    const iterator = fixture.owner.open('client', 'count', null)
    const pending = iterator.next()
    for (let index = 0; index < 3; index += 1) await Promise.resolve()
    const opening = fixture.commands.find((command) => command.kind === 'stream-open')
    if (opening?.kind !== 'stream-open') throw new Error('missing stream-open')
    await fixture.route(frame(opening.id, 'open', 'client', 'server'))
    await expect(pending).rejects.toBe(overload)
    const pull = fixture.commands.find((command) => eventOf(command) === 'pull')
    const cancel = fixture.commands.find((command) => eventOf(command) === 'cancel')
    expect(pull?.kind).toBe('frame')
    expect(cancel?.kind).toBe('frame')
    if (pull?.kind === 'frame' && cancel?.kind === 'frame') {
      expect(pull.admission?.queueSignal?.aborted).toBe(true)
      expect(() => pull.admission?.assertCanSend()).toThrow()
      expect(cancel.admission?.queueSignal).toBeUndefined()
      expect(() => cancel.admission?.assertCanSend()).not.toThrow()
      fixture.close()
      expect(() => cancel.admission?.assertCanSend()).toThrow()
    }
    await fixture.owner.dispose()
  })

  it('returns the producer iterator once and attempts fail after an overloaded item', async () => {
    const overload = createRpcError(RpcCoreErrorCode.overloaded, RpcStreamErrorText.peerOverloaded)
    const fixture = streamPorts((command) => (eventOf(command) === 'item' ? overload : undefined))
    let returned = 0
    fixture.owner.provide('count', () => ({
      [Symbol.iterator]: () => ({
        next: () => ({ done: false as const, value: 'one' }),
        return: () => {
          returned += 1
          return { done: true as const, value: undefined }
        }
      })
    }))
    try {
      await fixture.accept(request('producer'))
      await fixture.route(frame('producer', 'pull', 'client', 'server'))
      expect(returned).toBe(1)
      const item = fixture.commands.find((command) => eventOf(command) === 'item')
      const fail = fixture.commands.find((command) => eventOf(command) === 'fail')
      expect(item?.kind).toBe('frame')
      if (item?.kind === 'frame') expect(item.admission?.queueSignal?.aborted).toBe(true)
      expect(fail).toMatchObject({
        message: { data: { payload: { error: { code: 'OVERLOADED' } } } }
      })
    } finally {
      await fixture.owner.dispose()
    }
  })

  it('rejects an oversized inbound item without delivering it or disturbing a second stream', async () => {
    const fixture = streamPorts()
    const first = fixture.owner.open('client', 'count', null)
    const second = fixture.owner.open('client', 'count', null)
    const firstNext = first.next()
    const secondNext = second.next()
    for (let index = 0; index < 4; index += 1) await Promise.resolve()
    const openings = fixture.commands.filter((command) => command.kind === 'stream-open')
    expect(openings).toHaveLength(2)
    if (openings[0]?.kind !== 'stream-open' || openings[1]?.kind !== 'stream-open') return
    await fixture.route(frame(openings[0].id, 'open', 'client', 'server'))
    await fixture.route(frame(openings[1].id, 'open', 'client', 'server'))
    await fixture.route(frame(openings[0].id, 'item', 'client', 'server', 'x'.repeat(16383)))
    await expect(firstNext).rejects.toMatchObject({
      code: 'INVALID_STREAM',
      violation: 'budget',
      pointer: '/value'
    })
    await fixture.route(frame(openings[1].id, 'item', 'client', 'server', 'ok'))
    expect(await secondNext).toEqual({ done: false, value: 'ok' })
    expect(fixture.commands.filter((command) => command.kind === 'report')).toHaveLength(1)
    await fixture.owner.dispose()
  })
})
