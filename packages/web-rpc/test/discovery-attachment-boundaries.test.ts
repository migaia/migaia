import { describe, expect, it, vi } from 'vitest'
import { createMemoryTransportPair } from '../src/adapters/memory.js'
import { createEndpointKernel } from '../src/endpoint-kernel.js'
import { WebRpcError, WebRpcLifecycleError } from '../src/errors.js'
import { WebRpcMessageKind, WebRpcPlatform } from '../src/protocol-constants.js'
import { WebRpcDiscoveryAttachment } from '../src/internal/discovery-attachment.js'
import { WebRpcOutboundAttachment } from '../src/internal/outbound-attachment.js'
import type {
  IWebRpcDiscoveryCandidate,
  IWebRpcInboundDiscoveryQuery,
  IWebRpcServerMetadata
} from '../src/typing.js'
import type {
  IWebRpcOutboundCommand,
  IWebRpcOutboundOperationsPort
} from '../src/internal/plugin-shared-keys.js'

type IDiscoveryHarness = {
  readonly attachment: WebRpcDiscoveryAttachment<string>
  readonly outbound: WebRpcOutboundAttachment
  readonly kernel: ReturnType<typeof createEndpointKernel>
  readonly commands: IWebRpcOutboundCommand[]
  readonly identityTrace: IIdentityTrace
  readonly admitPeer: (senderId: string, targetId: string, data?: unknown) => Promise<string>
  readonly peerTransport: ReturnType<typeof createMemoryTransportPair>[1]
  readonly dispose: () => Promise<void>
}

/** Records routed inbound-identity operations and their externally visible lease balance. */
type IIdentityTrace = {
  acceptedAdmits: number
  rejectedAdmits: number
  retains: number
  releases: number
}

type IReceiverSelector = (
  servers: readonly IWebRpcServerMetadata<string>[]
) => string | undefined | Promise<string | undefined>

/** Creates a direct attachment harness with real kernel and outbound identity owners. */
function createDiscoveryHarness(
  mode: 'automatic' | 'manual' = 'manual',
  uniqueTargetId?: string,
  receiverSelector?: IReceiverSelector,
  platform?: typeof WebRpcPlatform.broadcastChannel,
  topology?: 'exclusive' | 'multiplexed' | 'broadcast',
  verifyPeer?: (senderId: string, targetId: string) => boolean | Promise<boolean>
): IDiscoveryHarness {
  const [transport, peerTransport] = createMemoryTransportPair()
  if (platform !== undefined)
    Object.defineProperty(transport, 'platform', { configurable: true, value: platform })
  if (topology !== undefined)
    Object.defineProperty(transport, 'topology', { configurable: true, value: topology })
  const kernel = createEndpointKernel(transport)
  const prepared = {
    id: `coverage-direct-${mode}`,
    transport,
    options: {
      connect: {
        discoveryMode: mode,
        ...(uniqueTargetId ? { uniqueTargetId } : {}),
        ...(receiverSelector ? { receiverSelector } : {}),
        ...(verifyPeer
          ? {
              verify: ({
                senderId,
                targetId
              }: {
                readonly senderId: string
                readonly targetId: string
              }) => verifyPeer(senderId, targetId)
            }
          : {})
      }
    }
  } as never
  const outbound = new WebRpcOutboundAttachment(kernel, prepared)
  const commands: IWebRpcOutboundCommand[] = []
  const identityTrace: IIdentityTrace = {
    acceptedAdmits: 0,
    rejectedAdmits: 0,
    retains: 0,
    releases: 0
  }
  const operations: IWebRpcOutboundOperationsPort = {
    send: ((command) => {
      commands.push(command)
      if (command.kind === 'frame' || command.kind === 'response') return Promise.resolve()
    }) as IWebRpcOutboundOperationsPort['send']
  }
  const attachment = new WebRpcDiscoveryAttachment(kernel, prepared, {
    inboundIdentity: {
      verify: (command) => {
        if (command.operation === 'admit') {
          return outbound.inboundIdentity.admit(command.request).then((admission) => {
            if (admission === undefined) {
              identityTrace.rejectedAdmits += 1
              return undefined
            }
            identityTrace.acceptedAdmits += 1
            return {
              token: admission.token,
              release: () => {
                identityTrace.releases += 1
                admission.release()
              }
            }
          })
        }
        if (command.operation === 'retain') {
          const retained = outbound.inboundIdentity.retain(command.token)
          if (retained) identityTrace.retains += 1
          return retained
        }
        outbound.inboundIdentity.release(command.token)
        identityTrace.releases += 1
        return undefined
      }
    },
    outboundOperations: operations,
    time: kernel.time,
    candidatePing: async () => true
  })
  outbound.activate()
  return {
    attachment,
    outbound,
    kernel,
    commands,
    identityTrace,
    peerTransport,
    admitPeer: async (senderId, targetId, data = undefined) => {
      const admission = await outbound.inboundIdentity.admit({ senderId, targetId, data })
      if (!admission) throw new Error('coverage harness could not admit peer')
      admission.release()
      return admission.token
    },
    dispose: async () => {
      attachment.dispose()
      expect(() => attachment.dispose()).not.toThrow()
      const outboundDispose = outbound.dispose()
      expect(outbound.dispose()).toBe(outboundDispose)
      await outboundDispose
      await kernel.resources.releaseAll()
      kernel.completeDispose()
    }
  }
}

