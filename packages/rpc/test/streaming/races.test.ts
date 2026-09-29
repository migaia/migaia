import { describe, expect, it } from 'vitest'
import { normalizeRpcEnvelope, RpcRouteProfile } from '../../src/contract/index.js'
import type { IEndpointKernelHost, IEndpointKernelRoute } from '../../src/core/endpoint-kernel.js'
import type { IPreparedEndpoint } from '../../src/core/internal/endpoint-bootstrap.js'
import type {
  IRpcOutboundCommand,
  IRpcOutboundOperationsPort
} from '../../src/core/internal/plugin-shared-keys.js'
import { RpcStreamOwner } from '../../src/core/internal/stream/owner.js'

/** Inspect a test frame after the contract normalizer has accepted it. */
function streamPayload(command: IRpcOutboundCommand) {
  return command.kind === 'frame'
    ? (command.message.data.payload as { event?: string; error?: { cause?: unknown } })
    : undefined
}

/** Drive only the stream-open physical completion boundary without an IPC queue. */
function heldOpen() {
  const commands: IRpcOutboundCommand[] = []
  let onFrame: ((command: IRpcOutboundCommand) => Promise<void>) | undefined
  let accept!: (message: unknown) => void | Promise<void>
  let resolveOpen!: () => void
  let rejectOpen!: (error: unknown) => void
  const opening = new Promise<void>((resolve, reject) => {
    resolveOpen = resolve
    rejectOpen = reject
  })
  const outbound: IRpcOutboundOperationsPort = {
    send: ((command: IRpcOutboundCommand) => {
      commands.push(command)
      if (command.kind === 'frame' && onFrame) return onFrame(command)
      return command.kind === 'stream-open' ? opening : Promise.resolve()
    }) as IRpcOutboundOperationsPort['send'],
    noteUnknownField: () => undefined
  }
  let route!: IEndpointKernelRoute
  const closing = new AbortController()
  let now = 0
  const kernel = {
    generation: 0,
    closingSignal: closing.signal,
    state: 'active',
    assertActive: () => undefined,
    registerRoute: (_kind: string, handler: IEndpointKernelRoute) => {
      route = handler
      return () => undefined
    },
    time: {
      now: () => now,
      timestamp: () => now,
      setTimeout: () => ({ clear: () => undefined }),
      clearTimeout: () => undefined
    }
  } as unknown as IEndpointKernelHost
  const prepared = {
    id: 'client',
    options: { uuid: { generate: () => 'fixed' } }
  } as unknown as IPreparedEndpoint<string>
  const owner = new RpcStreamOwner(kernel, prepared, outbound, (_method, handler) => {
    accept = handler
    return () => undefined
  })
  return {
    owner,
    commands,
    resolveOpen,
    rejectOpen,
    route,
    advance: (elapsedMs: number) => {
      now += elapsedMs
    },
    accept: (message: unknown) => accept(message),
    onFrame: (handler: (command: IRpcOutboundCommand) => Promise<void>) => {
      onFrame = handler
    }
  }
}

/** A8 cancel cannot outrun the initial request's unresolved send Promise. */
describe('streaming A8 send-order races', () => {
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
