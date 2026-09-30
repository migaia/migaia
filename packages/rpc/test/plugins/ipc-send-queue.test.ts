import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import { normalizeRpcEnvelope, RpcRouteProfile, RpcStreamEvent } from '../../src/contract/index.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { createClientEndpoint } from '../../src/core/client.js'
import { createEndpointKernel } from '../../src/core/endpoint-kernel.js'
import { prepareEndpoint } from '../../src/core/internal/endpoint-bootstrap.js'
import { RpcOutboundAttachment } from '../../src/core/internal/outbound-attachment.js'
import { RpcOutboundSender } from '../../src/core/internal/outbound-sender.js'
import { RpcPortName } from '../../src/core/internal/plugin-shared-keys.js'
import { connect } from '../../src/core/middleware/connect.js'
import { abort } from '../../src/core/middleware/abort.js'
import { createFirstPartyRoots } from '../../src/core/internal/first-party-roots.js'
import {
  installOutboundGate,
  registerOutboundGate,
  rollbackOutboundGate
} from '../../src/core/internal/outbound-gate.js'
import type { IRpcTransport } from '../../src/core/transport.js'

/** Loads the new deep entry only inside an oracle so the base suite itself can execute. */
async function queueModule() {
  try {
    return await import('../../src/core/plugins/send-queue.js')
  } catch {
    return null
  }
}

/** Loads the companion reporting entry without turning a missing base module into a load error. */
async function logModule() {
  try {
    return await import('../../src/core/plugins/log.js')
  } catch {
    return null
  }
}

/** Holds one physical send pending until the oracle explicitly releases it. */
function deferredWrite() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

/** Uses a canonical request so gate classification reads only validated protocol fields. */
function request(id: string, trace?: string) {
  return normalizeRpcEnvelope({
    kind: 'request',
    id,
    method: 'test',
    data: {
      route: {
        profile: RpcRouteProfile,
        type: 'request',
        applicationVersion: '1',
        senderId: 'client',
        targetId: 'server',
        sentAt: 0,
        ...(trace === undefined ? {} : { trace })
      }
    }
  })
}

/** Builds normalized stream envelopes for data/control admission assertions. */
function streamFrame(id: string, event: keyof typeof RpcStreamEvent) {
  return normalizeRpcEnvelope({
    kind: 'stream',
    id,
    data: {
      route: {
        profile: RpcRouteProfile,
        type: 'stream',
        applicationVersion: '1.1',
        senderId: 'client',
        targetId: 'server',
        sentAt: 0
      },
      payload: {
        event,
        seq: 1,
        ...(event === RpcStreamEvent.item ? { value: 'value' } : {}),
        ...(event === RpcStreamEvent.fail
          ? {
              error: {
                source: 'rpc',
                code: 'TRANSPORT',
                name: 'Error',
                message: 'failed',
                stack: 'Error: failed'
              }
            }
          : {})
      }
    }
  })
}

/** Builds a normalized variation so control admission is checked from contract fields. */
function variationFrame(id: string, variation: string) {
  return normalizeRpcEnvelope({
    kind: 'variation',
    id,
    data: {
      route: {
        profile: RpcRouteProfile,
        type: 'variation',
        applicationVersion: '1.0',
        senderId: 'client',
        targetId: 'server',
        sentAt: 0,
        variation
      }
    }
  })
}

