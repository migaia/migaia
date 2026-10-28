import { expect, it } from 'vitest'
import { createLogHost, levelPlugin } from '../src/index.ts'
import { defineOutputPlugin } from '../src/plugin.ts'
import type { ILogOutputRecord } from '../src/plugin.ts'

/** The output fixture owns its observations without nested test callbacks. */
class EntryCapture {
  /** Records only completed output calls, independently of producer return values. */
  readonly seen: string[] = []
  /** A real output registration observes host scheduling and level extension inference. */
  plugin() {
    return defineOutputPlugin({
      name: 'capture',
      batchable: true,
      defaultFormat: 'json',
      deliver: (records: readonly ILogOutputRecord[]) => this.deliver(records)
    })
  }
  /** Keep the output loop separate from its forwarding callback. */
  deliver(records: readonly ILogOutputRecord[]): void {
    for (const record of records) this.seen.push(`${record.entry.tag}:${record.entry.message}`)
  }
}

/** The original RED case remains pending until the SDK output installation contract is complete. */
async function entryDelivery(): Promise<void> {
  /** The fixture retains output observations independently of the host. */
  const capture = new EntryCapture()
  /** The host owns the output and its delivery barrier. */
  const host = createLogHost({ plugins: [levelPlugin(), capture.plugin()] })
  expect(Object.isFrozen(host)).toBe(true)
  expect(host.info('a')).toBeUndefined()
  expect(capture.seen).toEqual([])
  await host.flush()
  expect(capture.seen).toEqual(['info:a'])
  await host.shutdown('manual')
}

it('returns before delivery and flushes standard level entries in order', entryDelivery)
