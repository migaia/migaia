import { expect, it } from 'vitest'
import { createLogHost } from '../src/index.ts'
import {
  batchFeature,
  retryFeature,
  timeoutFeature,
  formatFeature,
  filterFeature,
  thresholdFeature
} from '../src/features/index.ts'
import { CaptureOutput } from './fixtures/output.ts'

/** Reordering built-in descriptors cannot change batch boundaries or actual retry/format behavior. */
async function fixedDeliveryOrder(): Promise<void> {
  /** Shared policy values are installed in two opposite declaration orders. */
  const features = {
    threshold: thresholdFeature({ level: 'debug' }),
    filter: filterFeature(),
    format: formatFeature({ format: 'plain' }),
    batch: batchFeature({ maxSize: 2 }),
    retry: retryFeature({ attempts: 2 }),
    timeout: timeoutFeature({ ms: 100 })
  }
  /** A deliberate first failure proves retry applies to the already-formed batch. */
  const a = new CaptureOutput({ name: 'a', features, failures: 1 })
  /** The reverse list must still yield the same transport sequence. */
  const b = new CaptureOutput({
    name: 'b',
    features: Object.fromEntries(Object.entries(features).reverse()),
    failures: 1
  })
  /** Two logical entries reach each independently resolved output pipeline. */
  const host = createLogHost({ plugins: [a.plugin(), b.plugin()] })
  host.log('info', 'one')
  host.log('info', 'two')
  await host.flush()
  expect(a.attempts).toBe(2)
  expect(b.attempts).toBe(2)
  expect(a.batches).toHaveLength(1)
  expect(b.batches).toHaveLength(1)
  expect(a.batches[0].map(recordText)).toEqual(b.batches[0].map(recordText))
  expect(a.batches[0]).toHaveLength(2)
  await host.shutdown('manual')
}
/** Compare text selected before batching, rather than relying only on the final number of calls. */
function recordText(record: { text: string }): string {
  return record.text
}
it('keeps built-in delivery order independent of declaration order', fixedDeliveryOrder)
