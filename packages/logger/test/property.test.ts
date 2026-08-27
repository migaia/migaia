import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Logger } from '../src/log'

describe('Logger configuration properties', () => {
  it('serializes ordered config updates through the host queue', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer(), { maxLength: 12 }), async (values) => {
        const seen: number[] = []
        const logger = new Logger({
          execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
          plugins: [
            {
              name: 'property-update',
              config: { value: 0 },
              install: () => ({}),
              update: (next: { value: number }) => {
                seen.push(next.value)
              }
            }
          ]
        })
        await Promise.all(
          values.map((value) => logger.config.update('property-update', () => ({ value })))
        )
        expect(seen).toEqual(values)
        await logger.shutdown('manual')
      })
    )
  })
})
