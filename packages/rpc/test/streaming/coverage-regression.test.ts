import { describe, expect, it } from 'vitest'
import { normalizeRpcEnvelope, RpcRouteProfile } from '../../src/contract/index.js'
import type { IEndpointKernelHost, IEndpointKernelRoute } from '../../src/core/endpoint-kernel.js'
import type { IPreparedEndpoint } from '../../src/core/internal/endpoint-bootstrap.js'
import type {
  IRpcOutboundCommand,
  IRpcOutboundOperationsPort
} from '../../src/core/internal/plugin-shared-keys.js'
import { RpcStreamOwner } from '../../src/core/internal/stream/owner.js'

/** Drive admitted producer frames and record transport/report effects without a queue. */
function producerFixture(rejectOpen: boolean, rejectFail = false) {
  const commands: IRpcOutboundCommand[] = []
  let route!: IEndpointKernelRoute
  let accept!: (message: unknown) => void | Promise<void>
  const sendError = new Error('open send failed')
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
    id: 'server',
    options: { uuid: { generate: () => 'unused' } }
  } as unknown as IPreparedEndpoint<string>
  const outbound = {
    send: ((command: IRpcOutboundCommand) => {
      commands.push(command)
      if (command.kind === 'frame') {
        const event = (command.message.data.payload as { event?: string }).event
        if ((rejectOpen && event === 'open') || (rejectFail && event === 'fail'))
          return Promise.reject(sendError)
      }
      return Promise.resolve()
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
    sendError,
    route: (message: unknown) => route(message),
    accept: (message: unknown) => accept(message)
  }
}

/** Construct one admitted request or stream frame for the same sender and receiver. */
function frame(
  kind: 'request' | 'stream',
  seq = 0,
  event: 'pull' | 'cancel' | 'cancelled' = 'pull'
) {
  return {
    envelope: normalizeRpcEnvelope({
      kind,
      id: 'stream-1',
      ...(kind === 'request' ? { method: 'count' } : {}),
      data: {
        route: {
          profile: RpcRouteProfile,
          type: kind,
          applicationVersion: '1',
          senderId: 'client',
          targetId: 'server',
          sentAt: 0
        },
        payload: kind === 'request' ? null : { event, seq }
      }
    })
  }
}

describe('streaming A8 producer failure paths', () => {
  it('reports an unknown cancelled frame and a failed fail notification', async () => {
    const fixture = producerFixture(true, true)
    fixture.owner.provide('count', function* () {
      yield 'unused'
    })
    try {
      await fixture.route(frame('stream', 0, 'cancelled'))
      await fixture.accept(frame('request'))
      expect(
        fixture.commands
          .filter((command) => command.kind === 'report')
          .map((command) => command.code)
      ).toContain('INVALID_STREAM')
      expect(
        fixture.commands.some(
          (command) => command.kind === 'report' && command.error === fixture.sendError
        )
      ).toBe(true)
    } finally {
      await fixture.owner.dispose()
    }
  })

  it('acknowledges a cancel admitted before its request without running the provider', async () => {
    const fixture = producerFixture(false)
    let invoked = 0
    fixture.owner.provide('count', function* () {
      invoked += 1
      yield 'unused'
    })
    try {
      await fixture.route(frame('stream', 0, 'cancel'))
      await fixture.accept(frame('request'))
      expect(invoked).toBe(0)
      expect(
        fixture.commands.some(
          (command) =>
            command.kind === 'frame' &&
            (command.message.data.payload as { event?: string }).event === 'cancelled'
        )
      ).toBe(true)
    } finally {
      await fixture.owner.dispose()
    }
  })

  it('keeps the iterator protocol and provider release stable across disposal', async () => {
    const fixture = producerFixture(false)
    const iterator = fixture.owner.open('client', 'count', null)
    expect(iterator[Symbol.asyncIterator]()).toBe(iterator)
    const reason = new Error('local stop')
    await expect(iterator.throw?.(reason)).rejects.toBe(reason)
    const release = fixture.owner.provide('count', function* () {
      yield 'unused'
    })
    release()
    release()
    await fixture.owner.dispose()
    expect(() => fixture.owner.provide('count', function* () {})).toThrow(
      expect.objectContaining({ code: 'CANCELLED' })
    )
  })

  it('sends fail after an uncertain open send and reports secondary cleanup failure', async () => {
    const fixture = producerFixture(true)
    const cleanupError = new Error('cleanup failed')
    let returned = 0
    fixture.owner.provide('count', () => ({
      [Symbol.iterator]() {
        return {
          next: () => ({ done: false, value: 'unused' }),
          return: () => {
            returned += 1
            throw cleanupError
          }
        }
      }
    }))
    try {
      await fixture.accept(frame('request'))
      expect(returned).toBe(1)
      const fail = fixture.commands.find(
        (command) =>
          command.kind === 'frame' &&
          (command.message.data.payload as { event?: string }).event === 'fail'
      )
      expect(fail).toMatchObject({
        message: { data: { payload: { error: { code: 'STREAM_RESULT_UNKNOWN' } } } }
      })
      expect(fixture.commands).toContainEqual(
        expect.objectContaining({ kind: 'report', error: cleanupError })
      )
    } finally {
      await fixture.owner.dispose()
    }
  })

  it('terminates a producer on an out of sequence pull without advancing its iterator', async () => {
    const fixture = producerFixture(false)
    let advanced = 0
    fixture.owner.provide('count', function* () {
      advanced += 1
      yield 'unused'
    })
    try {
      await fixture.accept(frame('request'))
      await fixture.route(frame('stream', 1))
      expect(advanced).toBe(0)
      const fail = fixture.commands.find(
        (command) =>
          command.kind === 'frame' &&
          (command.message.data.payload as { event?: string }).event === 'fail'
      )
      expect(fail).toMatchObject({
        message: { data: { payload: { error: { code: 'INVALID_STREAM' } } } }
      })
      expect(fixture.commands).toContainEqual(
        expect.objectContaining({ kind: 'report', code: 'INVALID_STREAM' })
      )
    } finally {
      await fixture.owner.dispose()
    }
  })
})
