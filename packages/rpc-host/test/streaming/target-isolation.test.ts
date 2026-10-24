import { describe, expect, it, vi } from 'vitest'
import { normalizeRpcEnvelope, RpcRouteProfile } from '@migaia/rpc-contract'
import type { IEndpointKernelHost, IEndpointKernelRoute } from '../../dist/core/endpoint-kernel.js'
import type { IPreparedEndpoint } from '../../dist/core/internal/endpoint-bootstrap.js'
import type {
  IRpcOutboundCommand,
  IRpcOutboundOperationsPort
} from '../../dist/core/internal/plugin-shared-keys.js'
import { RpcStreamOwner } from '../../dist/core/internal/stream/owner.js'

/** Exercise the real stream owner with an admitted route and captured outbound commands. */
class IsolatedStreamOwner {
  /** Keep each actual owner outbound effect separate for target and sender isolation assertions. */
  readonly #commands: IRpcOutboundCommand[] = []
  /** The real owner publishes only its own admitted receive route. */
  #route!: IEndpointKernelRoute
  /** The original local provider registration admits requests only for this owner. */
  #accept!: (message: unknown) => void | Promise<void>
  /** Original own fixture shape and callback order remain unchanged. */
  readonly value
  /** Construct only the same real stream owner and original per-case ports. */
  constructor(id: string) {
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
      assertActive: () => undefined,
      registerRoute: (_kind: string, handler: IEndpointKernelRoute) => {
        this.#route = handler
        return () => undefined
      },
      time: {
        now: () => 0,
        timestamp: () => 0,
        setTimeout: (task: () => void, delayMs: number) => {
          /** Keep this native timeout receipt paired with its original clear callback. */
          const timer = setTimeout(task, delayMs)
          return { clear: () => clearTimeout(timer) }
        },
        clearTimeout: (timer: { clear: () => void }) => timer.clear()
      }
    } as unknown as IEndpointKernelHost
    /** Retain the original endpoint identity and exact deterministic id generator. */
    const prepared = {
      id,
      options: { uuid: { generate: () => 'same-id' } }
    } as unknown as IPreparedEndpoint<string>
    /** The original outbound port records physical effects without adding a queue or provider path. */
    const outbound = {
      send: ((command: IRpcOutboundCommand) => {
        this.#commands.push(command)
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
      accept: (message: unknown) => (0, this.#accept)(message)
    }
  }
}

/** Construct the original fixture surface with its actual state held by one owner. */
function streamOwner(id: string) {
  return new IsolatedStreamOwner(id).value
}

/** Build an already-admitted frame for a specified sender and receiver. */
function frame(
  kind: 'request' | 'stream',
  senderId: string,
  targetId: string,
  event?: 'open' | 'pull' | 'item' | 'cancel',
  value?: string,
  streamId = 'same-id'
) {
  return {
    envelope: normalizeRpcEnvelope({
      kind,
      id: streamId,
      ...(kind === 'request' ? { method: 'count' } : {}),
      data: {
        route: {
          profile: RpcRouteProfile,
          type: kind,
          applicationVersion: '1',
          senderId,
          targetId,
          sentAt: 0
        },
        payload:
          kind === 'request' ? null : { event, seq: 0, ...(value === undefined ? {} : { value }) }
      }
    })
  }
}

describe('streaming target and sender isolation', () => {
  it('keeps two caller streams with the same id separate by target', async () => {
    const fixture = streamOwner('client')
    const first = fixture.owner.open('alpha', 'count', null)
    const second = fixture.owner.open('beta', 'count', null)
    try {
      const firstNext = first.next()
      const secondNext = second.next()
      await vi.waitFor(() =>
        expect(fixture.commands.filter((command) => command.kind === 'stream-open')).toHaveLength(2)
      )
      const opens = fixture.commands.filter((command) => command.kind === 'stream-open')
      expect(opens).toMatchObject([
        { id: 'TASK:client:same-id', targetId: 'alpha' },
        { id: 'TASK:client:same-id', targetId: 'beta' }
      ])
      await fixture.route(frame('stream', 'alpha', 'client', 'open', undefined, opens[0]!.id))
      await fixture.route(frame('stream', 'beta', 'client', 'open', undefined, opens[1]!.id))
      await vi.waitFor(() =>
        expect(
          fixture.commands
            .filter((command) => command.kind === 'frame')
            .map((command) => (command.kind === 'frame' ? command.message.data.route.targetId : ''))
        ).toEqual(['alpha', 'beta'])
      )
      await fixture.route(frame('stream', 'intruder', 'client', 'item', 'wrong', opens[0]!.id))
      await fixture.route(frame('stream', 'beta', 'client', 'item', 'b', opens[1]!.id))
      await fixture.route(frame('stream', 'alpha', 'client', 'item', 'a', opens[0]!.id))
      expect(await firstNext).toEqual({ done: false, value: 'a' })
      expect(await secondNext).toEqual({ done: false, value: 'b' })
    } finally {
      await fixture.owner.dispose()
    }
  })

  it('keeps two producer streams with the same id separate by admitted sender', async () => {
    const fixture = streamOwner('server')
    let produced = 0
    fixture.owner.provide('count', () => {
      produced += 1
      const value = String(produced)
      return (function* () {
        yield value
      })()
    })
    try {
      await fixture.accept(frame('request', 'alpha', 'server'))
      await fixture.accept(frame('request', 'beta', 'server'))
      await fixture.route(frame('stream', 'intruder', 'server', 'pull'))
      await fixture.route(frame('stream', 'intruder', 'server', 'cancel'))
      expect(produced).toBe(2)
      await fixture.route(frame('stream', 'beta', 'server', 'pull'))
      await fixture.route(frame('stream', 'alpha', 'server', 'pull'))
      const items = fixture.commands.flatMap((command) => {
        if (command.kind !== 'frame') return []
        const payload = command.message.data.payload as { event?: string; value?: string }
        return payload.event === 'item'
          ? [{ targetId: command.message.data.route.targetId, value: payload.value }]
          : []
      })
      expect(items).toEqual([
        { targetId: 'beta', value: '2' },
        { targetId: 'alpha', value: '1' }
      ])
    } finally {
      await fixture.owner.dispose()
    }
  })
})
