import { expect, it } from 'vitest'
import { createLogHost, levelPlugin } from '../src/index.ts'
import { thresholdFeature } from '../src/features/threshold.ts'
import { CaptureOutput, messageOf } from './fixtures/output.ts'

/** Output-local threshold overrides the shared default without mutating another output's policy. */
async function thresholdScope(): Promise<void> {
  /** The same descriptor's live setter intentionally changes every scope that uses that descriptor. */
  const threshold = thresholdFeature({ level: 'warn' })
  /** Output A inherits host defaults. */
  const a = new CaptureOutput({ name: 'a' })
  /** Output B selects a separate lower threshold. */
  const b = new CaptureOutput({ name: 'b', features: [thresholdFeature({ level: 'debug' })] })
  /** Level methods remain policy-free; output scopes decide admission independently. */
  const host = createLogHost({
    features: [threshold],
    plugins: [levelPlugin(), a.plugin(), b.plugin()]
  })
  host.debug('first')
  await host.flush()
  expect(a.records).toEqual([])
  expect(b.records.map(messageOf)).toEqual(['first'])
  threshold.setLevel('debug')
  host.debug('second')
  await host.flush()
  expect(a.records.map(messageOf)).toEqual(['second'])
  expect(b.records.map(messageOf)).toEqual(['first', 'second'])
  await host.shutdown('manual')
}
it('overrides host thresholds per output and shares explicit live descriptor state', thresholdScope)
