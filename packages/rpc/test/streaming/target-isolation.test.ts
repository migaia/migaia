import { describe, expect, it, vi } from 'vitest'
import { normalizeRpcEnvelope, RpcRouteProfile } from '../../src/contract/index.js'
import type { IEndpointKernelHost, IEndpointKernelRoute } from '../../src/core/endpoint-kernel.js'
import type { IPreparedEndpoint } from '../../src/core/internal/endpoint-bootstrap.js'
import type {
  IRpcOutboundCommand,
  IRpcOutboundOperationsPort
} from '../../src/core/internal/plugin-shared-keys.js'
import { RpcStreamOwner } from '../../src/core/internal/stream/owner.js'

/** Exercise the real stream owner with an admitted route and captured outbound commands. */
function streamOwner(id: string) {
  const commands: IRpcOutboundCommand[] = []
  let route!: IEndpointKernelRoute
  let accept!: (message: unknown) => void | Promise<void>
  const kernel = {
    generation: 0,
    closingSignal: new AbortController().signal,
    state: 'active',
    assertActive: () => undefined,
    registerRoute: (_kind: string, handler: IEndpointKernelRoute) => {
      route = handler
      return () => undefined
    },
    time: {
      now: () => 0,
      timestamp: () => 0,
      setTimeout: (task: () => void, delayMs: number) => {
        const timer = setTimeout(task, delayMs)
        return { clear: () => clearTimeout(timer) }
      },
      clearTimeout: (timer: { clear: () => void }) => timer.clear()
    }
  } as unknown as IEndpointKernelHost
  const prepared = {
    id,
    options: { uuid: { generate: () => 'same-id' } }
  } as unknown as IPreparedEndpoint<string>
  const outbound = {
    send: ((command: IRpcOutboundCommand) => {
      commands.push(command)
      return command.kind === 'frame' || command.kind === 'stream-open'
        ? Promise.resolve()
        : undefined
    }) as IRpcOutboundOperationsPort['send'],
    noteUnknownField: () => undefined
  }
  const owner = new RpcStreamOwner(kernel, prepared, outbound, (_method, handler) => {
    accept = (message) => handler(message, (signal) => ({ signal }) as never)
    return () => undefined
  })
  return {
    owner,
    commands,
    route: (message: unknown) => route(message),
    accept: (message: unknown) => accept(message)
  }
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

describe('streaming A11 target and sender isolation', () => {
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
