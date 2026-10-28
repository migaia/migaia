/** Original wire-error business graphs use genuine public namespaces and canonical serialization. */
import { describe, expect, it, vi } from 'vitest'
import { serializeRpcError, RpcLifecycleError } from '@migaia/rpc-contract/errors'
import { timeout } from '@migaia/rpc-host/features/timeout'
import { connectedCoreHosts } from '../host/core-fixture.ts'

/** The actual public report port lends native coded errors directly, without a retired hook wrapper. */
type IReportedError = Error & { readonly code?: string }

describe('one RPC wire error format', () => {
  it('delivers bounded errors, data, and stack on both paths with exact failure reports', async () => {
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
    /** Each original endpoint retains its independently selected public diagnostic port. */
    const serverFailures: IReportedError[] = []
    /** Caller cancellation serialization must not be mixed with provider failure reports. */
    const clientFailures: IReportedError[] = []
    /** Both actual Hosts run the same original carrier, Session and wire error projection. */
    const { a: server, b: client } = await connectedCoreHosts(
      {
        fail: (value) => {
          throw originals[value as number]
        },
        slow: async (_value, context) => {
          const signal = context.signal
          slowStarted?.()
          if (!signal.aborted)
            await new Promise<void>((resolve) => {
              signal.addEventListener('abort', () => resolve(), { once: true })
            })
          observedAborts.push(signal.reason)
          slowAborted?.()
        }
      },
      {},
      (error) => serverFailures.push(error as IReportedError),
      undefined,
      (error) => clientFailures.push(error as IReportedError)
    )
    try {
      for (let index = 0; index < originals.length; index += 1) {
        let received: unknown
        try {
          await client.memory.send('a', 'fail', index, { timeout: timeout({ ms: 2000 }) })
        } catch (error) {
          received = error
        }
        expect(received).toBeInstanceOf(Error)
        const cause = received as Error
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
      expect(serverFailures.filter((event) => event.code === 'INTERNAL')).toEqual(originals)
      expect(clientFailures).toHaveLength(0)
      for (let index = 0; index < originals.length; index += 1) {
        const started = new Promise<void>((resolve) => {
          slowStarted = resolve
        })
        const aborted = new Promise<void>((resolve) => {
          slowAborted = resolve
        })
        const controller = new AbortController()
        const pending = client.memory.send('a', 'slow', null, {
          signal: controller.signal,
          timeout: false
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
      await client.close()
      await server.close()
    }
  })

  it('returns an unidentified provider error and a bounded cause chain before timeout', async () => {
    let chain: Error = new Error('leaf')
    for (let index = 0; index < 59; index += 1) {
      const parent = new Error(`parent ${index}`)
      Object.defineProperty(parent, 'cause', { value: chain })
      chain = parent
    }
    const deepError = chain
    /** These real provider exceptions pass through the sole new-profile error graph boundary. */
    const { a: server, b: client } = await connectedCoreHosts({
      plain: () => {
        throw new Error('plain')
      },
      deep: () => {
        throw deepError
      }
    })
    try {
      await expect(
        client.memory.send('a', 'plain', null, { timeout: timeout({ ms: 2000 }) })
      ).rejects.toMatchObject({ source: 'rpc.endpoint', code: 'INTERNAL' })
      let received: unknown
      try {
        await client.memory.send('a', 'deep', null, { timeout: timeout({ ms: 2000 }) })
      } catch (error) {
        received = error
      }
      expect(received).toBeInstanceOf(Error)
      let node: unknown = received
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
      await client.close()
      await server.close()
    }
  })

  it('restores cause, AggregateError children, and cleanup errors from a provider failure', async () => {
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
    /** Provider failure and cancellation use the same admitted Session in opposite directions. */
    const { a: server, b: client } = await connectedCoreHosts({
      fail: () => {
        throw original
      },
      slow: async (_value, context) => {
        started?.()
        if (!context.signal.aborted)
          await new Promise<void>((resolve) => {
            context.signal.addEventListener('abort', () => resolve(), { once: true })
          })
        receivedAbort = context.signal.reason
        aborted?.()
      }
    })
    try {
      const response = client.memory.send('a', 'fail', null, { timeout: timeout({ ms: 2000 }) })
      let received: unknown
      try {
        await response
      } catch (error) {
        received = error
      }
      expect(received).toBeInstanceOf(Error)
      const cause = received as Error
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
      const pending = client.memory.send('a', 'slow', null, {
        signal: controller.signal,
        timeout: false
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
      await client.close()
      await server.close()
    }
  })
})
