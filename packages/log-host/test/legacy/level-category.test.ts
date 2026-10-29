import { defineLogPlugin } from '../../src/plugin.ts'
import { expect, it } from 'vitest'
import { createLogHost, levelPlugin, type ILogEntry } from '../../src/index.ts'
import { thresholdFeature, filterFeature } from '../../src/features/index.ts'
import { CaptureOutput } from '../fixtures/output.ts'

/** A named predicate owner preserves the old exact filter-call ordering assertions. */
class CategoryFilter {
  /** Only entries admitted by the threshold may reach these observations. */
  readonly filtered: string[] = []
  /** Actual predicate call identity stays stable through feature installation. */
  readonly filter = (entry: ILogEntry): boolean => {
    this.filtered.push(entry.message)
    return entry.message !== 'hidden'
  }
}
/**
 * Category tags, native payloads and one-pass filtering survive level/threshold ownership
 * separation.
 */
async function categoryPolicy(): Promise<void> {
  /** Output records expose native entry snapshots, independently of formatting text. */
  const output = new CaptureOutput()
  /** Threshold state replaces only the removed level setter owner. */
  const threshold = thresholdFeature({ level: 'warn' })
  /** Filter additions retain their own idempotent removal capability. */
  const filters = filterFeature()
  /** Call order remains directly observable. */
  const observer = new CategoryFilter()
  /** Installing level methods alone does not acquire filtering policy. */
  const host = createLogHost({
    plugins: [
      defineLogPlugin({ name: 'policy', features: { threshold: threshold, filter: filters } }),
      levelPlugin(),
      output.plugin()
    ]
  })
  /** Removing only this added predicate preserves the old filter-removal behavior. */
  const off = host.policy_filter_add(observer.filter)
  /** Native Error and nested payload identities must survive both policy and output boundaries. */
  const original = new RangeError('original categorized failure')
  /** Nested objects are caller-owned rather than deep-cloned by logging. */
  const payload = { key: 'business-key', value: { visible: true } }
  host.atLevel('debug', { tag: 'storage', message: 'below threshold', args: [payload] })
  host.atLevel('error', { tag: 'storage', message: 'failure', args: [payload, original] })
  host.atLevel('error', { tag: 'storage', message: 'hidden' })
  host.dispatchRaw({ tag: 'other', message: 'ordinary unknown tag' })
  await host.flush()
  expect(observer.filtered).toEqual(['failure', 'hidden', 'ordinary unknown tag'])
  expect(output.records.map(recordTag)).toEqual(['storage', 'other'])
  expect(output.records[0].entry.args[0]).toBe(payload)
  expect(output.records[0].entry.args[1]).toBe(original)
  off()
  host.policy_threshold_setLevel('debug')
  host.atLevel('debug', { tag: 'storage', message: 'allowed' })
  host.error('legacy error')
  await host.flush()
  expect(output.records.map(recordTag)).toEqual(['storage', 'other', 'storage', 'error'])
  await host.shutdown('manual')
}
/** The category assertion reads tags from delivered records, preserving the original order oracle. */
function recordTag(record: { entry: ILogEntry }): string {
  return record.entry.tag
}
it(
  'preserves category and payload while applying the original threshold and filters once',
  categoryPolicy
)
