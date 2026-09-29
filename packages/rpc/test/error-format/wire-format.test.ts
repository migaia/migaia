import { describe, expect, it, vi } from 'vitest'
import { serializeRpcError } from '../../src/contract/index.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createClientEndpoint } from '../../src/core/client.js'
import { RpcLifecycleError, RpcRemoteError } from '../../src/core/errors.js'
import { abort } from '../../src/core/middleware/abort.js'
import { connect } from '../../src/core/middleware/connect.js'
import { createProviderEndpoint } from '../../src/core/provider.js'
import type { IRpcHookEvent } from '../../src/core/typing.js'

describe('one RPC wire error format', () => {
  it('delivers bounded errors, data, and stack on both paths with exact failure reports', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    let errorChildren: Error = new Error('leaf')
    for (let index = 0; index < 31; index += 1)
      errorChildren = new AggregateError([errorChildren], `level ${index}`)
    let deepData: unknown = 'leaf'
    for (let index = 0; index < 60; index += 1) deepData = [deepData]
    const dataError = new Error('deep data')
    Object.defineProperty(dataError, 'data', { value: deepData })
    const stackError = new Error('long stack')
    Object.defineProperty(stackError, 'stack', { value: 'x'.repeat(200_000) })
    const originals = [errorChildren, dataError, stackError]
    const restoredResponses: Error[] = []
    const observedAborts: unknown[] = []
    let slowStarted: (() => void) | undefined
    let slowAborted: (() => void) | undefined
    const server = await createProviderEndpoint({
      id: 'wire-limits-server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport }), abort()],
      provider: {
        fail: (context) => {
          throw originals[context.data as number]
        },
        slow: async (context) => {
          const signal = context.signal
          slowStarted?.()
          if (!signal.aborted)
            await new Promise<void>((resolve) => {
              signal.addEventListener('abort', () => resolve(), { once: true })
            })
          observedAborts.push(signal.reason)
          slowAborted?.()
          return context.success(undefined)
        }
      }
    })
    const client = await createClientEndpoint({
      id: 'wire-limits-client',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport }), abort()]
    })
    const serverFailures: IRpcHookEvent[] = []
    const clientFailures: IRpcHookEvent[] = []
    server.hooks.on((event) => {
      if (event.name === 'failure') serverFailures.push(event)
    })
    client.hooks.on((event) => {
      if (event.name === 'failure') clientFailures.push(event)
    })
    try {
      for (let index = 0; index < originals.length; index += 1) {
        let received: unknown
        try {
          await client.send('wire-limits-server', 'fail', index, { timeoutMs: 2000 })
        } catch (error) {
          received = error
        }
        expect(received).toBeInstanceOf(RpcRemoteError)
        const cause = (received as RpcRemoteError).cause as Error
        expect(cause).toBeInstanceOf(Error)
        restoredResponses.push(cause)
        if (index === 0) {
          expect(cause.name).toBe('AggregateError')
          let node: Error | undefined = cause
          let count = 0
          while (node) {
            count += 1
            if (count === 24) {
              expect((node as Error & { readonly truncated?: true }).truncated).toBe(true)
              expect((node as AggregateError).errors).toHaveLength(0)
            }
            node = (node as AggregateError).errors?.[0] as Error | undefined
          }
          expect(count).toBe(24)
        } else if (index === 1) {
          expect((cause as Error & { readonly data?: unknown }).data).toBeUndefined()
          expect((cause as Error & { readonly truncated?: true }).truncated).toBe(true)
        } else {
          expect(cause.stack).toHaveLength(65_536)
          expect((cause as Error & { readonly truncated?: true }).truncated).toBe(true)
        }
      }
      await vi.waitFor(() => expect(serverFailures).toHaveLength(4))
      expect(serverFailures.map((event) => event.code)).toEqual([
        'INTERNAL',
        'PAYLOAD_INVALID',
        'INTERNAL',
        'INTERNAL'
      ])
      expect(
        serverFailures.filter((event) => event.code === 'INTERNAL').map((event) => event.error)
      ).toEqual(originals)
      expect(clientFailures).toHaveLength(0)
      for (let index = 0; index < originals.length; index += 1) {
        const started = new Promise<void>((resolve) => {
          slowStarted = resolve
        })
        const aborted = new Promise<void>((resolve) => {
          slowAborted = resolve
        })
        const controller = new AbortController()
        const pending = client.send('wire-limits-server', 'slow', null, {
          signal: controller.signal,
          timeoutMs: false
        })
        pending.catch(() => undefined)
        await started
        controller.abort(originals[index])
        await expect(pending).rejects.toBeDefined()
        await aborted
        const reports: unknown[] = []
        expect(
          serializeRpcError(observedAborts[index], { report: (failure) => reports.push(failure) })
        ).toEqual(
          serializeRpcError(restoredResponses[index], {
            report: (failure) => reports.push(failure)
          })
        )
        expect(reports).toHaveLength(0)
      }
      await vi.waitFor(() => expect(clientFailures).toHaveLength(1))
      expect(clientFailures.map((event) => event.code)).toEqual(['PAYLOAD_INVALID'])
      expect(serverFailures).toHaveLength(4)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('returns an unidentified provider error and a bounded cause chain before timeout', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    let chain: Error = new Error('leaf')
    for (let index = 0; index < 59; index += 1) {
      const parent = new Error(`parent ${index}`)
      Object.defineProperty(parent, 'cause', { value: chain })
      chain = parent
    }
    const deepError = chain
    const server = await createProviderEndpoint({
      id: 'wire-boundary-server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport }), abort()],
      provider: {
        plain: () => {
          throw new Error('plain')
        },
        deep: () => {
          throw deepError
        }
      }
    })
    const client = await createClientEndpoint({
      id: 'wire-boundary-client',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport }), abort()]
    })
    try {
      await expect(
        client.send('wire-boundary-server', 'plain', null, { timeoutMs: 2000 })
      ).rejects.toMatchObject({ cause: { source: 'unknown', code: 'UNKNOWN' } })
      let received: unknown
      try {
        await client.send('wire-boundary-server', 'deep', null, { timeoutMs: 2000 })
      } catch (error) {
        received = error
      }
      expect(received).toBeInstanceOf(RpcRemoteError)
      let node: unknown = (received as RpcRemoteError).cause
      let count = 0
      while (node instanceof Error) {
        count += 1
        if (count === 48) {
          expect((node as Error & { readonly truncated?: true }).truncated).toBe(true)
          expect(node.cause).toBeUndefined()
        }
        node = node.cause
      }
      expect(count).toBe(48)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('restores cause, AggregateError children, and cleanup errors from a provider failure', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const original = new RpcLifecycleError(
      'outer',
      new AggregateError([new TypeError('a'), new RangeError('b')], 'agg'),
      [{ resource: 'r', error: new Error('cleanup') }]
    )
    let started: (() => void) | undefined
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    let receivedAbort: unknown
    let aborted: (() => void) | undefined
    const abortedPromise = new Promise<void>((resolve) => {
      aborted = resolve
    })
    const server = await createProviderEndpoint({
      id: 'wire-server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport }), abort()],
      provider: {
        fail: () => {
          throw original
        },
        slow: async (context) => {
          started?.()
          if (!context.signal.aborted)
            await new Promise<void>((resolve) => {
              context.signal.addEventListener('abort', () => resolve(), { once: true })
            })
          receivedAbort = context.signal.reason
          aborted?.()
          return context.success(undefined)
        }
      }
    })
    const client = await createClientEndpoint({
      id: 'wire-client',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport }), abort()]
    })
    try {
      const response = client.send('wire-server', 'fail', null, { timeoutMs: 2000 })
      let received: unknown
      try {
        await response
      } catch (error) {
        received = error
      }
      expect(received).toBeInstanceOf(RpcRemoteError)
      const cause = (received as RpcRemoteError).cause
      expect(cause).toBeInstanceOf(Error)
      expect(cause).toMatchObject({ name: 'RpcLifecycleError', code: 'ENDPOINT_DISPOSED' })
      const reports: unknown[] = []
      expect(serializeRpcError(cause, { report: (failure) => reports.push(failure) })).toEqual(
        serializeRpcError(original, { report: (failure) => reports.push(failure) })
      )
      expect(reports).toHaveLength(0)
      expect((cause as Error & { readonly errors: readonly Error[] }).errors[0]?.message).toBe(
        'cleanup'
      )
      const controller = new AbortController()
      const pending = client.send('wire-server', 'slow', null, {
        signal: controller.signal,
        timeoutMs: false
      })
      pending.catch(() => undefined)
      await startedPromise
      controller.abort(original)
      await expect(pending).rejects.toBeDefined()
      await abortedPromise
      expect(receivedAbort).toBeInstanceOf(Error)
      expect(
        serializeRpcError(receivedAbort, { report: (failure) => reports.push(failure) })
      ).toEqual(serializeRpcError(original, { report: (failure) => reports.push(failure) }))
      expect(reports).toHaveLength(0)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })
})
