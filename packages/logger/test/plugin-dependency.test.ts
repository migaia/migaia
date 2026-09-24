import { describe, expect, it } from 'vitest'
import { Logger } from '../src/log.js'
import { batch } from '../src/plugins/batch.js'
import { color } from '../src/plugins/color.js'
import { http } from '../src/plugins/http.js'
import { reasoning } from '../src/plugins/reasoning.js'
import { setLoggerRuntimeManager } from '../src/runtime-manager.js'

describe('logger Feature dependency ordering', () => {
  it('preserves color and batch behavior in both provider-consumer orders', async () => {
    /** Runs the production reasoning/color pair and returns the exact raw writes. */
    const runColorOrder = async (reverse: boolean): Promise<readonly string[]> => {
      const writes: string[] = []
      const restore = setLoggerRuntimeManager({
        randomUUID: () => `feature-color-${reverse}`,
        defer: (task) => task(),
        write: (text) => writes.push(text)
      })
      try {
        const logger: any = new Logger({
          execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
          plugins: reverse
            ? [reasoning({ asyncOutput: false }), color({ color: 'always' })]
            : [color({ color: 'always' }), reasoning({ asyncOutput: false })]
        })
        logger.startThinking('Plan')
        logger.thinking('step')
        logger.endThinking()
        await logger.shutdown('manual')
        return writes
      } finally {
        restore()
      }
    }

    /** Runs the production HTTP/batch pair and returns serialized request bodies. */
    const runBatchOrder = async (reverse: boolean): Promise<readonly (readonly string[])[]> => {
      const bodies: string[] = []
      const restore = setLoggerRuntimeManager({
        randomUUID: () => `feature-batch-${reverse}`,
        defer: (task) => task(),
        write: () => undefined,
        fetch: async (_url, init) => {
          bodies.push(String(init?.body))
          return { ok: true, status: 200, headers: { get: () => null } }
        }
      })
      try {
        const logger = new Logger({
          execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
          plugins: reverse
            ? [http({ url: 'https://example.test/logs', batch: { maxSize: 2 } }), batch()]
            : [batch(), http({ url: 'https://example.test/logs', batch: { maxSize: 2 } })]
        })
        logger.log('info', 'one')
        logger.log('info', 'two')
        await logger.flush()
        await logger.shutdown('manual')
        return bodies.map((body) =>
          (
            JSON.parse(body) as { readonly entries: readonly { readonly message: string }[] }
          ).entries.map(({ message }) => message)
        )
      } finally {
        restore()
      }
    }

    const providerFirstColor = await runColorOrder(false)
    expect(await runColorOrder(true)).toEqual(providerFirstColor)
    expect(providerFirstColor.join('')).toContain('step')
    // Both orders must actually be colored: equal-but-uncolored output would hide a lost injection.
    expect(providerFirstColor.join('').includes('\u001b[')).toBe(true)
    const providerFirstBatch = await runBatchOrder(false)
    expect(await runBatchOrder(true)).toEqual(providerFirstBatch)
    expect(providerFirstBatch).toHaveLength(1)
  })
})
