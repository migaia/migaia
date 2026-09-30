import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import { normalizeRpcEnvelope, RpcRouteProfile } from '../../src/contract/index.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { createEndpointKernel } from '../../src/core/endpoint-kernel.js'
import { prepareEndpoint } from '../../src/core/internal/endpoint-bootstrap.js'
import { RpcOutboundAttachment } from '../../src/core/internal/outbound-attachment.js'
import { RpcOutboundSender } from '../../src/core/internal/outbound-sender.js'
import { RpcPortName } from '../../src/core/internal/plugin-shared-keys.js'
import { connect } from '../../src/core/middleware/connect.js'
import { createFirstPartyRoots } from '../../src/core/internal/first-party-roots.js'
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
function request(id: string) {
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
        sentAt: 0
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
    } finally {
      streamKernel.beginClose()
      await streamKernel.resources.releaseAll()
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
    const logging = log.createIpcLogFeature({
      gate: installed.gate,
      report(record) {
        records.push(record)
      },
      onReportError(error) {
        throw error
      }
    })
    expect(logging.feature, '[A5] log must be a native feature').toBeDefined()
    logging.recordStderr({
      name: 'ipc.stderr',
      connectionId: 'a5',
      sessionId: 'session',
      text: 'stderr line'
    })
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

  it('[A6] rejects unmatched gate and feature construction before sending', async () => {
    const queue = await queueModule()
    expect(queue, '[A6] send-queue entry must exist').not.toBeNull()
    if (!queue) return
    const [transport] = createMemoryTransportPair()
    const installed = queue.createIpcSendQueueFeature({ connectionId: 'a6' })
    const wrapped = queue.createIpcSendQueueTransport(transport, installed.gate)
    await expect(
      createComposedEndpoint(
        { id: 'a6', transport: wrapped, middlewares: [connect({ transport: wrapped })] },
        createFirstPartyRoots(new Set(['first-party-outbound']))
      )
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
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
