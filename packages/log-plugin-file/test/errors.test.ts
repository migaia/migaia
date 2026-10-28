import { expect, it } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { filePlugin } from '../src/index.ts'

/** File failures retain the exact original writer error under the file-owned delivery identity. */
async function writerFailure(): Promise<void> {
  /** The application-owned writer rejection is never replaced or mutated. */
  const original = new RangeError('append failure')
  /** The host receives a single output failure after one append attempt. */
  const failures: unknown[] = []
  /** The injected writer fails only in memory. */
  const host = createLogHost({
    plugins: [
      filePlugin({
        path: 'memory-only',
        writer: {
          async append() {
            throw original
          }
        }
      })
    ]
  })
  host.onFailure((failure) => {
    failures.push(failure.error)
  })
  expect(() => host.log('info', 'failure')).not.toThrow()
  await host.flush()
  expect(failures).toHaveLength(1)
  expect(failures[0]).toMatchObject({
    source: 'logging.file',
    code: 'DELIVERY_FAILED',
    cause: original
  })
  expect((failures[0] as Error).cause).toBe(original)
  await host.shutdown('manual')
}
it('reports append failures without throwing through log dispatch', writerFailure)