describe('IPC send queue contract', () => {
  it('[A1] bounds whole envelopes before encoding and preserves FIFO through a wrapped endpoint', async () => {
    const queue = await queueModule()
    expect(queue, '[A1] send-queue entry must exist').not.toBeNull()
    if (!queue) return
    const installed = queue.createIpcSendQueueFeature({ connectionId: 'a1', maxPendingData: 3 })
    const first = deferredWrite()
    const order: string[] = []
    const run = (id: string) =>
      installed.gate.run(request(id), async () => {
        order.push(id)
        if (id === 'one') await first.promise
      })
    const accepted = [run('one'), run('two'), run('three')]
    await expect(run('four')).rejects.toMatchObject({ code: 'OVERLOADED' })
    expect(order, '[A1] only the first admitted envelope may write').toEqual(['one'])
    first.release()
    await Promise.all(accepted)
    expect(order, '[A1] admitted envelopes keep their order').toEqual(['one', 'two', 'three'])

    const [physical] = createMemoryTransportPair()
    const blockedPhysical = deferredWrite()
    const physicalIds: string[] = []
    const slow: IRpcTransport = {
      ...physical,
      send(value) {
        physicalIds.push(JSON.stringify(value))
        return physicalIds.length === 1 ? blockedPhysical.promise : undefined
      }
    }
    const endpointInstallation = queue.createIpcSendQueueFeature({
      connectionId: 'a1-endpoint',
      maxPendingData: 3
    })
    const wrapped = queue.createIpcSendQueueTransport(slow, endpointInstallation.gate)
    const endpoint = await createComposedEndpoint(
      {
        id: 'client',
        transport: wrapped,
        middlewares: [connect({ transport: wrapped })],
        features: [endpointInstallation.feature] as const
      },
      createFirstPartyRoots(new Set(['first-party-outbound']))
    )
    try {
      const calls = [0, 1, 2, 3].map(() =>
        endpoint.send('server', 'test', null, { timeoutMs: false }).catch((error: unknown) => error)
      )
      await expect(
        calls[3],
        '[A1] fourth public call rejects before physical work'
      ).resolves.toMatchObject({
        code: 'OVERLOADED'
      })
      expect(physicalIds, '[A1] one physical write remains unresolved').toHaveLength(1)
      blockedPhysical.release()
      await vi.waitFor(() => expect(physicalIds).toHaveLength(3))
      expect(new Set(physicalIds).size).toBe(3)
    } finally {
      await endpoint.dispose()
    }

    let touched = 0
    const plain: IRpcTransport = { ...physical }
    Object.defineProperty(plain, 'ipcSendGate', {
      get() {
        touched += 1
        throw new Error('must not inspect ad hoc gate')
      }
    })
    const ordinary = await createComposedEndpoint(
      { id: 'ordinary', transport: plain, middlewares: [connect({ transport: plain })] },
      createFirstPartyRoots(new Set(['first-party-outbound']))
    )
    await ordinary.dispose()
    expect(touched, '[A1] core reads only the wrapper WeakMap brand').toBe(0)
  })

  it('[A2] waits for physical writability and emits one high/low threshold crossing', async () => {
    const queue = await queueModule()
    expect(queue, '[A2] send-queue entry must exist').not.toBeNull()
    if (!queue) return
    const installed = queue.createIpcSendQueueFeature({ connectionId: 'a2', maxPendingData: 4 })
    const blocked = deferredWrite()
    const events: string[] = []
    const writes: string[] = []
    installed.gate.onEvent((event) => events.push(event.name))
    const tasks = ['one', 'two', 'three'].map((id) =>
      installed.gate.run(request(id), async () => {
        writes.push(id)
        if (id === 'one') await blocked.promise
      })
    )
    await Promise.resolve()
    expect(writes, '[A2] unresolved send must hold the next write').toEqual(['one'])
    expect(events.filter((name) => name === 'ipc.backlog.high')).toHaveLength(1)
    blocked.release()
    await Promise.all(tasks)
    expect(writes).toEqual(['one', 'two', 'three'])
    expect(events.filter((name) => name === 'ipc.backlog.low')).toHaveLength(1)

    const physical = deferredWrite()
    const frames: unknown[] = []
    const frameTransport: IRpcTransport = {
      platform: 'Memory',
      encodedType: 'string',
      send(frame) {
        frames.push(frame)
        return frames.length === 1 ? physical.promise : undefined
      },
      subscribe: () => () => undefined
    }
    const frameGate = queue.createIpcSendQueueFeature({ connectionId: 'a2-frames' }).gate
    const frameSender = new RpcOutboundSender(
      frameTransport,
      'client',
      {
        protocol: { id: 'test', version: 1, normalize: (value: unknown) => value },
        codec: {
          id: 'test',
          version: 1,
          encodedType: 'string',
          encode: () => 'payload',
          decode: () => request('x')
        },
        framer: {
          id: 'test',
          version: 1,
          inputEncodedType: 'string',
          outputEncodedType: 'string',
          frame: () => ['frame-1', 'frame-2'],
          accept: () => undefined
        },
        ingressPrepare: () => undefined,
        shadowed: []
      } as never,
      undefined,
      frameTransport.platform,
      frameGate
    )
    const frameSend = frameSender.send(request('framed'))
    await vi.waitFor(() => expect(frames).toEqual(['frame-1']))
    physical.release()
    await frameSend
    expect(frames, '[A2] drain must separate physical frames of one envelope').toEqual([
      'frame-1',
      'frame-2'
    ])
  })

  it('[A3] drops a cancelled queued request, reclaims capacity, and keeps its deadline budget', async () => {
    const queue = await queueModule()
    expect(queue, '[A3] send-queue entry must exist').not.toBeNull()
    if (!queue) return
    const scheduler = createManualScheduler()
    const installed = queue.createIpcSendQueueFeature({ connectionId: 'a3', maxPendingData: 2 })
    const blocked = deferredWrite()
    const controller = new AbortController()
    const written: string[] = []
    const first = installed.gate.run(request('first'), () => blocked.promise)
    const cancelled = installed.gate.run(
      request('cancelled'),
      () => {
        written.push('cancelled')
      },
      {
        queueSignal: controller.signal,
        signals: [controller.signal],
        assertCanSend() {
          if (controller.signal.aborted) throw controller.signal.reason
        }
      }
    )
    scheduler.advance(300)
    controller.abort(new Error('cancelled'))
    await expect(cancelled).rejects.toBeDefined()
    const replacement = installed.gate.run(request('replacement'), () => {
      written.push('replacement')
    })
    blocked.release()
    await Promise.all([first, replacement])
    expect(written, '[A3] cancelled queued work must never reach physical send').toEqual([
      'replacement'
    ])
    expect(scheduler.now()).toBe(300)

    const [wire] = createMemoryTransportPair()
    const firstWrite = deferredWrite()
    const outbound: unknown[] = []
    const slow: IRpcTransport = {
      ...wire,
      send(value) {
        outbound.push(value)
        return outbound.length === 1 ? firstWrite.promise : undefined
      }
    }
    const endpointGate = queue.createIpcSendQueueFeature({
      connectionId: 'a3-budget',
      maxPendingData: 2
    })
    const wrapped = queue.createIpcSendQueueTransport(slow, endpointGate.gate)
    const endpoint = await createComposedEndpoint(
      {
        id: 'client-budget',
        transport: wrapped,
        scheduler,
        wallClock: { timestamp: () => 0 },
        middlewares: [connect({ transport: wrapped })],
        features: [endpointGate.feature] as const
      },
      createFirstPartyRoots(new Set(['first-party-outbound']))
    )
    try {
      const head = endpoint
        .send('server', 'test', null, { timeoutMs: false })
        .catch(() => undefined)
      const queued = endpoint.send('server', 'test', null, { timeoutMs: 1000 })
      queued.catch(() => undefined)
      await vi.waitFor(() => expect(outbound).toHaveLength(1))
      scheduler.advance(300)
      firstWrite.release()
      await vi.waitFor(() => expect(outbound).toHaveLength(2))
      const restamped = normalizeRpcEnvelope(outbound[1])
      expect(restamped.kind).toBe('request')
      if (restamped.kind === 'request')
        expect(
          restamped.data.route.timeoutMs,
          '[A3] queued time reduces the wire deadline'
        ).toBeLessThanOrEqual(700)
      scheduler.advance(700)
      await expect(queued).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
      await endpoint.dispose()
      await head
    } finally {
      await endpoint.dispose()
    }

    const streamScheduler = createManualScheduler()
    const streamFrames: unknown[] = []
    const streamWire: IRpcTransport = {
      platform: 'Memory',
      send(value) {
        streamFrames.push(value)
      },
      subscribe: () => () => undefined
    }
    const streamGate = queue.createIpcSendQueueFeature({
      connectionId: 'a3-stream',
      maxPendingData: 2
    })
    const streamTransport = queue.createIpcSendQueueTransport(streamWire, streamGate.gate)
    const streamKernel = createEndpointKernel(streamTransport, undefined, streamScheduler, {
      timestamp: () => 0
    })
    const deferred = await prepareEndpoint(
      {
        id: 'stream-client',
        transport: streamTransport,
        scheduler: streamScheduler,
        wallClock: { timestamp: () => 0 },
        middlewares: []
      },
      { deferMiddlewareInstall: true }
    )
    const prepared = await deferred.finalize(
      [],
      async (operation) => await operation(),
      (key) => (key === RpcPortName.connect ? { uniqueTargetId: 'stream-client' } : undefined),
      () => 0
    )
    const outboundOwner = new RpcOutboundAttachment(streamKernel, prepared)
    const queuedHead = deferredWrite()
    const headFrame = streamGate.gate.run(request('head'), () => queuedHead.promise)
    const streamController = new AbortController()
    try {
      const streamOpen = outboundOwner.sendStreamOpen({
        kind: 'stream-open',
        id: 'stream-open',
        targetId: 'server',
        method: 'test',
        data: null,
        operation: {
          signal: streamController.signal,
          remaining: () => Math.max(0, 1000 - streamScheduler.now())
        }
      })
      streamScheduler.advance(300)
      queuedHead.release()
      await Promise.all([headFrame, streamOpen])
      expect(streamFrames, '[A3] stream-open writes one frame after queue admission').toHaveLength(
        1
      )
      const streamRequest = normalizeRpcEnvelope(streamFrames[0])
      expect(streamRequest.kind).toBe('request')
      if (streamRequest.kind === 'request')
        expect(streamRequest.data.route.timeoutMs).toBeLessThanOrEqual(700)

      for (const mode of ['abort', 'deadline'] as const) {
        const head = deferredWrite()
        const active = streamGate.gate.run(request(`stream-head-${mode}`), () => head.promise)
        const controller = new AbortController()
        const reason = new Error('stream cancelled')
        const deadline = streamScheduler.now() + 500
        const occupancy: number[] = []
        const unsubscribe = streamGate.gate.onEvent((event) => occupancy.push(event.pendingData))
        try {
          const pending = outboundOwner.sendStreamOpen({
            kind: 'stream-open',
            id: `stream-${mode}`,
            targetId: 'server',
            method: 'test',
            data: null,
            operation: {
              signal: controller.signal,
              remaining: () => Math.max(0, deadline - streamScheduler.now())
            }
          })
          pending.catch(() => undefined)
          await vi.waitFor(() =>
            expect(occupancy, `[A3] ${mode} enters the real IPC queue`).toContain(2)
          )
          if (mode === 'abort') controller.abort(reason)
          else streamScheduler.advance(500)
          head.release()
          await active
          if (mode === 'abort')
            await expect(
              pending,
              '[A3] stream-open retains the original abort reason'
            ).rejects.toBe(reason)
          else
            await expect(
              pending,
              '[A3] stream-open retains its deadline code'
            ).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
          await streamGate.gate.whenIdle()
          expect(
            streamFrames,
            `[A3] queued stream-open ${mode} emits no request, abort, or cancel frame`
          ).toHaveLength(1)
          await streamGate.gate.run(request(`replacement-${mode}`), () => undefined)
        } finally {
          head.release()
          unsubscribe()
        }
      }
    } finally {
      streamKernel.beginClose()
      await streamKernel.resources.releaseAll()
    }
  })

  it('[A3] blocks same-tick abort and deadline after queue release', async () => {
    const queue = await queueModule()
    expect(queue).not.toBeNull()
    if (!queue) return
    for (const mode of ['abort', 'deadline'] as const) {
      const gate = queue.createIpcSendQueueFeature({ connectionId: `a3-${mode}` }).gate
      const head = deferredWrite()
      const first = gate.run(request('head'), () => head.promise)
      const controller = new AbortController()
      const reason = new Error(mode)
      let expired = false
      const sent = vi.fn()
      const next = gate.run(request('next'), sent, {
        queueSignal: mode === 'abort' ? controller.signal : undefined,
        signals: [controller.signal],
        assertCanSend() {
          if (controller.signal.aborted || expired) throw reason
        }
      })
      next.catch(() => undefined)
      if (mode === 'abort') controller.abort(reason)
      else expired = true
      head.release()
      await first
      await expect(next, `[A3] ${mode} keeps its primary error`).rejects.toBe(reason)
      expect(sent, `[A3] ${mode} cannot send after queue release`).not.toHaveBeenCalled()
      await gate.whenIdle()
      await gate.run(request('replacement'), () => undefined)
    }
  })

  it('[A3] aborts during protection before first frame but commits all frames after first send', async () => {
    const queue = await queueModule()
    expect(queue).not.toBeNull()
    if (!queue) return
    const gate = queue.createIpcSendQueueFeature({ connectionId: 'a3-protect' }).gate
    const protection = deferredWrite()
    const protectedValues: unknown[] = []
    const frames: unknown[] = []
    const controller = new AbortController()
    const reason = new Error('cancel during protection')
    const transport: IRpcTransport = {
      platform: 'Memory',
      encodedType: 'string',
      send(frame) {
        frames.push(frame)
      },
      subscribe: () => () => undefined
    }
    const components = {
      protocol: { id: 'test', version: 1, normalize: (value: unknown) => value },
      codec: {
        id: 'test',
        version: 1,
        encodedType: 'string',
        encode: () => 'payload',
        decode: () => request('x')
      },
      framer: {
        id: 'test',
        version: 1,
        inputEncodedType: 'string',
        outputEncodedType: 'string',
        frame: () => ['one', 'two', 'three'],
        accept: () => undefined
      },
      ingressPrepare: () => undefined,
      shadowed: []
    } as never
    const sender = new RpcOutboundSender(
      transport,
      'client',
      components,
      {
        protect(value: unknown) {
          protectedValues.push(value)
          return protection.promise.then(() => value)
        }
      } as never,
      transport.platform,
      gate
    )
    const admission = {
      queueSignal: controller.signal,
      signals: [controller.signal],
      assertCanSend() {
        if (controller.signal.aborted) throw reason
      }
    }
    const pending = sender.send(request('protected'), undefined, admission)
    await vi.waitFor(() => expect(protectedValues).toHaveLength(3))
    controller.abort(reason)
    protection.release()
    await expect(pending).rejects.toBe(reason)
    expect(frames, '[A3] pre-send abort must leave zero physical frames').toHaveLength(0)
    await gate.whenIdle()

    const committedGate = queue.createIpcSendQueueFeature({ connectionId: 'a3-committed' }).gate
    const committedFrames: unknown[] = []
    const committedController = new AbortController()
    const committedReason = new Error('after first')
    const committedTransport: IRpcTransport = {
      ...transport,
      send(frame) {
        committedFrames.push(frame)
        if (committedFrames.length === 1) committedController.abort(committedReason)
      }
    }
    const committedSender = new RpcOutboundSender(
      committedTransport,
      'client',
      components,
      undefined,
      committedTransport.platform,
      committedGate
    )
    await committedSender.send(request('committed'), undefined, {
      queueSignal: committedController.signal,
      signals: [committedController.signal],
      assertCanSend() {
        if (committedController.signal.aborted) throw committedReason
      }
    })
    expect(committedFrames, '[A3] first frame commits the whole envelope').toEqual([
      'one',
      'two',
      'three'
    ])
  })

  it('[A3] never sends remote abort for a queued request with no first frame', async () => {
    const queue = await queueModule()
    expect(queue).not.toBeNull()
    if (!queue) return
    const [physical] = createMemoryTransportPair()
    const blocked = deferredWrite()
    const frames: unknown[] = []
    const slow: IRpcTransport = {
      ...physical,
      send(value) {
        frames.push(value)
        return frames.length === 1 ? blocked.promise : undefined
      }
    }
    const installed = queue.createIpcSendQueueFeature({ connectionId: 'a3-no-remote-abort' })
    const wrapper = queue.createIpcSendQueueTransport(slow, installed.gate)
    const endpoint = await createComposedEndpoint(
      {
        id: 'a3-no-remote-abort',
        transport: wrapper,
        middlewares: [connect({ transport: wrapper }), abort()],
        features: [installed.feature] as const
      },
      createFirstPartyRoots(new Set(['first-party-outbound']))
    )
    try {
      const head = endpoint.send('server', 'test', null, { timeoutMs: false })
      head.catch(() => undefined)
      await vi.waitFor(() => expect(frames).toHaveLength(1))
      const controller = new AbortController()
      const queued = endpoint.send('server', 'test', null, {
        timeoutMs: false,
        signal: controller.signal
      })
      queued.catch(() => undefined)
      controller.abort(new Error('caller cancelled before send'))
      await expect(queued).rejects.toBeDefined()
      blocked.release()
      await installed.gate.whenIdle()
      expect(
        frames,
        '[A3] a queued abort emits neither request nor remote abort frame'
      ).toHaveLength(1)
    } finally {
      blocked.release()
      await endpoint.dispose()
    }
  })

  it('[A4] reserves control capacity and refuses a second control envelope without partial frames', async () => {
    const queue = await queueModule()
    expect(queue, '[A4] send-queue entry must exist').not.toBeNull()
    if (!queue) return
    const installed = queue.createIpcSendQueueFeature({
      connectionId: 'a4',
      maxPendingData: 1,
      maxPendingControl: 1
    })
    const blocked = deferredWrite()
    const order: string[] = []
    const data = installed.gate.run(request('data'), async () => {
      order.push('data')
      await blocked.promise
    })
    const pull = normalizeRpcEnvelope({
      kind: 'stream',
      id: 'pull',
      data: {
        route: {
          profile: RpcRouteProfile,
          type: 'stream',
          applicationVersion: '1.1',
          senderId: 'client',
          targetId: 'server',
          sentAt: 0
        },
        payload: { event: 'pull', seq: 1 }
      }
    })
    const control = installed.gate.run(pull, () => {
      order.push('pull')
    })
    await expect(
      installed.gate.run(pull, () => {
        order.push('overflow')
      })
    ).rejects.toMatchObject({
      code: 'OVERLOADED'
    })
    expect(order, '[A4] control cannot interleave the in-flight envelope').toEqual(['data'])
    blocked.release()
    await Promise.all([data, control])
    expect(order).toEqual(['data', 'pull'])
  })

  it('[A4] classifies stream item/open as data and pull/cancel as control', async () => {
    const queue = await queueModule()
    expect(queue).not.toBeNull()
    if (!queue) return
    const gate = queue.createIpcSendQueueFeature({
      connectionId: 'a4-classes',
      maxPendingData: 1,
      maxPendingControl: 1
    }).gate
    const blocked = deferredWrite()
    const active = gate.run(request('active'), () => blocked.promise)
    for (const event of [RpcStreamEvent.item, RpcStreamEvent.open] as const) {
      await expect(
        gate.run(streamFrame(event, event), () => undefined),
        `[A4] ${event} consumes the full data lane`
      ).rejects.toMatchObject({ code: 'OVERLOADED' })
    }
    const pull = gate.run(streamFrame('pull', RpcStreamEvent.pull), () => undefined)
    await expect(
      gate.run(streamFrame('cancel', RpcStreamEvent.cancel), () => undefined),
      '[A4] the next control envelope refuses capacity'
    ).rejects.toMatchObject({ code: 'OVERLOADED' })
    blocked.release()
    await Promise.all([active, pull])
  })

  it('[A4] reserves control for protocol variations and leaves other frames in data', async () => {
    const queue = await queueModule()
    expect(queue).not.toBeNull()
    if (!queue) return
    for (const variation of ['abort', 'close', 'ping', 'pong']) {
      const gate = queue.createIpcSendQueueFeature({
        connectionId: `a4-${variation}`,
        maxPendingData: 1,
        maxPendingControl: 1
      }).gate
      const head = deferredWrite()
      const active = gate.run(request('head'), () => head.promise)
      const sent = vi.fn()
      const control = gate.run(variationFrame(variation, variation), sent)
      await expect(
        gate.run(variationFrame(`second-${variation}`, variation), () => undefined),
        `[A4] ${variation} consumes the control slot`
      ).rejects.toMatchObject({ code: 'OVERLOADED' })
      head.release()
      await Promise.all([active, control])
      expect(sent, `[A4] ${variation} sends after the active data envelope`).toHaveBeenCalledTimes(
        1
      )
    }
    for (const event of [RpcStreamEvent.end, RpcStreamEvent.fail] as const) {
      const gate = queue.createIpcSendQueueFeature({
        connectionId: `a4-data-${event}`,
        maxPendingData: 1,
        maxPendingControl: 1
      }).gate
      const head = deferredWrite()
      const active = gate.run(request('head'), () => head.promise)
      await expect(
        gate.run(streamFrame(event, event), () => undefined),
        `[A4] ${event} cannot borrow a control slot`
      ).rejects.toMatchObject({ code: 'OVERLOADED' })
      head.release()
      await active
    }
    const unknownGate = queue.createIpcSendQueueFeature({
      connectionId: 'a4-unknown',
      maxPendingData: 1,
      maxPendingControl: 1
    }).gate
    const unknownHead = deferredWrite()
    const unknownActive = unknownGate.run(request('head'), () => unknownHead.promise)
    await expect(
      unknownGate.run(variationFrame('unknown', 'extension'), () => undefined),
      '[A4] unknown variation cannot borrow control capacity'
    ).rejects.toMatchObject({ code: 'OVERLOADED' })
    unknownHead.release()
    await unknownActive
  })

  it('[A4] removes stale pull/item and preserves four selected terminal notifications', async () => {
    const queue = await queueModule()
    expect(queue).not.toBeNull()
    if (!queue) return
    for (const event of [RpcStreamEvent.pull, RpcStreamEvent.item] as const) {
      const gate = queue.createIpcSendQueueFeature({
        connectionId: `a4-stale-${event}`,
        maxPendingData: 2,
        maxPendingControl: 2
      }).gate
      const head = deferredWrite()
      const active = gate.run(request('head'), () => head.promise)
      const controller = new AbortController()
      const sent = vi.fn()
      const stale = gate.run(streamFrame('stale', event), sent, {
        queueSignal: controller.signal,
        signals: [controller.signal],
        assertCanSend() {
          if (controller.signal.aborted) throw new Error('stream terminal')
        }
      })
      stale.catch(() => undefined)
      controller.abort()
      await expect(stale, `[A4] old ${event} settles on stream termination`).rejects.toBeDefined()
      const fresh = gate.run(streamFrame('fresh', event), () => undefined)
      head.release()
      await Promise.all([active, fresh])
      expect(sent, `[A4] old ${event} never reaches sendNow`).not.toHaveBeenCalled()
      await gate.whenIdle()
    }
    for (const event of [
      RpcStreamEvent.end,
      RpcStreamEvent.fail,
      RpcStreamEvent.cancel,
      RpcStreamEvent.cancelled
    ] as const) {
      const gate = queue.createIpcSendQueueFeature({
        connectionId: `a4-terminal-${event}`,
        maxPendingData: 2,
        maxPendingControl: 2
      }).gate
      const head = deferredWrite()
      const active = gate.run(request('head'), () => head.promise)
      const controller = new AbortController()
      const sent = vi.fn()
      const terminal = gate.run(streamFrame('terminal', event), sent, {
        signals: [controller.signal],
        assertCanSend() {
          return undefined
        }
      })
      controller.abort()
      head.release()
      await Promise.all([active, terminal])
      expect(sent, `[A4] selected ${event} survives its own terminal state`).toHaveBeenCalledTimes(
        1
      )
    }
  })

  it('[A5] reports backlog and stderr with identity while containing reporter failures', async () => {
    const queue = await queueModule()
    const log = await logModule()
    expect(queue && log, '[A5] send-queue and log entries must exist').toBeTruthy()
    if (!queue || !log) return
    const installed = queue.createIpcSendQueueFeature({
      connectionId: 'a5',
      sessionId: 'session',
      maxPendingData: 1
    })
    const records: unknown[] = []
    const reportErrors: unknown[] = []
    const sinkFailure = new Error('log sink failed')
    const logging = log.createIpcLogFeature({
      gate: installed.gate,
      report(record) {
        records.push(record)
        if (record.name === 'ipc.backlog.rejected') throw sinkFailure
        if (record.name === 'ipc.send.failed') return Promise.reject(sinkFailure)
      },
      onReportError(error) {
        reportErrors.push(error)
      }
    })
    expect(logging.feature, '[A5] log must be a native feature').toBeDefined()
    const [wire] = createMemoryTransportPair()
    const wrapped = queue.createIpcSendQueueTransport(wire, installed.gate)
    const endpoint = await createComposedEndpoint(
      {
        id: 'a5',
        transport: wrapped,
        middlewares: [connect({ transport: wrapped })],
        features: [installed.feature, logging.feature] as const
      },
      createFirstPartyRoots(new Set(['first-party-outbound']))
    )
    const hooks: unknown[] = []
    endpoint.hooks.on((event) => {
      hooks.push(event)
    })
    logging.recordStderr({
      name: 'ipc.stderr',
      connectionId: 'a5',
      sessionId: 'session',
      text: 'stderr line'
    })
    const blocked = deferredWrite()
    const active = installed.gate.run(request('active'), () => blocked.promise)
    const rejected = installed.gate.run(request('rejected', 't1'), () => undefined)
    await expect(
      rejected,
      '[A5] reporter failure must not rewrite capacity error'
    ).rejects.toMatchObject({
      code: 'OVERLOADED'
    })
    await vi.waitFor(() => expect(reportErrors).toContain(sinkFailure))
    expect(records).toContainEqual(
      expect.objectContaining({
        name: 'ipc.backlog.rejected',
        connectionId: 'a5',
        sessionId: 'session',
        pendingData: 1,
        trace: 't1'
      })
    )
    expect(hooks).toContainEqual(
      expect.objectContaining({
        name: 'ipc.backlog.rejected',
        contract: expect.objectContaining({ connectionId: 'a5', trace: 't1' })
      })
    )
    blocked.release()
    await active
    await expect(
      installed.gate.run(request('failure'), () =>
        Promise.reject(new Error('physical send failed'))
      )
    ).rejects.toBeDefined()
    await vi.waitFor(() => expect(reportErrors).toHaveLength(2))
    await endpoint.dispose()
    expect(
      records,
      '[A5] stderr must retain connection/session without invented trace'
    ).toContainEqual({
      name: 'ipc.stderr',
      connectionId: 'a5',
      sessionId: 'session',
      text: 'stderr line'
    })
  })

  it('[A5] sends a rejected error reporter to the host terminal reporter', async () => {
    const queue = await queueModule()
    const log = await logModule()
    expect(queue && log).toBeTruthy()
    if (!queue || !log) return
    const observed: unknown[] = []
    const enqueue = globalThis.queueMicrotask
    globalThis.queueMicrotask = (callback) => {
      try {
        callback()
      } catch (error) {
        observed.push(error)
      }
    }
    try {
      for (const mode of ['throw', 'reject'] as const) {
        const gate = queue.createIpcSendQueueFeature({ connectionId: `a5-${mode}` }).gate
        const terminalError = new Error(`terminal reporter ${mode}`)
        const logging = log.createIpcLogFeature({
          gate,
          report: () => Promise.reject(new Error('report failed')),
          onReportError: () => {
            if (mode === 'throw') throw terminalError
            return Promise.reject(terminalError)
          }
        })
        logging.recordStderr({
          name: 'ipc.stderr',
          connectionId: `a5-${mode}`,
          sessionId: 'session',
          text: 'stderr'
        })
        await vi.waitFor(() =>
          expect(observed, `[A5] final reporter observes ${mode} failure`).toContain(terminalError)
        )
      }
    } finally {
      globalThis.queueMicrotask = enqueue
    }
  })

  it('[A5] removes the log Feature subscription on endpoint disposal', async () => {
    const log = await logModule()
    expect(log).not.toBeNull()
    if (!log) return
    const unsubscribe = vi.fn()
    const gate = {
      onEvent: vi.fn(() => unsubscribe)
    } as unknown as Parameters<typeof log.createIpcLogFeature>[0]['gate']
    const logging = log.createIpcLogFeature({
      gate,
      report: () => undefined,
      onReportError: () => undefined
    })
    const [transport] = createMemoryTransportPair()
    const endpoint = await createComposedEndpoint(
      {
        id: 'a5-disposal',
        transport,
        middlewares: [connect({ transport })],
        features: [logging.feature] as const
      },
      createFirstPartyRoots(new Set(['first-party-outbound']))
    )
    expect(gate.onEvent).toHaveBeenCalledTimes(1)
    await endpoint.dispose()
    expect(unsubscribe, '[A5] log Feature releases its gate listener').toHaveBeenCalledTimes(1)
  })

  it('[A6] contains reporter reentry without stealing capacity or changing the original error', async () => {
    const queue = await queueModule()
    const log = await logModule()
    expect(queue && log).toBeTruthy()
    if (!queue || !log) return
    const installation = queue.createIpcSendQueueFeature({
      connectionId: 'a6-reentry',
      maxPendingData: 1
    })
    const reentrantErrors: unknown[] = []
    const logging = log.createIpcLogFeature({
      gate: installation.gate,
      report(record) {
        if (record.name === 'ipc.backlog.high')
          void installation.gate
            .run(request('reentrant'), () => undefined)
            .catch((error: unknown) => reentrantErrors.push(error))
      },
      onReportError: () => undefined
    })
    const [physical] = createMemoryTransportPair()
    const wrapper = queue.createIpcSendQueueTransport(physical, installation.gate)
    const endpoint = await createClientEndpoint({
      id: 'a6-reentry',
      transport: wrapper,
      middlewares: [connect({ transport: wrapper })],
      features: [installation.feature, logging.feature] as const
    })
    try {
      const blocked = deferredWrite()
      const active = installation.gate.run(request('active'), () => blocked.promise)
      await vi.waitFor(() =>
        expect(reentrantErrors, '[A6] reporter reentry rejects at the same capacity bound').toEqual(
          [expect.objectContaining({ code: 'OVERLOADED' })]
        )
      )
      blocked.release()
      await active
      await installation.gate.whenIdle()
    } finally {
      await endpoint.dispose()
    }
  })

  it('[A5] reports remote-abort and dispatch capacity refusal as OVERLOADED', async () => {
    const queue = await queueModule()
    expect(queue).not.toBeNull()
    if (!queue) return
    const [physical] = createMemoryTransportPair()
    const blocked = deferredWrite()
    const frames: unknown[] = []
    const slow: IRpcTransport = {
      ...physical,
      send(value) {
        frames.push(value)
        return frames.length === 1 ? blocked.promise : undefined
      }
    }
    const installed = queue.createIpcSendQueueFeature({
      connectionId: 'a5-capacity',
      maxPendingData: 1,
      maxPendingControl: 1
    })
    const wrapper = queue.createIpcSendQueueTransport(slow, installed.gate)
    const endpoint = await createClientEndpoint({
      id: 'a5-capacity',
      transport: wrapper,
      middlewares: [connect({ transport: wrapper }), abort()],
      features: [installed.feature] as const
    })
    const failures: unknown[] = []
    endpoint.hooks.on((event) => {
      if (event.name === 'failure') failures.push(event)
    })
    try {
      const controller = new AbortController()
      const pending = endpoint.send('server', 'test', null, {
        timeoutMs: false,
        signal: controller.signal
      })
      pending.catch(() => undefined)
      await vi.waitFor(() => expect(frames).toHaveLength(1))
      const occupied = installed.gate.run(variationFrame('occupied', 'ping'), () => undefined)
      endpoint.dispatch('server', 'test', null)
      controller.abort(new Error('stop active request'))
      await expect(pending).rejects.toBeDefined()
      await vi.waitFor(() =>
        expect(
          failures.filter(
            (event) =>
              (event as { readonly code?: unknown }).code === 'OVERLOADED' &&
              (event as { readonly error?: { readonly code?: unknown } }).error?.code ===
                'OVERLOADED'
          ),
          '[A5] dispatch and remote abort retain capacity code in diagnostics'
        ).toHaveLength(2)
      )
      blocked.release()
      await occupied
    } finally {
      blocked.release()
      await endpoint.dispose()
    }
  })

  it('[A6] rejects unmatched gate and feature construction before sending', async () => {
    const queue = await queueModule()
    expect(queue, '[A6] send-queue entry must exist').not.toBeNull()
    if (!queue) return
    const [transport] = createMemoryTransportPair()
    const installed = queue.createIpcSendQueueFeature({ connectionId: 'a6' })
    const wrapped = queue.createIpcSendQueueTransport(transport, installed.gate)
    expect(
      () => queue.createIpcSendQueueTransport(transport, installed.gate),
      '[A6] one physical connection cannot be wrapped twice'
    ).toThrowError(TypeError)
    const missingFeature = createComposedEndpoint(
      { id: 'a6', transport: wrapped, middlewares: [connect({ transport: wrapped })] },
      createFirstPartyRoots(new Set(['first-party-outbound']))
    )
    await expect(missingFeature).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await expect(missingFeature).rejects.toBeInstanceOf(TypeError)
    const [plain] = createMemoryTransportPair()
    await expect(
      createComposedEndpoint(
        {
          id: 'a6-bare',
          transport: plain,
          middlewares: [connect({ transport: plain })],
          features: [installed.feature] as const
        },
        createFirstPartyRoots(new Set(['first-party-outbound']))
      )
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    const other = queue.createIpcSendQueueFeature({ connectionId: 'a6-other' })
    await expect(
      createComposedEndpoint(
        {
          id: 'a6-mismatch',
          transport: wrapped,
          middlewares: [connect({ transport: wrapped })],
          features: [other.feature] as const
        },
        createFirstPartyRoots(new Set(['first-party-outbound']))
      )
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    const recovered = await createComposedEndpoint(
      {
        id: 'a6-recovered',
        transport: wrapped,
        middlewares: [connect({ transport: wrapped })],
        features: [installed.feature] as const
      },
      createFirstPartyRoots(new Set(['first-party-outbound']))
    )
    await recovered.dispose()

    const [secondPhysical] = createMemoryTransportPair()
    const reusable = queue.createIpcSendQueueFeature({ connectionId: 'a6-physical' })
    const firstWrapper = queue.createIpcSendQueueTransport(secondPhysical, reusable.gate)
    await expect(
      createComposedEndpoint(
        {
          id: 'a6-physical-failed',
          transport: firstWrapper,
          middlewares: [connect({ transport: firstWrapper })]
        },
        createFirstPartyRoots(new Set(['first-party-outbound']))
      )
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    const replacement = queue.createIpcSendQueueTransport(secondPhysical, reusable.gate)
    expect(replacement, '[A6] failed construction releases the physical claim').toBeDefined()
    expect(
      () => queue.createIpcSendQueueTransport(replacement, reusable.gate),
      '[A6] a gated wrapper cannot be wrapped again'
    ).toThrowError(TypeError)

    const [earlyPhysical] = createMemoryTransportPair()
    const early = queue.createIpcSendQueueFeature({ connectionId: 'a6-early' })
    const earlyWrapper = queue.createIpcSendQueueTransport(earlyPhysical, early.gate)
    await expect(
      createComposedEndpoint(
        {
          id: 'a6-early-failed',
          transport: earlyWrapper,
          middlewares: [connect({ transport: earlyWrapper })],
          features: [{} as never] as const
        },
        createFirstPartyRoots(new Set(['first-party-outbound']))
      ),
      '[A6] preflight failure must not retain the wrapper claim'
    ).rejects.toBeDefined()
    const afterPreflight = await createComposedEndpoint(
      {
        id: 'a6-after-preflight',
        transport: earlyWrapper,
        middlewares: [connect({ transport: earlyWrapper })],
        features: [early.feature] as const
      },
      createFirstPartyRoots(new Set(['first-party-outbound']))
    )
    await afterPreflight.dispose()
  })

  it('[A6] rejects duplicate registry writes and keeps wrapper close idempotent', async () => {
    const queue = await queueModule()
    expect(queue).not.toBeNull()
    if (!queue) return
    const gate = queue.createIpcSendQueueFeature({ connectionId: 'a6-duplicate' }).gate
    const brand = {}
    const claim = { restore() {}, rollback() {} }
    registerOutboundGate(brand, gate, claim)
    expect(() => registerOutboundGate(brand, gate, claim)).toThrowError(TypeError)
    installOutboundGate(brand, gate)
    expect(() => installOutboundGate(brand, gate)).toThrowError(TypeError)
    rollbackOutboundGate(brand)

    const close = vi.fn()
    const physical: IRpcTransport = {
      platform: 'Memory',
      ownership: 'borrowed',
      peerId: 'peer',
      send: vi.fn(),
      subscribe: () => () => undefined,
      close
    }
    const wrapper = queue.createIpcSendQueueTransport(physical, gate)
    expect(wrapper.platform).toBe('Memory')
    expect(wrapper.ownership).toBe('borrowed')
    expect(wrapper.peerId).toBe('peer')
    expect(wrapper.closed).toBeUndefined()
    const blocked = deferredWrite()
    const send = gate.run(request('idle'), () => blocked.promise)
    let idle = false
    const whenIdle = gate.whenIdle().then(() => {
      idle = true
    })
    await Promise.resolve()
    expect(idle, '[A6] whenIdle waits for the admitted physical send').toBe(false)
    blocked.release()
    await Promise.all([send, whenIdle])
    expect(idle).toBe(true)
    wrapper.close?.()
    wrapper.close?.()
    expect(close, '[A6] wrapper closes its claimed physical connection once').toHaveBeenCalledTimes(
      1
    )
    expect(wrapper.closed).toBe(true)
    expect(
      () => queue.createIpcSendQueueTransport(physical, gate),
      '[A6] close retires physical occupancy rather than recycling a closed connection'
    ).toThrowError(TypeError)
  })

  it('[A6] closes an installed gate when a borrowed endpoint disposes', async () => {
    const queue = await queueModule()
    expect(queue).not.toBeNull()
    if (!queue) return
    const [physical] = createMemoryTransportPair()
    const installation = queue.createIpcSendQueueFeature({ connectionId: 'a6-gate-close' })
    const wrapper = queue.createIpcSendQueueTransport(physical, installation.gate)
    const endpoint = await createComposedEndpoint(
      {
        id: 'a6-gate-close',
        transport: wrapper,
        middlewares: [connect({ transport: wrapper })],
        features: [installation.feature] as const
      },
      createFirstPartyRoots(new Set(['first-party-outbound']))
    )
    await endpoint.dispose()
    await expect(
      installation.gate.run(request('after-dispose'), () => undefined),
      '[A6] Feature resource closes gate even when kernel borrows the wrapper'
    ).rejects.toMatchObject({ code: 'ENDPOINT_DISPOSED' })
  })

  it('[A6] rolls back first and second Feature installation failures without a frame', async () => {
    const queue = await queueModule()
    const log = await logModule()
    expect(queue && log).toBeTruthy()
    if (!queue || !log) return
    const roots = createFirstPartyRoots(new Set(['first-party-outbound']))
    const [firstPhysical] = createMemoryTransportPair()
    const firstSend = vi.fn()
    const firstTransport: IRpcTransport = { ...firstPhysical, send: firstSend }
    const first = queue.createIpcSendQueueFeature({ connectionId: 'a6-first' })
    const firstWrapper = queue.createIpcSendQueueTransport(firstTransport, first.gate)
    installOutboundGate(firstWrapper, first.gate)
    await expect(
      createComposedEndpoint(
        {
          id: 'a6-first',
          transport: firstWrapper,
          middlewares: [connect({ transport: firstWrapper })],
          features: [first.feature] as const
        },
        roots
      ),
      '[A6] first Feature installation failure preserves INVALID_CONFIG'
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    expect(firstSend).not.toHaveBeenCalled()
    expect(queue.createIpcSendQueueTransport(firstTransport, first.gate)).toBeDefined()

    const [secondPhysical] = createMemoryTransportPair()
    const secondSend = vi.fn()
    const secondTransport: IRpcTransport = { ...secondPhysical, send: secondSend }
    const second = queue.createIpcSendQueueFeature({ connectionId: 'a6-second' })
    const secondWrapper = queue.createIpcSendQueueTransport(secondTransport, second.gate)
    const failure = new Error('log install failed')
    const brokenLog = log.createIpcLogFeature({
      gate: {
        onEvent() {
          throw failure
        }
      } as unknown as Parameters<typeof log.createIpcLogFeature>[0]['gate'],
      report: () => undefined,
      onReportError: () => undefined
    })
    await expect(
      createComposedEndpoint(
        {
          id: 'a6-second',
          transport: secondWrapper,
          middlewares: [connect({ transport: secondWrapper })],
          features: [second.feature, brokenLog.feature] as const
        },
        roots
      ),
      '[A6] second Feature installation failure keeps its original cause'
    ).rejects.toBe(failure)
    expect(secondSend).not.toHaveBeenCalled()
    await expect(second.gate.run(request('after-second'), () => undefined)).rejects.toMatchObject({
      code: 'ENDPOINT_DISPOSED'
    })
    expect(queue.createIpcSendQueueTransport(secondTransport, second.gate)).toBeDefined()

    const [cleanupPhysical] = createMemoryTransportPair()
    const cleanupSend = vi.fn()
    const cleanupTransport: IRpcTransport = { ...cleanupPhysical, send: cleanupSend }
    const cleanupQueue = queue.createIpcSendQueueFeature({ connectionId: 'a6-cleanup' })
    const cleanupWrapper = queue.createIpcSendQueueTransport(cleanupTransport, cleanupQueue.gate)
    const cleanupFailure = new Error('log unsubscribe failed')
    const cleanupLog = log.createIpcLogFeature({
      gate: {
        onEvent() {
          return () => {
            throw cleanupFailure
          }
        }
      } as unknown as Parameters<typeof log.createIpcLogFeature>[0]['gate'],
      report: () => undefined,
      onReportError: () => undefined
    })
    installOutboundGate(cleanupWrapper, cleanupQueue.gate)
    const failed = await createComposedEndpoint(
      {
        id: 'a6-cleanup',
        transport: cleanupWrapper,
        middlewares: [connect({ transport: cleanupWrapper })],
        features: [cleanupLog.feature, cleanupQueue.feature] as const
      },
      roots
    ).then(
      () => undefined,
      (error: unknown) => error
    )
    expect(failed, '[A6] original install failure stays reachable').toMatchObject({
      code: 'INVALID_CONFIG'
    })
    expect(
      (failed as { readonly cleanupErrors?: readonly { readonly error: unknown }[] })
        .cleanupErrors?.[0]?.error,
      '[A6] cleanup failure remains reachable by identity beside the original cause'
    ).toBe(cleanupFailure)
    expect(cleanupSend, '[A6] failing batch sends no physical frame').not.toHaveBeenCalled()
    expect(queue.createIpcSendQueueTransport(cleanupTransport, cleanupQueue.gate)).toBeDefined()
  })

  it('[A7] preserves synchronous ungated sender failure and async gated public rejection', async () => {
    const queue = await queueModule()
    expect(queue, '[A7] send-queue entry must exist').not.toBeNull()
    if (!queue) return
    const failure = new Error('encode')
    const transport: IRpcTransport = {
      platform: 'Memory',
      encodedType: 'string',
      send: vi.fn(),
      subscribe: () => () => undefined
    }
    const pipeline = new RpcOutboundSender(transport, 'client', {
      protocol: { id: 'test', version: 1, normalize: (value: unknown) => value },
      codec: {
        id: 'test',
        version: 1,
        encodedType: 'string',
        encode: () => {
          throw failure
        },
        decode: () => request('x')
      },
      framer: {
        id: 'test',
        version: 1,
        inputEncodedType: 'string',
        outputEncodedType: 'string',
        frame: (value: unknown) => [value],
        accept: () => undefined
      },
      ingressPrepare: () => undefined,
      shadowed: []
    } as never)
    expect(
      () => pipeline.send(request('x')),
      '[A7] ungated sender must throw synchronously'
    ).toThrow()
    const installed = queue.createIpcSendQueueFeature({ connectionId: 'a7' })
    const gatedPipeline = new RpcOutboundSender(
      transport,
      'client',
      pipeline.components,
      undefined,
      transport.platform,
      installed.gate
    )
    const result = gatedPipeline.send(request('x'))
    await expect(result, '[A7] gated send must reject asynchronously').rejects.toMatchObject({
      cause: failure
    })
    expect(transport.send).not.toHaveBeenCalled()
  })
})
