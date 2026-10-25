import { describe, expect, it } from 'vitest'
import { Logger, type ILogEntry } from '../src/index.js'
import { level } from '../src/plugins/index.js'

/** Category entries use the original level stage, filters, output snapshots and scheduling. */
describe('level category dispatch', () => {
  it('preserves category and payload while applying the original threshold and filters once', async () => {
    const entries: ILogEntry[] = []
    const filtered: string[] = []
    const logger = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      plugins: [level({ level: 'warn' })]
    })
    logger.useSink((entry) => {
      entries.push(entry)
    })
    const off = logger.addFilter((entry) => {
      filtered.push(entry.message)
      return entry.message !== 'hidden'
    })
    const original = new RangeError('original categorized failure')
    const payload = { key: 'business-key', value: { visible: true } }
    logger.atLevel('debug', { tag: 'storage', message: 'below threshold', args: [payload] })
    logger.atLevel('error', { tag: 'storage', message: 'failure', args: [payload, original] })
    logger.atLevel('error', { tag: 'storage', message: 'hidden' })
    logger.dispatchRaw({ tag: 'other', message: 'ordinary unknown tag' })
    expect(filtered).toEqual(['failure', 'hidden', 'ordinary unknown tag'])
    expect(entries.map((entry) => entry.tag)).toEqual(['storage', 'other'])
    expect(entries[0]!.args[0]).toBe(payload)
    expect(entries[0]!.args[1]).toBe(original)
    off()
    logger.setLevel('debug')
    logger.atLevel('debug', { tag: 'storage', message: 'allowed' })
    logger.error('legacy error')
    expect(entries.map((entry) => entry.tag)).toEqual(['storage', 'other', 'storage', 'error'])
    await logger.shutdown('manual')
  })
})
