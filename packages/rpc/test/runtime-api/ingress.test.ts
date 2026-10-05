import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createEndpointKernel, EndpointOwnerKey } from '../../src/core/endpoint-kernel.js'
import { prepareEndpoint } from '../../src/core/internal/endpoint-bootstrap.js'
import { RpcOutboundAttachment } from '../../src/core/internal/outbound-attachment.js'
import { ProviderAdmissionRegistry } from '../../src/core/internal/provider-admission.js'
import { registerBatchAgreement } from '../../src/core/internal/batch-frame.js'
import { RpcPortName } from '../../src/core/internal/plugin-shared-keys.js'
import { messageFramerV1 } from '../../src/contract/framing/message-framer.js'
import {
  normalizeRuntimeEnvelope,
  wrapRuntimeCarrier
} from '../../src/contract/runtime-api/index.js'
import { runtimeOperationCapabilities } from '../../src/contract/runtime-api/capabilities.js'
import type { IRpcRuntimeEnvelope } from '../../src/contract/runtime-api/types.js'
import type { IRpcSelectedComponents } from '../../src/core/internal/endpoint-options.js'

/** Every candidate uses the genuine closed profile, with no legacy envelope inside it. */
function frame(id: string, control = false): IRpcRuntimeEnvelope {
  return normalizeRuntimeEnvelope({
    profile: 'migaia.rpc.runtime-api/1',
    kind: control ? 'runtime-control' : 'runtime-call',
    id,
    route: {
      applicationVersion: '1',
      senderId: 'caller',
      targetId: 'provider',
      receiverId: 'provider',
      sentAt: 0
    },
    task: {
      mode: 'request',
      method: 'echo',
      callerId: 'caller',
      callerGeneration: { kind: 'session', value: 0, providerId: 'caller' },
      targetGeneration: { kind: 'session', value: 0, providerId: 'provider' }
    },
    ...(control
      ? { operation: 'cancel' }
      : { options: { orderKey: 'same', cancel: 'before-start' }, payload: id })
  })
}

/** The real receiver, original identity owner and kernel route table expose ingress order only. */
async function receiver(
  capabilities = runtimeOperationCapabilities('request', {
    orderKey: 'same',
    cancel: 'before-start'
  })
) {
  const [transport, sender] = createMemoryTransportPair()
  registerBatchAgreement(transport, capabilities)
  const kernel = createEndpointKernel(transport)
  const framer = messageFramerV1
  const deferred = await prepareEndpoint(
    {
      id: 'provider',
      transport,
      codec: identityCodecV1 as IRpcSelectedComponents['codec'],
      framer,
      middlewares: []
    },
    { deferMiddlewareInstall: true }
  )
  const waiting = new Map<string, { resolve(value: unknown): void; reject(error: unknown): void }>()
  const failures: unknown[] = []
  const prepared = await deferred.finalize(
    [],
    async (operation) => await operation(),
    (key) => {
      if (key === RpcPortName.connect) return { verify: () => true }
      if (key === RpcPortName.authentication)
        return {
          enabled: true,
          encodedType: 'any',
          protect: (value: unknown) => value,
          unprotect: (value: unknown) =>
            new Promise<unknown>((resolve, reject) => {
              waiting.set((value as IRpcRuntimeEnvelope).id, { resolve, reject })
            })
        }
      if (key === RpcPortName.hooks)
        return {
          listeners: [
            (event: { error?: unknown }) => {
              if (event.error) failures.push(event.error)
            }
          ]
        }
      return undefined
    },
    () => Date.now()
  )
  const outbound = new RpcOutboundAttachment(kernel, prepared)
  const admission = new ProviderAdmissionRegistry(1, 1, 256)
  kernel.registerOwner(
    Reflect.get(EndpointOwnerKey, 'providerAdmission') ?? 'provider-admission',
    admission
  )
  const delivered: string[] = []
  kernel.registerRoute('runtime-call', (message) => {
    delivered.push((message as { envelope: IRpcRuntimeEnvelope }).envelope.id)
  })
  /** Observe the original control route without replacing its authenticated handler or dispatcher. */
  const dispatch = kernel.dispatchRoute
  kernel.dispatchRoute = (kind, message) => {
    if (kind === 'runtime-control')
      delivered.push((message as { envelope: IRpcRuntimeEnvelope }).envelope.id)
    return Reflect.apply(dispatch, kernel, [kind, message])
  }
  outbound.activate()
  return {
    sender,
    waiting,
    failures,
    delivered,
    admission,
    kernel,
    outbound,
    close: async () => {
      kernel.beginClose()
      await outbound.dispose()
      await kernel.resources.releaseAll()
      kernel.completeDispose()
    }
  }
}

it('[A59][A60] real ingress captures before async protection, submits the ready prefix, and lets authenticated controls bypass it', async () => {
  const harness = await receiver()
  try {
    for (const id of ['first', 'second', 'cancel'])
      await harness.sender.send(wrapRuntimeCarrier(frame(id, id === 'cancel')))
    await vi.waitFor(() => assert.equal(harness.waiting.size, 3))
    harness.waiting.get('second')!.resolve(frame('second'))
    await Promise.resolve()
    await Promise.resolve()
    assert.deepEqual(
      harness.delivered,
      [],
      '[A59] later authentication cannot overtake physical arrival'
    )
    harness.waiting.get('cancel')!.resolve(frame('cancel', true))
    await vi.waitFor(() =>
      assert.deepEqual(
        harness.delivered,
        ['cancel'],
        '[A60] original control route bypasses incomplete business verification'
      )
    )
    assert.equal(
      harness.admission.size,
      0,
      '[A60] physical candidates never borrow maxGlobal=1 business capacity'
    )
    harness.waiting.get('first')!.resolve(frame('first'))
    await vi.waitFor(() => assert.deepEqual(harness.delivered, ['cancel', 'first', 'second']))
  } finally {
    await harness.close()
  }
})

it('[A59][A75] rejecting the head releases its exact receipt; close prevents late verification from dispatching', async () => {
  const harness = await receiver()
  try {
    for (const id of ['rejected', 'ready', 'late'])
      await harness.sender.send(wrapRuntimeCarrier(frame(id)))
    await vi.waitFor(() => assert.equal(harness.waiting.size, 3))
    harness.waiting.get('ready')!.resolve(frame('ready'))
    harness.waiting.get('rejected')!.reject(new Error('fixture verification rejected'))
    await vi.waitFor(() => assert.deepEqual(harness.delivered, ['ready']))
    await harness.close()
    harness.waiting.get('late')!.resolve(frame('late'))
    await Promise.resolve()
    await Promise.resolve()
    assert.deepEqual(harness.delivered, ['ready'])
  } finally {
    await harness.close()
  }
})
