import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createEndpointKernel,
  EndpointKernelState,
  type IEndpointKernelCallbacks
} from '../src/endpoint-kernel.js'
import { WebRpcErrorCode } from '../src/errors.js'
import type { IWebRpcInboundMessage, IWebRpcTransport } from '../src/transport.js'
import { createEndpointTransportActivation } from '../src/internal/transport-activation.js'
import { WebRpcCanonicalChunkAttachment } from '../src/internal/canonical-chunk-attachment.js'
import { createStringFramer } from '@migaia/rpc-contract/framing'

/** Creates callbacks that expose transport ownership without adding feature behavior. */
const callbacks = (
  receive: (message: IWebRpcInboundMessage<unknown>) => void = () => undefined
): IEndpointKernelCallbacks => ({
  receive,
  transportError: () => undefined,
  listenerError: () => undefined,
  receiveError: () => undefined
})

/**
 * Models the Host-owned terminal transaction used by the kernel tests without adding a kernel
 * disposer.
 */
const disposeKernel = (
  kernel: ReturnType<typeof createEndpointKernel>,
  operation: () => Promise<void>
) => {
  kernel.beginClose()
  let resolveTerminal!: () => void
  let rejectTerminal!: (error: unknown) => void
  const terminal = new Promise<void>((resolve, reject) => {
    resolveTerminal = resolve
    rejectTerminal = reject
  })
  void (async () => {
    try {
      await operation()
      await kernel.resources.releaseAll()
      kernel.completeDispose()
      resolveTerminal()
    } catch (error) {
      kernel.completeDispose()
      rejectTerminal(error)
    }
  })()
  terminal.then(
    () => undefined,
    () => undefined
  )
  return terminal
}

/** Fails with one stable message if the canonical attachment regains the retired semantic route. */
async function assertNoLegacyChunkRoute(
  kernel: ReturnType<typeof createEndpointKernel>
): Promise<void> {
  if (await kernel.dispatchRoute('chunk', { legacy: true }))
    throw new Error('Canonical chunk attachment retained forbidden legacy chunk route authority')
}

/** Releases the local kernel resources after a direct attachment probe. */
async function disposeAttachmentProbe(
  kernel: ReturnType<typeof createEndpointKernel>
): Promise<void> {
  kernel.beginClose()
  await kernel.resources.releaseAll()
  kernel.completeDispose()
}

