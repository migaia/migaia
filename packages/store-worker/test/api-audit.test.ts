import { describe, expect, it } from 'vitest'
import { MessageChannel } from 'node:worker_threads'
import { isChunkShape, type ISerializeChunk, type ISerializeParser } from '@migaia/serialize'
import { createSerializeWorkerHandler, workerParser } from '../src/serialize/worker.js'

/** Reads the existing error/cause/aggregate graph for cross-realm contract assertions. */
function errorChain(root: unknown): Error[] {
  /** Only this captured canonical error graph is traversed; cycles are visited once. */
  const pending = [root]
  /** Preserve settlement order while checking every reachable original cause. */
  const result: Error[] = []
  /** An error may appear through both cause and errors without representing two failures. */
  const seen = new Set<unknown>()
  while (pending.length) {
    /** These values come from the actual RPC decoder, not fabricated wire frames. */
    const value = pending.shift()
    if (!(value instanceof Error) || seen.has(value)) continue
    seen.add(value)
    result.push(value)
    pending.push(value.cause)
    /** Canonical secondary-error attachment also uses errors[] on non-aggregate native primaries. */
    const errors = Reflect.get(value, 'errors')
    if (Array.isArray(errors)) pending.push(...errors)
  }
  return result
}

describe('store-worker audit regressions', () => {
  it('Worker-D01 preserves the native stream error and original cause through canonical RPC', async () => {
    /** Actual MessagePorts carry both RPC responses and bounded stream frames. */
    const channel = new MessageChannel()
    /**
     * Worker parser failure includes a native cause that cannot be reconstructed from enumerable
     * keys.
     */
    const original = new TypeError('encode-origin', { cause: new Error('encode-root') })
    /** This complete parser implements the supported stream extension contract. */
    const implementation: ISerializeParser = {
      name: 'native-audit',
      async *encode(value: unknown) {
        yield ['value', value] as const
        throw original
      },
      decode(chunk) {
        return chunk[1]
      }
    }
    /** Local handler delivery errors are observed independently of the client operation result. */
    const deliveries: unknown[] = []
    /** Forward every post to the native port; no fake endpoint or protocol payload is used. */
    const handler = createSerializeWorkerHandler(implementation, (message, transfer) => {
      channel.port2.postMessage(
        message,
        transfer as Parameters<typeof channel.port2.postMessage>[1]
      )
    })
    channel.port2.addEventListener('message', (event) => {
      void handler((event as MessageEvent<unknown>).data).catch((error) => {
        deliveries.push(error)
      })
    })
    channel.port2.start()
    channel.port1.start()
    /** The actual public serializer owns client cancellation and queue cleanup. */
    const parser = workerParser({ worker: channel.port1 })
    /** Capture already delivered chunks and the actual terminal failure separately. */
    const chunks: unknown[] = []
    /** The RPC boundary must return an Error graph after the first valid stream chunk. */
    let failure: unknown
    try {
      try {
        /** Public encode is the highest interface reaching the stream/provider failure. */
        const output = await parser.encode(
          { count: 2 },
          { signal: new AbortController().signal, context: 'native-audit' }
        )
        for await (const chunk of output) {
          if (!isChunkShape(chunk)) throw new Error('unexpected non-chunk output')
          chunks.push(chunk)
        }
      } catch (error) {
        failure = error
      }
      expect(chunks).toEqual([['value', { count: 2 }]])
      expect(failure).toBeInstanceOf(Error)
      expect(errorChain(failure)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'TypeError',
            message: 'encode-origin',
            stack: original.stack
          }),
          expect.objectContaining({
            message: 'encode-root',
            stack: (original.cause as Error).stack
          })
        ])
      )
      expect(deliveries).toEqual([])
    } finally {
      await parser.dispose?.()
      await handler.dispose()
      channel.port1.close()
      channel.port2.close()
    }
  })

  it('Worker-S01 retains iterator-return failure beside the original primary across native RPC', async () => {
    /** No simulated transport or private engine state is needed to force the supported failure pair. */
    const channel = new MessageChannel()
    /** The main stream operation fails after one valid output. */
    const primary = new TypeError('iterator-primary', { cause: new Error('iterator-primary-root') })
    /** Cleanup fails independently when the provider returns this actual iterator. */
    const secondary = new Error('iterator-return-secondary')
    /** The complete iterable is deliberately not a generator, whose closed return would be a no-op. */
    let nextCalls = 0
    /** Cleanup remains single-shot even when it rejects. */
    let returnCalls = 0
    /** Every method implements the public parser/iterator contract. */
    const implementation: ISerializeParser = {
      name: 'iterator-return-audit',
      encode(value) {
        return {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                if (nextCalls++ === 0)
                  return { done: false as const, value: ['value', value] as ISerializeChunk }
                throw primary
              },
              async return(): Promise<IteratorResult<ISerializeChunk>> {
                returnCalls++
                throw secondary
              }
            }
          }
        }
      },
      decode(chunk) {
        return chunk[1]
      }
    }
    /** Worker delivery failures remain independently observable. */
    const deliveries: unknown[] = []
    /** Actual native posts carry the canonical RPC error graph. */
    const handler = createSerializeWorkerHandler(implementation, (message, transfer) => {
      channel.port2.postMessage(
        message,
        transfer as Parameters<typeof channel.port2.postMessage>[1]
      )
    })
    channel.port2.addEventListener('message', (event) => {
      void handler((event as MessageEvent<unknown>).data).catch((error) => {
        deliveries.push(error)
      })
    })
    channel.port2.start()
    channel.port1.start()
    /** Use the same public parser API as the primary-error regression. */
    const parser = workerParser({ worker: channel.port1 })
    /** Capture the final native decoder result. */
    let failure: unknown
    try {
      try {
        /** Drain one legitimate chunk, then the real next()/return() failure pair. */
        const output = await parser.encode(7, {
          signal: new AbortController().signal,
          context: 'native-audit'
        })
        for await (const chunk of output) expect(chunk).toEqual(['value', 7])
      } catch (error) {
        failure = error
      }
      expect(returnCalls).toBe(1)
      expect(errorChain(failure)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'TypeError',
            message: 'iterator-primary',
            stack: primary.stack
          }),
          expect.objectContaining({ message: 'iterator-primary-root' }),
          expect.objectContaining({ message: 'iterator-return-secondary', stack: secondary.stack })
        ])
      )
      expect(deliveries).toEqual([])
    } finally {
      await parser.dispose?.()
      await handler.dispose()
      channel.port1.close()
      channel.port2.close()
    }
  })

  it('Worker-D02 classifies a complete parser whose encode getter throws before endpoint construction', () => {
    /** Public parser accessors are application code at this factory boundary. */
    const original = new TypeError('parser encode getter failed')
    /** The complete parser still supplies its other required members. */
    const implementation: ISerializeParser = {
      name: 'getter-parser',
      get encode(): ISerializeParser['encode'] {
        throw original
      },
      decode(chunk) {
        return chunk[1]
      }
    }
    expect(() => createSerializeWorkerHandler(implementation, () => {})).toThrow(original)
    expect(original).toMatchObject({ source: 'store.worker', code: 'INVALID_OPTION' })
    expect(original.stack).toBeTruthy()
  })

  it('Worker-D03 does not claim pre-aborted transfer input is detached or unretryable', async () => {
    /** No provider is needed because cancellation occurs before any transport send. */
    const channel = new MessageChannel()
    /** The real parser still owns an actual native port and endpoint lifecycle. */
    const parser = workerParser({ worker: channel.port1, ownership: 'transfer' })
    /** This exact original native reason must stay reachable through the codec wrapper. */
    const reason = new DOMException('pre-aborted input', 'AbortError')
    /** Cancellation is already visible at public encode admission. */
    const controller = new AbortController()
    controller.abort(reason)
    /** These bytes have never crossed postMessage. */
    const input = new Uint8Array([1, 2, 3])
    /** Capture the supported codec diagnostic instead of inferring detach from the ownership option. */
    let failure: unknown
    try {
      try {
        await parser.encode(input, { signal: controller.signal, context: 'native-audit-pre-abort' })
      } catch (error) {
        failure = error
      }
      expect(input.byteLength).toBe(3)
      expect([...input]).toEqual([1, 2, 3])
      expect(failure).toMatchObject({
        source: 'store.worker',
        code: 'REQUEST_ABORTED',
        cause: reason
      })
      expect((failure as Error).message).not.toContain('input is detached')
      expect((failure as Error).message).not.toContain('cannot be retried')
    } finally {
      await parser.dispose?.()
      channel.port1.close()
      channel.port2.close()
    }
  })
})