/** Drains the memory transport and endpoint receive microtasks without using timer sleeps. */
async function flushTransport(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

/** Returns the routed identity trace with accepted leases reduced to a net balance. */
function identitySnapshot(harness: IDiscoveryHarness) {
  const { acceptedAdmits, rejectedAdmits, retains, releases } = harness.identityTrace
  return {
    acceptedAdmits,
    rejectedAdmits,
    retains,
    releases,
    balance: acceptedAdmits + retains - releases
  }
}

/** Returns the task ID from the most recent discovery frame sent by a harness. */
function latestTaskId(commands: readonly IWebRpcOutboundCommand[]): string {
  const frame = [...commands]
    .reverse()
    .find(
      (
        command
      ): command is Extract<IWebRpcOutboundCommand, { readonly kind: 'response' | 'frame' }> =>
        command.kind === 'frame' || command.kind === 'response'
    )
  const taskId = (frame?.message as { readonly taskId?: unknown } | undefined)?.taskId
  if (typeof taskId !== 'string') throw new Error('coverage harness did not capture a task ID')
  return taskId
}

/** Returns one discovery task ID for a target from the direct outbound command trace. */
function taskIdForTarget(commands: readonly IWebRpcOutboundCommand[], targetId: string): string {
  const frame = [...commands]
    .reverse()
    .find(
      (
        command
      ): command is Extract<IWebRpcOutboundCommand, { readonly kind: 'response' | 'frame' }> =>
        command.kind === 'frame' &&
        (command.message as { readonly kind?: unknown }).kind ===
          WebRpcMessageKind.discoveryQuery &&
        (command.message as { readonly targetId?: unknown }).targetId === targetId
    )
  const taskId = (frame?.message as { readonly taskId?: unknown } | undefined)?.taskId
  if (typeof taskId !== 'string')
    throw new Error(`coverage harness did not capture task ID for ${targetId}`)
  return taskId
}

/** Combines outbound and discovery owner projections for one observable transaction. */
function combinedSnapshot(harness: IDiscoveryHarness) {
  return {
    outbound: harness.outbound.debugSnapshot(),
    attachment: harness.attachment.debugSnapshot()
  }
}

/** Proves an invalid frame did not mutate any admitted owner or pending state. */
function expectUnchangedSnapshot(
  before: ReturnType<typeof combinedSnapshot>,
  after: ReturnType<typeof combinedSnapshot>
): void {
  expect(after).toEqual(before)
}

/** Proves canonical disposal drained all direct attachment and kernel-owned state. */
function expectTerminalZero(snapshot: ReturnType<typeof combinedSnapshot>): void {
  expect(snapshot.outbound).toMatchObject({
    phase: 'disposed',
    pending: 0,
    activeControllers: 0,
    chunks: 0,
    providers: 0,
    resources: 0,
    owners: []
  })
  expect(snapshot.outbound.discovery).toEqual({
    local: 0,
    remote: 0,
    waiters: 0,
    tasks: 0,
    timers: 0,
    manualWaiters: 0,
    inboundQueries: 0,
    inboundTimers: 0
  })
  expect(snapshot.attachment).toEqual({
    local: 0,
    remote: 0,
    waiters: 0,
    tasks: 0,
    timers: 0,
    manualWaiters: 0,
    inboundQueries: 0,
    inboundTimers: 0
  })
}

/** Builds a candidate-shaped value without the registry proof attached to real candidates. */
function forgedCandidate(): IWebRpcDiscoveryCandidate<string> {
  return {
    queryId: 'forged-query',
    targetId: 'forged-target',
    receiverId: 'forged-receiver',
    data: undefined,
    platform: 'Memory'
  }
}

describe('discovery attachment boundary semantics', () => {
  it('covers direct automatic query response, receiver binding, selector fallback, and local ownership', async () => {
    const harness = createDiscoveryHarness('automatic', 'unique-direct')
    const targetId = 'direct-remote'
    try {
      const pending = harness.attachment.query(targetId)
      const joined = harness.attachment.discoverTargetIfNeeded(targetId, 2000)
      expect(harness.commands).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'frame' })])
      )
      const taskId = latestTaskId(harness.commands)
      const verifiedPeerKey = await harness.admitPeer('direct-peer', 'coverage-direct-automatic', {
        __unique_id__: 'unique-direct'
      })
      await harness.attachment.handleInboundDiscovery(
        {
          kind: WebRpcMessageKind.discoveryResponse,
          taskId,
          senderId: 'direct-peer',
          targetId: 'coverage-direct-automatic',
          resolvedTargetId: targetId,
          receiverId: 'direct-receiver',
          data: { __unique_id__: 'unique-direct' },
          sentAt: Date.now()
        },
        verifiedPeerKey
      )
      await expect(pending).resolves.toBeUndefined()
      await expect(joined).resolves.toBeUndefined()
      expect(harness.attachment.controls.getServerList(targetId)).toEqual([
        expect.objectContaining({
          targetId,
          receiverId: 'direct-receiver',
          uniqueTargetId: 'unique-direct',
          status: 'active'
        })
      ])
      expect(harness.attachment.ownsReceiver(targetId, 'direct-receiver')).toBe(false)
      expect(harness.attachment.receiverForTarget(targetId)).toEqual({})
      harness.attachment.controls.pinReceiver(targetId, 'direct-receiver')
      expect(harness.attachment.receiverForTarget(targetId)).toEqual({
        receiverId: 'direct-receiver',
        verifiedPeerKey
      })
      await expect(harness.attachment.receiverForOperation(targetId, 'send', 100)).resolves.toEqual(
        { receiverId: 'direct-receiver', verifiedPeerKey }
      )
      harness.attachment.touchRemoteReceiver(targetId, 'direct-receiver')
      expect(harness.attachment.getRemoteBinding(targetId, 'direct-receiver')).toBe(verifiedPeerKey)
      expect(harness.attachment.getPinnedReceiver(targetId)).toBe('direct-receiver')
      expect(harness.attachment.receiverCount(targetId)).toBe(1)
      expect(harness.attachment.canAdmitWaiter(targetId)).toBe(true)
      expect(harness.attachment.hasCompletedTask('unknown-task')).toBe(false)
      harness.attachment.controls.unpinReceiver(targetId)
      expect(harness.attachment.getPinnedReceiver(targetId)).toBeUndefined()
      harness.attachment.controls.unpinReceiver('missing-target')
      await expect(
        harness.attachment.discoverTargetIfNeeded(targetId, 100)
      ).resolves.toBeUndefined()
      await expect(harness.attachment.resolveReceiver(targetId)).resolves.toEqual({
        receiverId: 'direct-receiver',
        verifiedPeerKey
      })
      const localReceiver = harness.attachment.ensureLocalReceiver('local-target')
      expect(harness.attachment.ownsReceiver('local-target', localReceiver)).toBe(true)
      expect(harness.attachment.ensureLocalReceiver('local-target')).toBe(localReceiver)
      expect(
        harness.attachment.localReceiverSnapshot<IWebRpcServerMetadata<string>>()
      ).toHaveLength(1)
      expect(harness.attachment.nextReceiverId()).toBe(1)
      harness.attachment.purgeAdmissions(Date.now() + 1)
      harness.attachment.clearAdmissions()
    } finally {
      await harness.dispose()
    }
  })

  it('covers receiver selector fallback, valid selection, and unavailable selection', async () => {
    const selectors: readonly IReceiverSelector[] = [
      () => undefined,
      (servers) => servers[0]?.receiverId,
      () => 'missing-receiver',
      () => new Promise<string | undefined>(() => undefined)
    ]
    for (const [index, selector] of selectors.entries()) {
      const harness = createDiscoveryHarness('automatic', undefined, selector)
      const targetId = `selector-target-${index}`
      try {
        const pending = harness.attachment.query(targetId)
        const taskId = latestTaskId(harness.commands)
        const verifiedPeerKey = await harness.admitPeer(
          `selector-peer-${index}`,
          'coverage-direct-automatic'
        )
        await harness.attachment.handleInboundDiscovery(
          {
            kind: WebRpcMessageKind.discoveryResponse,
            taskId,
            senderId: `selector-peer-${index}`,
            targetId: 'coverage-direct-automatic',
            resolvedTargetId: targetId,
            receiverId: `selector-receiver-${index}`,
            sentAt: Date.now()
          },
          verifiedPeerKey
        )
        await expect(pending).resolves.toBeUndefined()
        if (index === 0)
          await expect(
            harness.attachment.receiverForOperation(targetId, 'select', 100)
          ).resolves.toEqual({})
        else if (index === 1)
          await expect(
            harness.attachment.receiverForOperation(targetId, 'select', 100)
          ).resolves.toEqual({
            receiverId: `selector-receiver-${index}`,
            verifiedPeerKey
          })
        else if (index === 2)
          await expect(
            harness.attachment.receiverForOperation(targetId, 'select', 100)
          ).rejects.toMatchObject({ code: 'TARGET_UNKNOWN' })
        else
          await expect(
            harness.attachment.receiverForOperation(targetId, 'select', 1)
          ).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
      } finally {
        await harness.dispose()
      }
    }
  })

  it('fails closed for malformed automatic responses before settling a valid waiter', async () => {
    const harness = createDiscoveryHarness('automatic')
    const targetId = 'automatic-guard-target'
    try {
      const pending = harness.attachment.query(targetId)
      const taskId = latestTaskId(harness.commands)
      const verifiedPeerKey = await harness.admitPeer(
        'automatic-guard-peer',
        'coverage-direct-automatic'
      )
      const base = {
        kind: WebRpcMessageKind.discoveryResponse,
        taskId,
        senderId: 'automatic-guard-peer',
        targetId: 'coverage-direct-automatic',
        resolvedTargetId: targetId,
        receiverId: 'automatic-guard-receiver',
        sentAt: Date.now()
      } as const
      await harness.attachment.handleInboundDiscovery(
        { ...base, targetId: 'wrong-target' },
        verifiedPeerKey
      )
      await harness.attachment.handleInboundDiscovery(
        { ...base, resolvedTargetId: 'wrong-resolved-target' },
        verifiedPeerKey
      )
      await harness.attachment.handleInboundDiscovery(
        { ...base, receiverId: undefined } as never,
        verifiedPeerKey
      )
      await harness.attachment.handleInboundDiscovery({ ...base, receiverId: '' }, verifiedPeerKey)
      await harness.attachment.handleInboundDiscovery(
        { ...base, data: { __unique_id__: 42 } },
        verifiedPeerKey
      )
      await harness.attachment.handleInboundDiscovery(
        { ...base, data: { __unique_id__: '' } },
        verifiedPeerKey
      )
      await harness.attachment.handleInboundDiscovery(base, verifiedPeerKey)
      await expect(pending).resolves.toBeUndefined()
      expect(harness.attachment.getServerList(targetId)).toEqual([
        expect.objectContaining({ receiverId: 'automatic-guard-receiver', status: 'active' })
      ])
    } finally {
      await harness.dispose()
    }
  })

  it('covers transport-routed query replay and response settlement for automatic and manual modes', async () => {
    const automatic = createDiscoveryHarness('automatic', 'route-unique')
    const manual = createDiscoveryHarness('manual', 'route-manual-unique')
    const removeListener = manual.attachment.controls.onQuery!(async (query) => {
      await query.reject('route-rejected')
    })
    const flushTransport = async (): Promise<void> => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    try {
      const routedQuery = {
        kind: WebRpcMessageKind.discoveryQuery,
        taskId: 'routed-automatic-query',
        senderId: 'routed-peer',
        targetId: 'coverage-direct-automatic',
        sentAt: Date.now()
      }
      await automatic.peerTransport.send(routedQuery)
      await flushTransport()
      expect(automatic.commands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'frame',
            message: expect.objectContaining({
              kind: WebRpcMessageKind.discoveryResponse,
              taskId: routedQuery.taskId,
              targetId: routedQuery.senderId
            })
          })
        ])
      )
      await automatic.peerTransport.send(routedQuery)
      await flushTransport()

      const pending = automatic.attachment.query('routed-response-target')
      const taskId = latestTaskId(automatic.commands)
      await automatic.peerTransport.send({
        kind: WebRpcMessageKind.discoveryResponse,
        taskId,
        senderId: 'routed-response-peer',
        targetId: 'coverage-direct-automatic',
        resolvedTargetId: 'routed-response-target',
        receiverId: 'routed-response-receiver',
        sentAt: Date.now()
      })
      await expect(pending).resolves.toBeUndefined()

      await manual.peerTransport.send({
        kind: WebRpcMessageKind.discoveryQuery,
        taskId: 'routed-manual-query',
        senderId: 'routed-manual-peer',
        targetId: 'coverage-direct-manual',
        sentAt: Date.now(),
        manual: true,
        data: { request: true, __unique_id__: 'hidden' }
      })
      await flushTransport()
      expect(manual.commands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'frame',
            message: expect.objectContaining({
              kind: WebRpcMessageKind.discoveryResponse,
              accepted: false,
              message: 'route-rejected'
            })
          })
        ])
      )
    } finally {
      removeListener()
      await automatic.dispose()
      await manual.dispose()
    }
  })

  it('covers BroadcastChannel identity checks and stale pinned receiver failure', async () => {
    vi.useFakeTimers()
    const harness = createDiscoveryHarness(
      'automatic',
      undefined,
      undefined,
      WebRpcPlatform.broadcastChannel
    )
    const staleHarness = createDiscoveryHarness('automatic')
    const targetId = 'broadcast-target'
    try {
      const pending = harness.attachment.query(targetId)
      const taskId = latestTaskId(harness.commands)
      const verifiedPeerKey = await harness.admitPeer('broadcast-peer', 'coverage-direct-automatic')
      const response = {
        kind: WebRpcMessageKind.discoveryResponse,
        taskId,
        senderId: 'broadcast-peer',
        targetId: 'coverage-direct-automatic',
        resolvedTargetId: targetId,
        receiverId: targetId,
        sentAt: Date.now()
      } as const
      await harness.attachment.handleInboundDiscovery(response, verifiedPeerKey)
      await expect(pending).resolves.toBeUndefined()
      expect(() => harness.attachment.controls.pinReceiver(targetId, targetId)).toThrowError(
        WebRpcError
      )
      await harness.attachment.handleInboundDiscovery(response, verifiedPeerKey)
      expect(harness.commands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'diagnostic',
            event: expect.objectContaining({ code: 'MULTIPLE_RECEIVERS' })
          })
        ])
      )

      harness.attachment.touchRemoteReceiver('missing-target', 'missing-receiver')
      harness.attachment.diagnoseMultipleReceivers(targetId)

      const staleTargetId = 'stale-target'
      const stalePending = staleHarness.attachment.query(staleTargetId)
      const staleTaskId = latestTaskId(staleHarness.commands)
      const stalePeerKey = await staleHarness.admitPeer('stale-peer', 'coverage-direct-automatic')
      await staleHarness.attachment.handleInboundDiscovery(
        {
          kind: WebRpcMessageKind.discoveryResponse,
          taskId: staleTaskId,
          senderId: 'stale-peer',
          targetId: 'coverage-direct-automatic',
          resolvedTargetId: staleTargetId,
          receiverId: 'stale-receiver',
          sentAt: Date.now()
        },
        stalePeerKey
      )
      await stalePending
      staleHarness.attachment.controls.pinReceiver(staleTargetId, 'stale-receiver')
      vi.setSystemTime(Date.now() + 300_001)
      expect(staleHarness.attachment.getServerList(staleTargetId)[0]?.status).toBe('stale')
      expect(() => staleHarness.attachment.receiverForTarget(staleTargetId)).toThrowError(
        WebRpcError
      )
    } finally {
      await harness.dispose()
      await staleHarness.dispose()
      vi.useRealTimers()
    }
  })

  it('covers manual inbound accept/reject, replay, collision, and listener failure reporting', async () => {
    const harness = createDiscoveryHarness('manual', 'unique-manual')
    const query = {
      kind: WebRpcMessageKind.discoveryQuery,
      taskId: 'manual-direct-query',
      senderId: 'manual-peer',
      targetId: 'coverage-direct-manual',
      sentAt: Date.now(),
      manual: true,
      data: { value: 1, __unique_id__: 'hidden' }
    } as const
    let inbound: IWebRpcInboundDiscoveryQuery<string> | undefined
    expect(() => harness.attachment.controls.onQuery!(undefined as never)).toThrowError(WebRpcError)
    const removeListener = harness.attachment.controls.onQuery!((value) => {
      inbound = value
    })
    try {
      const verifiedPeerKey = await harness.admitPeer('manual-peer', 'coverage-direct-manual')
      await harness.attachment.handleInboundDiscovery(query, verifiedPeerKey, {
        origin: 'test',
        data: undefined
      } as never)
      await Promise.resolve()
      expect(inbound).toBeDefined()
      expect(inbound!.data).toEqual({ value: 1 })
      await expect(inbound!.accept({ answer: 2, __unique_id__: 'hidden' })).resolves.toBe(true)
      await expect(inbound!.accept({ answer: 3 })).resolves.toBe(false)
      expect(harness.commands.some((command) => command.kind === 'frame')).toBe(true)
      await harness.attachment.handleInboundDiscovery(query, verifiedPeerKey)
      expect(harness.commands.some((command) => command.kind === 'diagnostic')).toBe(true)

      const collisionQuery = { ...query, taskId: 'manual-collision-query' }
      const collisionPeerKey = await harness.admitPeer('manual-peer-2', 'coverage-direct-manual')
      await harness.attachment.handleInboundDiscovery(collisionQuery, collisionPeerKey)
      await harness.attachment.handleInboundDiscovery(collisionQuery, collisionPeerKey)
      const diagnosticCodes = harness.commands
        .filter(
          (command): command is Extract<IWebRpcOutboundCommand, { readonly kind: 'diagnostic' }> =>
            command.kind === 'diagnostic'
        )
        .map((command) => command.event.code)
      expect(diagnosticCodes).toContain('MANUAL_QUERY_REPLAY')

      const rejectedQuery = { ...query, taskId: 'manual-rejected-query' }
      let rejectHandle: IWebRpcInboundDiscoveryQuery<string> | undefined
      removeListener()
      const removeRejectListener = harness.attachment.controls.onQuery!((value) => {
        rejectHandle = value
      })
      const rejectedPeerKey = await harness.admitPeer('manual-peer-3', 'coverage-direct-manual')
      await harness.attachment.handleInboundDiscovery(rejectedQuery, rejectedPeerKey)
      await Promise.resolve()
      await expect(rejectHandle?.reject('not-ready')).resolves.toBe(true)
      expect(harness.commands.some((command) => command.kind === 'frame')).toBe(true)
      removeRejectListener()

      const invalidReasonQuery = { ...query, taskId: 'manual-invalid-reason-query' }
      const removeInvalidReasonListener = harness.attachment.controls.onQuery!((value) => {
        void value.reject(42 as never).catch(() => undefined)
      })
      await harness.attachment.handleInboundDiscovery(invalidReasonQuery, rejectedPeerKey)
      await Promise.resolve()
      expect(harness.commands.some((command) => command.kind === 'diagnostic')).toBe(true)
      removeInvalidReasonListener()

      await harness.attachment.handleInboundDiscovery(
        { ...query, taskId: 'manual-no-listener-query' },
        rejectedPeerKey
      )
    } finally {
      removeListener()
      await harness.dispose()
    }
  })

  it('covers manual response candidate admission, registration, pin loss, and invalid response guards', async () => {
    const harness = createDiscoveryHarness('manual')
    let invalidPending: Promise<readonly IWebRpcDiscoveryCandidate<string>[]> | undefined
    try {
      const pending = harness.attachment.controls.query!('manual-response-target', {
        timeoutMs: 1000
      })
      await Promise.resolve()
      expect(harness.commands).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'frame' })])
      )
      const taskId = latestTaskId(harness.commands)
      await harness.attachment.handleInboundDiscovery(
        {
          kind: WebRpcMessageKind.discoveryResponse,
          taskId,
          senderId: 'manual-response-peer',
          targetId: 'coverage-direct-manual',
          resolvedTargetId: 'manual-response-target',
          sentAt: Date.now(),
          manual: true,
          accepted: true,
          receiverId: 'manual-response-receiver',
          data: { answer: 1 }
        },
        await harness.admitPeer('manual-response-peer', 'coverage-direct-manual')
      )
      const candidates = await pending
      expect(candidates).toHaveLength(1)
      const candidate = candidates[0]!
      expect(() => harness.attachment.controls.register!(candidate)).not.toThrow()
      expect(() => harness.attachment.controls.register!(candidate)).toThrowError(WebRpcError)
      harness.attachment.controls.pinReceiver('manual-response-target', 'manual-response-receiver')
      await harness.attachment.controls.unregister!('manual-response-target')
      expect(harness.attachment.getPinnedReceiver('manual-response-target')).toBe(
        'manual-response-receiver'
      )
      expect(() => harness.attachment.receiverForTarget('manual-response-target')).toThrowError(
        WebRpcError
      )
      harness.attachment.controls.unpinReceiver('manual-response-target')
      expect(harness.attachment.getPinnedReceiver('manual-response-target')).toBeUndefined()
      expect(() => harness.attachment.controls.register!(candidate)).toThrowError(WebRpcError)

      invalidPending = harness.attachment.controls.query!('invalid-response-target', {
        timeoutMs: 1000
      })
      await Promise.resolve()
      const invalidTaskId = latestTaskId(harness.commands)
      const invalidPeerKey = await harness.admitPeer(
        'manual-response-peer',
        'coverage-direct-manual'
      )
      await harness.attachment.handleInboundDiscovery(
        {
          kind: WebRpcMessageKind.discoveryResponse,
          taskId: invalidTaskId,
          senderId: 'manual-response-peer',
          targetId: 'coverage-direct-manual',
          resolvedTargetId: 'invalid-response-target',
          sentAt: Date.now(),
          manual: true,
          accepted: true,
          receiverId: ''
        },
        invalidPeerKey
      )
      await harness.attachment.handleInboundDiscovery(
        {
          kind: WebRpcMessageKind.discoveryResponse,
          taskId: invalidTaskId,
          senderId: 'manual-response-peer',
          targetId: 'coverage-direct-manual',
          resolvedTargetId: 'invalid-response-target',
          sentAt: Date.now(),
          manual: true,
          accepted: true,
          receiverId: 'valid-receiver'
        },
        invalidPeerKey
      )
      await harness.attachment.handleInboundDiscovery(
        {
          kind: WebRpcMessageKind.discoveryResponse,
          taskId: invalidTaskId,
          senderId: 'manual-response-peer',
          targetId: 'coverage-direct-manual',
          resolvedTargetId: 'invalid-response-target',
          sentAt: Date.now(),
          manual: true,
          accepted: true,
          receiverId: 'valid-receiver'
        },
        invalidPeerKey
      )
      for (let index = 0; index < 33; index += 1)
        await harness.attachment.handleInboundDiscovery(
          {
            kind: WebRpcMessageKind.discoveryResponse,
            taskId: invalidTaskId,
            senderId: 'manual-response-peer',
            targetId: 'coverage-direct-manual',
            resolvedTargetId: 'invalid-response-target',
            sentAt: Date.now(),
            manual: true,
            accepted: true,
            receiverId: `valid-receiver-${index}`
          },
          invalidPeerKey
        )
      await harness.attachment.handleInboundDiscovery(
        {
          kind: WebRpcMessageKind.discoveryResponse,
          taskId: invalidTaskId,
          senderId: 'manual-response-peer',
          targetId: 'coverage-direct-manual',
          resolvedTargetId: 'invalid-response-target',
          sentAt: Date.now(),
          manual: true,
          accepted: false
        },
        invalidPeerKey
      )
      await harness.attachment.handleInboundDiscovery(
        {
          kind: WebRpcMessageKind.discoveryResponse,
          taskId: invalidTaskId,
          senderId: 'manual-response-peer',
          targetId: 'coverage-direct-manual',
          resolvedTargetId: 'invalid-response-target',
          sentAt: Date.now(),
          manual: true,
          accepted: true,
          receiverId: 'valid-receiver',
          data: { __unique_id__: 42 }
        },
        invalidPeerKey
      )
      await harness.attachment.handleInboundDiscovery(
        {
          kind: WebRpcMessageKind.discoveryResponse,
          taskId: invalidTaskId,
          senderId: 'manual-response-peer',
          targetId: 'wrong-target',
          resolvedTargetId: 'invalid-response-target',
          sentAt: Date.now(),
          manual: true,
          accepted: true,
          receiverId: 'valid-receiver'
        },
        invalidPeerKey
      )
      expect(harness.attachment.debugSnapshot().manualWaiters).toBe(1)
    } finally {
      await harness.dispose()
      if (invalidPending)
        await invalidPending.catch((error: unknown) => {
          expect(error).toMatchObject({ code: 'ENDPOINT_DISPOSED' })
        })
    }
  })

  it('keeps foreign, source-less, and late automatic responses isolated', async () => {
    const harness = createDiscoveryHarness('automatic')
    const targetId = 'semantic-isolation-target'
    try {
      const pending = harness.attachment.query(targetId)
      const taskId = latestTaskId(harness.commands)
      const verifiedPeerKey = await harness.admitPeer('semantic-peer', 'coverage-direct-automatic')
      const response = {
        kind: WebRpcMessageKind.discoveryResponse,
        taskId,
        senderId: 'semantic-peer',
        targetId: 'coverage-direct-automatic',
        resolvedTargetId: targetId,
        receiverId: 'semantic-receiver',
        sentAt: Date.now()
      } as const
      await harness.attachment.handleInboundDiscovery(
        { ...response, targetId: 'foreign-endpoint' },
        verifiedPeerKey
      )
      await harness.attachment.handleInboundDiscovery(
        { ...response, resolvedTargetId: 'foreign-target' },
        verifiedPeerKey
      )
      await harness.attachment.handleInboundDiscovery(
        { ...response, receiverId: undefined } as never,
        verifiedPeerKey
      )
      await harness.attachment.handleInboundDiscovery(response, verifiedPeerKey)
      await expect(pending).resolves.toBeUndefined()
      await harness.attachment.handleInboundDiscovery(response, verifiedPeerKey)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(harness.attachment.getServerList(targetId)).toEqual([
        expect.objectContaining({ receiverId: 'semantic-receiver', status: 'active' })
      ])
      await harness.dispose()
      expect(harness.attachment.debugSnapshot()).toMatchObject({ waiters: 0, tasks: 0, timers: 0 })
    } finally {
      await harness.dispose()
    }
  })

  it('does not settle an aborted manual waiter when a late response arrives', async () => {
    const harness = createDiscoveryHarness('manual')
    const controller = new AbortController()
    try {
      const pending = harness.attachment.controls.query!('semantic-abort-target', {
        signal: controller.signal
      })
      await Promise.resolve()
      const taskId = latestTaskId(harness.commands)
      controller.abort()
      await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
      const verifiedPeerKey = await harness.admitPeer(
        'semantic-abort-peer',
        'coverage-direct-manual'
      )
      await harness.attachment.handleInboundDiscovery(
        {
          kind: WebRpcMessageKind.discoveryResponse,
          taskId,
          senderId: 'semantic-abort-peer',
          targetId: 'coverage-direct-manual',
          resolvedTargetId: 'semantic-abort-target',
          receiverId: 'late-receiver',
          sentAt: Date.now(),
          manual: true,
          accepted: true
        },
        verifiedPeerKey
      )
      expect(harness.attachment.debugSnapshot()).toMatchObject({ manualWaiters: 0 })
      expect(harness.attachment.getServerList('semantic-abort-target')).toEqual([])
    } finally {
      await harness.dispose()
    }
  })

  it('expires inbound manual queries and reports listener failures without residue', async () => {
    vi.useFakeTimers()
    const harness = createDiscoveryHarness('manual')
    const listenerError = new Error('semantic listener failure')
    const removeListener = harness.attachment.controls.onQuery!(() => {
      throw listenerError
    })
    const query = {
      kind: WebRpcMessageKind.discoveryQuery,
      taskId: 'semantic-expiring-query',
      senderId: 'semantic-expiring-peer',
      targetId: 'coverage-direct-manual',
      sentAt: Date.now(),
      manual: true,
      data: { value: 'expiry', __unique_id__: 'semantic-unique' }
    } as const
    try {
      const verifiedPeerKey = await harness.admitPeer(
        'semantic-expiring-peer',
        'coverage-direct-manual'
      )
      await harness.attachment.handleInboundDiscovery(query, verifiedPeerKey)
      await Promise.resolve()
      expect(harness.commands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'diagnostic',
            event: expect.objectContaining({ code: 'INTERNAL' })
          })
        ])
      )
      await vi.advanceTimersByTimeAsync(harness.attachment.limits.manualInboundQueryTtlMs)
      expect(harness.attachment.debugSnapshot()).toMatchObject({
        inboundQueries: 0,
        inboundTimers: 0
      })
      await harness.attachment.handleInboundDiscovery(
        {
          kind: WebRpcMessageKind.discoveryResponse,
          taskId: query.taskId,
          senderId: query.senderId,
          targetId: query.targetId,
          resolvedTargetId: query.targetId,
          receiverId: 'semantic-expiring-receiver',
          sentAt: query.sentAt,
          manual: true,
          operation: 'unregister'
        } as never,
        verifiedPeerKey
      )
      expect(harness.commands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'diagnostic',
            event: expect.objectContaining({ code: 'UNAUTHORIZED_MANUAL_UNREGISTER' })
          })
        ])
      )
    } finally {
      removeListener()
      await harness.dispose()
      vi.useRealTimers()
    }
  })

  it('keeps multiple manual receivers independently selectable and observable', async () => {
    const harness = createDiscoveryHarness('manual')
    try {
      const pending = harness.attachment.controls.query!('semantic-multi-target')
      await Promise.resolve()
      const taskId = latestTaskId(harness.commands)
      const verifiedPeerKey = await harness.admitPeer(
        'semantic-multi-peer',
        'coverage-direct-manual'
      )
      for (const receiverId of ['semantic-receiver-a', 'semantic-receiver-b'])
        await harness.attachment.handleInboundDiscovery(
          {
            kind: WebRpcMessageKind.discoveryResponse,
            taskId,
            senderId: 'semantic-multi-peer',
            targetId: 'coverage-direct-manual',
            resolvedTargetId: 'semantic-multi-target',
            receiverId,
            sentAt: Date.now(),
            manual: true,
            accepted: true,
            data: { receiverId }
          },
          verifiedPeerKey
        )
      const candidates = await pending
      expect(candidates.map(({ receiverId }) => receiverId)).toEqual([
        'semantic-receiver-a',
        'semantic-receiver-b'
      ])
      for (const candidate of candidates) harness.attachment.controls.register!(candidate)
      expect(harness.attachment.receiverCount('semantic-multi-target')).toBe(2)
      expect(harness.commands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'diagnostic',
            event: expect.objectContaining({ code: 'MULTIPLE_RECEIVERS' })
          })
        ])
      )
      harness.attachment.controls.pinReceiver('semantic-multi-target', 'semantic-receiver-b')
      expect(harness.attachment.receiverForTarget('semantic-multi-target')).toMatchObject({
        receiverId: 'semantic-receiver-b',
        verifiedPeerKey
      })
      await harness.attachment.controls.unregister!('semantic-multi-target', 'semantic-receiver-b')
      expect(harness.attachment.receiverCount('semantic-multi-target')).toBe(1)
    } finally {
      await harness.dispose()
    }
  })

  it('covers automatic replay, shared waiter deadline extension, and manual query replay', async () => {
    vi.useFakeTimers()
    const automatic = createDiscoveryHarness('automatic')
    const multiplexed = createDiscoveryHarness(
      'automatic',
      undefined,
      undefined,
      undefined,
      'multiplexed'
    )
    const manual = createDiscoveryHarness('manual')
    const removeListener = manual.attachment.controls.onQuery!(() => undefined)
    try {
      const verifiedPeerKey = await automatic.admitPeer(
        'semantic-replay-peer',
        'coverage-direct-automatic'
      )
      const query = {
        kind: WebRpcMessageKind.discoveryQuery,
        taskId: 'semantic-replay-query',
        senderId: 'semantic-replay-peer',
        targetId: 'coverage-direct-automatic',
        sentAt: Date.now()
      } as const
      await automatic.attachment.handleInboundDiscovery(query, verifiedPeerKey)
      await automatic.attachment.handleInboundDiscovery(query, verifiedPeerKey)
      expect(automatic.commands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'diagnostic',
            event: expect.objectContaining({ code: 'DISCOVERY_QUERY_REPLAY' })
          })
        ])
      )

      const first = automatic.attachment.query('semantic-shared-timeout')
      const second = automatic.attachment.query('semantic-shared-timeout')
      const firstResult = expect(first).rejects.toMatchObject({ code: 'TARGET_UNKNOWN' })
      const secondResult = expect(second).rejects.toMatchObject({ code: 'TARGET_UNKNOWN' })
      await vi.advanceTimersByTimeAsync(2000)
      await firstResult
      await secondResult

      const multiplexedFirst = multiplexed.attachment.query('semantic-multiplexed-timeout')
      const multiplexedSecond = multiplexed.attachment.discoverTargetIfNeeded(
        'semantic-multiplexed-timeout',
        2000
      )
      const multiplexedFirstResult = expect(multiplexedFirst).rejects.toMatchObject({
        code: 'TARGET_UNKNOWN'
      })
      const multiplexedSecondResult = expect(multiplexedSecond).rejects.toMatchObject({
        code: 'TARGET_UNKNOWN'
      })
      await vi.advanceTimersByTimeAsync(2000)
      await multiplexedFirstResult
      await multiplexedSecondResult

      const manualQuery = {
        kind: WebRpcMessageKind.discoveryQuery,
        taskId: 'semantic-collision-query',
        senderId: 'semantic-collision-peer',
        targetId: 'coverage-direct-manual',
        sentAt: Date.now(),
        manual: true
      } as const
      const manualPeerKey = await manual.admitPeer(
        'semantic-collision-peer',
        'coverage-direct-manual'
      )
      await manual.attachment.handleInboundDiscovery(manualQuery, manualPeerKey)
      await manual.attachment.handleInboundDiscovery(manualQuery, manualPeerKey)
      expect(manual.commands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'diagnostic',
            event: expect.objectContaining({ code: 'MANUAL_QUERY_REPLAY' })
          })
        ])
      )
    } finally {
      removeListener()
      await automatic.dispose()
      await multiplexed.dispose()
      await manual.dispose()
      vi.useRealTimers()
    }
  })

  it('fails closed on BroadcastChannel receiver identity and enforces candidate admission limits', async () => {
    const broadcast = createDiscoveryHarness(
      'manual',
      undefined,
      undefined,
      WebRpcPlatform.broadcastChannel
    )
    const automatic = createDiscoveryHarness(
      'automatic',
      undefined,
      undefined,
      WebRpcPlatform.broadcastChannel
    )
    const limited = createDiscoveryHarness('manual')
    try {
      const manualPending = broadcast.attachment.controls.query!('semantic-broadcast-target')
      await Promise.resolve()
      const manualTaskId = latestTaskId(broadcast.commands)
      const manualPeerKey = await broadcast.admitPeer(
        'semantic-broadcast-peer',
        'coverage-direct-manual'
      )
      const manualResponse = {
        kind: WebRpcMessageKind.discoveryResponse,
        taskId: manualTaskId,
        senderId: 'semantic-broadcast-peer',
        targetId: 'coverage-direct-manual',
        resolvedTargetId: 'semantic-broadcast-target',
        sentAt: Date.now(),
        manual: true,
        accepted: true,
        data: { __unique_id__: 'semantic-broadcast-id' }
      } as const
      await broadcast.attachment.handleInboundDiscovery(
        { ...manualResponse, receiverId: 'wrong-broadcast-receiver' },
        manualPeerKey
      )
      await broadcast.attachment.handleInboundDiscovery(
        { ...manualResponse, receiverId: 'semantic-broadcast-target' },
        manualPeerKey
      )
      await expect(manualPending).resolves.toHaveLength(0)

      const automaticPending = automatic.attachment.query('semantic-broadcast-auto')
      const automaticTaskId = latestTaskId(automatic.commands)
      const automaticPeerKey = await automatic.admitPeer(
        'semantic-broadcast-auto-peer',
        'coverage-direct-automatic'
      )
      const automaticResponse = {
        kind: WebRpcMessageKind.discoveryResponse,
        taskId: automaticTaskId,
        senderId: 'semantic-broadcast-auto-peer',
        targetId: 'coverage-direct-automatic',
        resolvedTargetId: 'semantic-broadcast-auto',
        sentAt: Date.now()
      } as const
      await automatic.attachment.handleInboundDiscovery(
        { ...automaticResponse, receiverId: 'wrong-broadcast-receiver' },
        automaticPeerKey
      )
      await automatic.attachment.handleInboundDiscovery(
        { ...automaticResponse, receiverId: 'semantic-broadcast-auto' },
        automaticPeerKey
      )
      await expect(automaticPending).resolves.toBeUndefined()

      const limitedPending = limited.attachment.controls.query!('semantic-limit-target')
      const limitedResult = expect(limitedPending).rejects.toMatchObject({
        code: 'ENDPOINT_DISPOSED'
      })
      await Promise.resolve()
      const limitedTaskId = latestTaskId(limited.commands)
      const peerKeys = await Promise.all(
        [0, 1, 2, 3].map((index) =>
          limited.admitPeer(`semantic-limit-peer-${index}`, 'coverage-direct-manual')
        )
      )
      for (
        let index = 0;
        index < limited.attachment.limits.maxManualCandidatesPerQuery + 1;
        index += 1
      ) {
        const peerKey = peerKeys[index % peerKeys.length]!
        await limited.attachment.handleInboundDiscovery(
          {
            kind: WebRpcMessageKind.discoveryResponse,
            taskId: limitedTaskId,
            senderId: `semantic-limit-peer-${index}`,
            targetId: 'coverage-direct-manual',
            resolvedTargetId: 'semantic-limit-target',
            receiverId: `semantic-limit-receiver-${index}`,
            sentAt: Date.now(),
            manual: true,
            accepted: true
          },
          peerKey
        )
      }
      expect(limited.commands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'diagnostic',
            event: expect.objectContaining({ code: 'MANUAL_CANDIDATE_LIMIT' })
          })
        ])
      )
      await limited.dispose()
      await limitedResult
    } finally {
      await broadcast.dispose()
      await automatic.dispose()
      await limited.dispose()
    }
  })

  it('covers unique BroadcastChannel identity variants and public candidate validation', async () => {
    const manual = createDiscoveryHarness('manual')
    const broadcastManual = createDiscoveryHarness(
      'manual',
      'semantic-manual-id',
      undefined,
      WebRpcPlatform.broadcastChannel,
      'broadcast'
    )
    const broadcastAutomatic = createDiscoveryHarness(
      'automatic',
      'semantic-automatic-id',
      undefined,
      WebRpcPlatform.broadcastChannel
    )
    try {
      expect(() => manual.attachment.controls.register!(undefined as never)).toThrowError(
        WebRpcError
      )

      const manualPending = broadcastManual.attachment.controls.query!('semantic-broadcast-manual')
      await Promise.resolve()
      const manualTaskId = latestTaskId(broadcastManual.commands)
      const manualPeerKey = await broadcastManual.admitPeer(
        'semantic-broadcast-manual-peer',
        'coverage-direct-manual'
      )
      await broadcastManual.attachment.handleInboundDiscovery(
        {
          kind: WebRpcMessageKind.discoveryResponse,
          taskId: manualTaskId,
          senderId: 'semantic-broadcast-manual-peer',
          targetId: 'coverage-direct-manual',
          resolvedTargetId: 'semantic-broadcast-manual',
          receiverId: 'semantic-broadcast-manual:semantic-manual-id',
          sentAt: Date.now(),
          manual: true,
          accepted: true,
          data: { __unique_id__: 'semantic-manual-id', answer: 1 }
        },
        manualPeerKey
      )
      const [manualCandidate] = await manualPending
      expect(manualCandidate).toMatchObject({
        receiverId: 'semantic-broadcast-manual:semantic-manual-id'
      })
      broadcastManual.attachment.controls.register!(manualCandidate!)
      broadcastManual.attachment.controls.pinReceiver(
        'semantic-broadcast-manual',
        'semantic-broadcast-manual:semantic-manual-id'
      )
      expect(
        broadcastManual.attachment.receiverForTarget('semantic-broadcast-manual')
      ).toMatchObject({ receiverId: 'semantic-broadcast-manual:semantic-manual-id' })
      await expect(
        broadcastManual.attachment.discoverTargetIfNeeded('semantic-broadcast-manual', 100)
      ).resolves.toBeUndefined()

      const automaticPending = broadcastAutomatic.attachment.query('semantic-broadcast-automatic')
      const automaticTaskId = latestTaskId(broadcastAutomatic.commands)
      const automaticPeerKey = await broadcastAutomatic.admitPeer(
        'semantic-broadcast-automatic-peer',
        'coverage-direct-automatic'
      )
      await broadcastAutomatic.attachment.handleInboundDiscovery(
        {
          kind: WebRpcMessageKind.discoveryResponse,
          taskId: automaticTaskId,
          senderId: 'semantic-broadcast-automatic-peer',
          targetId: 'coverage-direct-automatic',
          resolvedTargetId: 'semantic-broadcast-automatic',
          receiverId: 'wrong-broadcast-receiver',
          sentAt: Date.now(),
          data: { __unique_id__: 'semantic-automatic-id' }
        },
        automaticPeerKey
      )
      await broadcastAutomatic.attachment.handleInboundDiscovery(
        {
          kind: WebRpcMessageKind.discoveryResponse,
          taskId: automaticTaskId,
          senderId: 'semantic-broadcast-automatic-peer',
          targetId: 'coverage-direct-automatic',
          resolvedTargetId: 'semantic-broadcast-automatic',
          receiverId: 'semantic-broadcast-automatic:semantic-automatic-id',
          sentAt: Date.now(),
          data: { __unique_id__: 'semantic-automatic-id' }
        },
        automaticPeerKey
      )
      await expect(automaticPending).resolves.toBeUndefined()
      await expect(
        broadcastAutomatic.attachment.discoverTargetIfNeeded('semantic-broadcast-automatic', 100)
      ).resolves.toBeUndefined()
    } finally {
      await manual.dispose()
      await broadcastManual.dispose()
      await broadcastAutomatic.dispose()
    }
  })

  it('fails closed for automatic/manual mode mismatches and preserves direct disposal errors', async () => {
    const automatic = createDiscoveryHarness('automatic')
    const manual = createDiscoveryHarness('manual')
    try {
      await automatic.attachment.handleInboundDiscovery(
        {
          kind: WebRpcMessageKind.discoveryQuery,
          taskId: 'mode-mismatch',
          senderId: 'peer',
          targetId: 'coverage-direct-automatic',
          sentAt: Date.now(),
          manual: true
        },
        'peer-key'
      )
      await manual.attachment.handleInboundDiscovery(
        {
          kind: WebRpcMessageKind.discoveryResponse,
          taskId: 'missing-task',
          senderId: 'peer',
          targetId: 'coverage-direct-manual',
          resolvedTargetId: 'target',
          receiverId: 'receiver',
          sentAt: Date.now()
        },
        'peer-key'
      )
      await manual.attachment.handleInboundDiscovery(
        {
          kind: WebRpcMessageKind.discoveryResponse,
          taskId: 'missing-manual-task',
          senderId: 'peer',
          targetId: 'coverage-direct-manual',
          resolvedTargetId: 'target',
          receiverId: 'receiver',
          sentAt: Date.now(),
          manual: true,
          accepted: true
        },
        await manual.admitPeer('peer', 'coverage-direct-manual')
      )
      expect(() => automatic.attachment.controls.query).not.toThrow()
      expect(() => manual.attachment.controls.register!(forgedCandidate())).toThrowError(
        WebRpcError
      )
    } finally {
      await automatic.dispose()
      await manual.dispose()
    }
  })

  it('proves receiver miss to replacement without stale pin or result leakage', async () => {
    vi.useFakeTimers()
    const harness = createDiscoveryHarness('automatic')
    const targetId = 'r2-v4-replacement-target'
    try {
      const pending = harness.attachment.query(targetId)
      const taskId = taskIdForTarget(harness.commands, targetId)
      const peerKey = await harness.admitPeer('r2-v4-replacement-peer', 'coverage-direct-automatic')

      const beforeMiss = combinedSnapshot(harness)
      await harness.attachment.handleInboundDiscovery(
        {
          kind: WebRpcMessageKind.discoveryResponse,
          taskId,
          senderId: 'r2-v4-replacement-peer',
          targetId: 'coverage-direct-automatic',
          resolvedTargetId: targetId,
          receiverId: undefined,
          sentAt: Date.now()
        } as never,
        peerKey
      )
      expectUnchangedSnapshot(beforeMiss, combinedSnapshot(harness))

      let settlementCount = 0
      const observed = pending.then(() => {
        settlementCount += 1
      })
      void observed.catch(() => undefined)
      await harness.attachment.handleInboundDiscovery(
        {
          kind: WebRpcMessageKind.discoveryResponse,
          taskId,
          senderId: 'r2-v4-replacement-peer',
          targetId: 'coverage-direct-automatic',
          resolvedTargetId: targetId,
          receiverId: 'replacement-receiver',
          sentAt: Date.now()
        },
        peerKey
      )
      await observed
      expect(settlementCount).toBe(1)
      expect(harness.attachment.getServerList(targetId)).toEqual([
        expect.objectContaining({ receiverId: 'replacement-receiver', status: 'active' })
      ])

      harness.attachment.controls.pinReceiver(targetId, 'replacement-receiver')
      vi.setSystemTime(Date.now() + 300_001)
      expect(() => harness.attachment.receiverForTarget(targetId)).toThrowError(WebRpcError)

      harness.attachment.controls.unpinReceiver(targetId)
      await vi.runOnlyPendingTimersAsync()
      const replacementPending = harness.attachment.query(targetId)
      const replacementTaskId = taskIdForTarget(harness.commands, targetId)
      expect(replacementTaskId).not.toBe(taskId)
      await harness.attachment.handleInboundDiscovery(
        {
          kind: WebRpcMessageKind.discoveryResponse,
          taskId: replacementTaskId,
          senderId: 'r2-v4-replacement-peer',
          targetId: 'coverage-direct-automatic',
          resolvedTargetId: targetId,
          receiverId: 'replacement-receiver',
          sentAt: Date.now()
        },
        peerKey
      )
      await expect(replacementPending).resolves.toBeUndefined()
      await expect(harness.attachment.resolveReceiver(targetId)).resolves.toEqual({
        receiverId: 'replacement-receiver',
        verifiedPeerKey: peerKey
      })
      expect(harness.attachment.getPinnedReceiver(targetId)).toBeUndefined()
    } finally {
      await harness.dispose()
      vi.useRealTimers()
    }
  })

  it('pairs reversed concurrent discovery responses with exactly-once settlements', async () => {
    const harness = createDiscoveryHarness('automatic')
    const firstTargetId = 'r2-v4-first-task-target'
    const secondTargetId = 'r2-v4-second-task-target'
    try {
      const settlementOrder: string[] = []
      let firstSettlementCount = 0
      let secondSettlementCount = 0
      const firstPending = harness.attachment.query(firstTargetId).then(() => {
        firstSettlementCount += 1
        settlementOrder.push('first')
      })
      const secondPending = harness.attachment.query(secondTargetId).then(() => {
        secondSettlementCount += 1
        settlementOrder.push('second')
      })
      void firstPending.catch(() => undefined)
      void secondPending.catch(() => undefined)
      const firstTaskId = taskIdForTarget(harness.commands, firstTargetId)
      const secondTaskId = taskIdForTarget(harness.commands, secondTargetId)
      const peerKey = await harness.admitPeer('r2-v4-task-peer', 'coverage-direct-automatic')

      await harness.attachment.handleInboundDiscovery(
        {
          kind: WebRpcMessageKind.discoveryResponse,
          taskId: secondTaskId,
          senderId: 'r2-v4-task-peer',
          targetId: 'coverage-direct-automatic',
          resolvedTargetId: secondTargetId,
          receiverId: 'second-receiver',
          sentAt: Date.now()
        },
        peerKey
      )
      await secondPending
      expect(settlementOrder).toEqual(['second'])
      expect(firstSettlementCount).toBe(0)
      expect(secondSettlementCount).toBe(1)

      await harness.attachment.handleInboundDiscovery(
        {
          kind: WebRpcMessageKind.discoveryResponse,
          taskId: firstTaskId,
          senderId: 'r2-v4-task-peer',
          targetId: 'coverage-direct-automatic',
          resolvedTargetId: firstTargetId,
          receiverId: 'first-receiver',
          sentAt: Date.now()
        },
        peerKey
      )
      await firstPending
      expect(settlementOrder).toEqual(['second', 'first'])
      expect(firstSettlementCount).toBe(1)
      expect(secondSettlementCount).toBe(1)
    } finally {
      await harness.dispose()
      expectTerminalZero(combinedSnapshot(harness))
    }
  })

  it('proves response-wins and dispose-wins terminal races without late re-settlement', async () => {
    const runRace = async (responseFirst: boolean): Promise<void> => {
      const harness = createDiscoveryHarness('automatic')
      const targetId = responseFirst ? 'r2-v4-response-first' : 'r2-v4-dispose-first'
      let terminal = false
      try {
        const pending = harness.attachment.query(targetId)
        const taskId = taskIdForTarget(harness.commands, targetId)
        const peerKey = await harness.admitPeer(
          responseFirst ? 'r2-v4-response-peer' : 'r2-v4-dispose-peer',
          'coverage-direct-automatic'
        )
        let settlementCount = 0
        let firstOutcome: 'resolved' | 'rejected' | undefined
        let resolved = false
        let resolvedValue: unknown
        let firstReason: unknown
        let secondReason: unknown
        const observed = pending.then(
          (value: unknown) => {
            settlementCount += 1
            firstOutcome = 'resolved'
            resolved = true
            resolvedValue = value
          },
          (reason: unknown) => {
            settlementCount += 1
            firstOutcome = 'rejected'
            firstReason = reason
          }
        )
        const secondObserver = pending.catch((reason: unknown) => {
          secondReason = reason
        })
        const response = {
          kind: WebRpcMessageKind.discoveryResponse,
          taskId,
          senderId: responseFirst ? 'r2-v4-response-peer' : 'r2-v4-dispose-peer',
          targetId: 'coverage-direct-automatic',
          resolvedTargetId: targetId,
          receiverId: 'race-receiver',
          sentAt: Date.now()
        } as const

        if (responseFirst) {
          await harness.attachment.handleInboundDiscovery(response, peerKey)
          await observed
          expect(firstOutcome).toBe('resolved')
        }

        harness.attachment.dispose()
        const disposePromise = harness.outbound.dispose()
        expect(harness.outbound.dispose()).toBe(disposePromise)
        await disposePromise
        await harness.kernel.resources.releaseAll()
        harness.kernel.completeDispose()
        terminal = true
        await Promise.all([observed, secondObserver])
        expect(settlementCount).toBe(1)
        if (responseFirst) {
          expect(firstOutcome).toBe('resolved')
          expect(resolved).toBe(true)
          expect(resolvedValue).toBeUndefined()
          expect(firstReason).toBeUndefined()
          expect(secondReason).toBeUndefined()
        } else {
          expect(firstOutcome).toBe('rejected')
          expect(secondReason).toBe(firstReason)
          expect(firstReason).toBeInstanceOf(WebRpcLifecycleError)
          expect(firstReason).toMatchObject({
            name: 'WebRpcLifecycleError',
            source: '@migaia/web-rpc',
            code: 'ENDPOINT_DISPOSED',
            message: 'Endpoint disposed'
          })
          expect((firstReason as Error).stack).toBeTruthy()
          expect((firstReason as WebRpcLifecycleError).cause).toBeUndefined()
        }

        const commandCount = harness.commands.length
        await harness.attachment.handleInboundDiscovery(response, peerKey)
        await Promise.resolve()
        expect(harness.commands).toHaveLength(commandCount)
        expect(settlementCount).toBe(1)
        expectTerminalZero(combinedSnapshot(harness))
      } finally {
        if (!terminal) await harness.dispose()
      }
    }

    await runRace(true)
    await runRace(false)
  })

  it('proves source-less valid admission and per-frame invalid admission no-delta', async () => {
    const validSender = 'r2-v5-source-less-peer'
    const harness = createDiscoveryHarness(
      'automatic',
      undefined,
      undefined,
      undefined,
      undefined,
      (senderId) => senderId === validSender
    )
    try {
      const validTargetId = 'r2-v4-source-less-valid'
      const validPending = harness.attachment.query(validTargetId)
      const validTaskId = taskIdForTarget(harness.commands, validTargetId)
      await harness.peerTransport.send({
        kind: WebRpcMessageKind.discoveryResponse,
        taskId: validTaskId,
        senderId: validSender,
        targetId: 'coverage-direct-automatic',
        resolvedTargetId: validTargetId,
        receiverId: 'source-less-receiver',
        sentAt: Date.now()
      })
      await flushTransport()
      await expect(validPending).resolves.toBeUndefined()

      const invalidTargetId = 'r2-v4-invalid-frame-target'
      const invalidPending = harness.attachment.query(invalidTargetId)
      const invalidTaskId = taskIdForTarget(harness.commands, invalidTargetId)
      const base = {
        kind: WebRpcMessageKind.discoveryResponse,
        taskId: invalidTaskId,
        senderId: validSender,
        targetId: 'coverage-direct-automatic',
        resolvedTargetId: invalidTargetId,
        receiverId: 'valid-after-invalid-receiver',
        sentAt: Date.now()
      } as const
      const invalidFrames = [
        { ...base, receiverId: undefined } as never,
        { ...base, targetId: 'foreign-endpoint' },
        { ...base, resolvedTargetId: 'foreign-target' },
        { ...base, receiverId: '' },
        { ...base, senderId: 'r2-v5-foreign-sender' },
        { ...base, taskId: 'missing-task' }
      ] as const
      for (const [index, frame] of invalidFrames.entries()) {
        const before = combinedSnapshot(harness)
        const beforeIdentity = identitySnapshot(harness)
        await harness.peerTransport.send(frame)
        await flushTransport()
        expectUnchangedSnapshot(before, combinedSnapshot(harness))
        const afterIdentity = identitySnapshot(harness)
        expect(afterIdentity.balance).toBe(beforeIdentity.balance)
        if (index === 1) {
          expect(afterIdentity.acceptedAdmits).toBe(beforeIdentity.acceptedAdmits)
          expect(afterIdentity.rejectedAdmits).toBe(beforeIdentity.rejectedAdmits)
          expect(afterIdentity.releases).toBe(beforeIdentity.releases)
        } else if (index === 4) {
          expect(afterIdentity.rejectedAdmits).toBe(beforeIdentity.rejectedAdmits + 1)
          expect(afterIdentity.acceptedAdmits).toBe(beforeIdentity.acceptedAdmits)
          expect(afterIdentity.releases).toBe(beforeIdentity.releases)
        } else {
          expect(afterIdentity.acceptedAdmits).toBe(beforeIdentity.acceptedAdmits + 1)
          expect(afterIdentity.releases).toBe(beforeIdentity.releases + 1)
        }
      }

      let settlementCount = 0
      const observed = invalidPending.then(() => {
        settlementCount += 1
      })
      void observed.catch(() => undefined)
      await harness.peerTransport.send(base)
      await flushTransport()
      await observed
      expect(settlementCount).toBe(1)
      expect(harness.attachment.getServerList(invalidTargetId)).toEqual([
        expect.objectContaining({ receiverId: 'valid-after-invalid-receiver', status: 'active' })
      ])

      await harness.peerTransport.send(base)
      await flushTransport()
      expect(settlementCount).toBe(1)
    } finally {
      await harness.dispose()
      expectTerminalZero(combinedSnapshot(harness))
    }
  })
})