describe('canonical endpoint kernel', () => {
  it('keeps canonical attachment out of the retired semantic chunk route', async () => {
    /** Installs the real attachment, optionally recreating only the retired route in a proxy. */
    const install = (restoreLegacyRoute = false): ReturnType<typeof createEndpointKernel> => {
      const kernel = createEndpointKernel({
        platform: 'Memory',
        ownership: 'owned',
        send: () => undefined,
        subscribe: () => () => undefined
      })
      const attachmentKernel = restoreLegacyRoute
        ? new Proxy(kernel, {
            get(target, key) {
              if (key === 'registerOwner')
                return (owner: string, value: object) => {
                  target.registerOwner(owner, value)
                  target.registerRoute('chunk', () => undefined)
                }
              return Reflect.get(target, key, target)
            }
          })
        : kernel
      new WebRpcCanonicalChunkAttachment(attachmentKernel, createStringFramer({ chunkBytes: 64 }))
      return kernel
    }

    const baseline = install()
    try {
      expect(baseline.ownerKeys).toContain('chunk-assembler')
      await assertNoLegacyChunkRoute(baseline)
    } finally {
      await disposeAttachmentProbe(baseline)
    }

    const mutated = install(true)
    try {
      expect(mutated.ownerKeys).toContain('chunk-assembler')
      await expect(assertNoLegacyChunkRoute(mutated)).rejects.toThrow(
        'Canonical chunk attachment retained forbidden legacy chunk route authority'
      )
    } finally {
      await disposeAttachmentProbe(mutated)
    }

    const restored = install()
    try {
      expect(restored.ownerKeys).toContain('chunk-assembler')
      await assertNoLegacyChunkRoute(restored)
    } finally {
      await disposeAttachmentProbe(restored)
    }
  })

  it('closes selected framer synchronously once with the first kernel reason', async () => {
    const kernel = createEndpointKernel({
      platform: 'Memory',
      ownership: 'owned',
      send: () => undefined,
      subscribe: () => () => undefined
    })
    const native = createStringFramer({ chunkBytes: 64 })
    const first = new Error('first')
    const second = new Error('second')
    const reasons: unknown[] = []
    new WebRpcCanonicalChunkAttachment(kernel, {
      ...native,
      close: (reason) => {
        reasons.push(reason)
        native.close(reason)
      }
    })
    kernel.beginClose(first)
    kernel.beginClose(second)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toBe(first)
    await kernel.resources.releaseAll()
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toBe(first)
  })

  it('keeps the first close reason, aborts synchronously, and increments generation once', () => {
    const kernel = createEndpointKernel({
      platform: 'Memory',
      ownership: 'owned',
      send: () => undefined,
      subscribe: () => () => undefined
    })
    const firstReason = new Error('first close')
    const secondReason = new Error('second close')

    kernel.beginClose(firstReason)
    kernel.beginClose(secondReason)

    expect(kernel.closingSignal.aborted).toBe(true)
    expect(kernel.closingSignal.reason).toBe(firstReason)
    expect(kernel.generation).toBe(1)

    const noArgumentKernel = createEndpointKernel({
      platform: 'Memory',
      ownership: 'owned',
      send: () => undefined,
      subscribe: () => () => undefined
    })
    noArgumentKernel.beginClose()
    expect(noArgumentKernel.closingSignal.reason).toMatchObject({ name: 'AbortError' })
  })

  it('owns one receiver, constant-time routes, and one terminal Promise', async () => {
    const events: string[] = []
    let listener: ((message: IWebRpcInboundMessage<unknown>) => void) | undefined
    const receive = vi.fn()
    const transport: IWebRpcTransport = {
      platform: 'Memory',
      ownership: 'owned',
      send: () => {
        events.push('send')
      },
      subscribe: (next) => {
        events.push('subscribe')
        listener = next
        return () => events.push('unsubscribe')
      },
      close: () => {
        events.push('close')
      }
    }
    const kernel = createEndpointKernel(transport)
    expect(kernel.state).toBe(EndpointKernelState.constructing)
    expect(kernel.ownerKeys).toEqual(['kernel', 'resource-scope', 'time-port'])
    kernel.activate(createEndpointTransportActivation(transport, callbacks(receive)))
    expect(kernel.state).toBe(EndpointKernelState.active)
    listener?.({ data: 'raw' })
    expect(receive).toHaveBeenCalledWith({ data: 'raw' })

    const route = vi.fn()
    const releaseRoute = kernel.registerRoute('request', route)
    await expect(kernel.dispatchRoute('request', { taskId: 'one' })).resolves.toBe(true)
    expect(route).toHaveBeenCalledOnce()
    let routeConflict: unknown
    try {
      kernel.registerRoute('request', route)
    } catch (error) {
      routeConflict = error
    }
    expect(routeConflict).toMatchObject({ code: WebRpcErrorCode.capabilityConflict })
    releaseRoute()
    await expect(kernel.dispatchRoute('request', {})).resolves.toBe(false)

    const first = disposeKernel(kernel, async () => {
      events.push('operation')
    })
    const second = first
    expect(second).toBe(first)
    expect(kernel.state).toBe(EndpointKernelState.closing)
    await expect(first).resolves.toBeUndefined()
    expect(kernel.state).toBe(EndpointKernelState.disposed)
    expect(events).toEqual(['subscribe', 'operation', 'unsubscribe', 'close'])
  })

  it('normalizes sync throw and async rejection into one reentrant terminal Promise', async () => {
    const syncFailure = new Error('sync disposal failure')
    const syncKernel = createEndpointKernel({
      platform: 'Memory',
      send: () => undefined,
      subscribe: () => () => undefined
    })
    syncKernel.activate(createEndpointTransportActivation(syncKernel.transport, callbacks()))
    let syncReentrant: Promise<void> | undefined
    const syncTerminal = disposeKernel(syncKernel, async () => {
      syncReentrant = disposeKernel(syncKernel, async () => undefined)
      throw syncFailure
    })
    expect(syncReentrant).not.toBe(syncTerminal)
    await expect(syncTerminal).rejects.toBe(syncFailure)
    expect(syncKernel.state).toBe(EndpointKernelState.disposed)

    const asyncFailure = new Error('async disposal failure')
    const asyncKernel = createEndpointKernel({
      platform: 'Memory',
      send: () => undefined,
      subscribe: () => () => undefined
    })
    asyncKernel.activate(createEndpointTransportActivation(asyncKernel.transport, callbacks()))
    const asyncTerminal = disposeKernel(asyncKernel, async () => {
      await Promise.resolve()
      throw asyncFailure
    })
    await expect(asyncTerminal).rejects.toBe(asyncFailure)
    expect(asyncKernel.state).toBe(EndpointKernelState.disposed)
  })

  it('quarantines synchronous receive and error callbacks until activation commits', () => {
    const receive = vi.fn()
    const transportError = vi.fn()
    const listenerError = vi.fn()
    const transport: IWebRpcTransport = {
      platform: 'Memory',
      send: () => undefined,
      subscribe: (next) => {
        next({ data: 'construction callback' })
        return () => undefined
      },
      onTransportError: (listener) => {
        listener(new Error('construction transport error'))
        return () => undefined
      },
      onListenerError: (listener) => {
        listener(new Error('construction listener error'))
        return () => undefined
      }
    }
    const kernel = createEndpointKernel(transport)
    kernel.activate(
      createEndpointTransportActivation(transport, {
        receive,
        transportError,
        listenerError,
        receiveError: vi.fn()
      })
    )

    expect(kernel.state).toBe(EndpointKernelState.active)
    expect(receive).not.toHaveBeenCalled()
    expect(transportError).not.toHaveBeenCalled()
    expect(listenerError).not.toHaveBeenCalled()
  })

  it('has zero concrete feature, factory, or endpoint imports', () => {
    const kernelSource = readFileSync(
      resolve(import.meta.dirname, '../src/endpoint-kernel.ts'),
      'utf8'
    )
    const importSpecifiers = [...kernelSource.matchAll(/from ['"]([^'"]+)['"]/g)].map(
      (match) => match[1]
    )
    expect(
      importSpecifiers.filter((specifier) => /features|factory|endpoint\.js/.test(specifier))
    ).toEqual([])
    expect(() => readFileSync(resolve(import.meta.dirname, '../src/endpoint.ts'), 'utf8')).toThrow()
  })
})
