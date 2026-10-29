import { defineLogPlugin } from '../src/plugin.ts'
import { expect, it } from 'vitest'
import { createLogHost, levelPlugin } from '../src/index.ts'
import { thresholdFeature } from '../src/features/threshold.ts'
import { CaptureOutput, messageOf } from './fixtures/output.ts'

/** Output-local threshold overrides the shared default without mutating another output's policy. */
async function thresholdScope(): Promise<void> {
  /** One installed carrier owns the live threshold inherited by output A. */
  const threshold = thresholdFeature({ level: 'warn' })
  /** Output A inherits host defaults. */
  const a = new CaptureOutput({ name: 'a' })
  /** Output B selects a separate lower threshold. */
  const b = new CaptureOutput({
    name: 'b',
    features: { threshold: thresholdFeature({ level: 'debug' }) }
  })
  /** Level methods remain policy-free; output scopes decide admission independently. */
  const host = createLogHost({
    plugins: [
      defineLogPlugin({ name: 'policy', features: { threshold: threshold } }),
      levelPlugin(),
      a.plugin(),
      b.plugin()
    ]
  })
  host.debug('first')
  await host.flush()
  expect(a.records).toEqual([])
  expect(b.records.map(messageOf)).toEqual(['first'])
  host.policy_threshold_setLevel('debug')
  host.debug('second')
  await host.flush()
  expect(a.records.map(messageOf)).toEqual(['second'])
  expect(b.records.map(messageOf)).toEqual(['first', 'second'])
  await host.shutdown('manual')
}
it('overrides host thresholds per output and updates the installed carrier state', thresholdScope)
