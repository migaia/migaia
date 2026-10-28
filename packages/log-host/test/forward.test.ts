import { expect, it } from 'vitest'
import { createLogHost, forwardPlugin } from '../src/index.ts'
import { CaptureOutput, messageOf } from './fixtures/output.ts'

/**
 * Direct and multi-hop cycle checks preserve original error identity before peer installation wraps
 * it.
 */
async function forwardGraph(): Promise<void> {
  /** The target's native payload observation must survive source and target shallow snapshots. */
  const output = new CaptureOutput()
  /** Native payload identity remains meaningful across forwarding hops. */
  const payload = { value: 1 }
  /** Source and target topics are display state, separate from cycle ownership. */
  const a = createLogHost({ topic: 'a' })
  /** A second real owner proves direct reverse-edge rejection. */
  const b = createLogHost({ topic: 'b' })
  /** The final output establishes the three-host reachable path. */
  const c = createLogHost({ topic: 'c', plugins: [output.plugin()] })
  await a.use(forwardPlugin({ targets: [b] }))
  await expect(b.use(forwardPlugin({ targets: [a] }))).rejects.toMatchObject({
    source: 'logging',
    code: 'FORWARD_CYCLE'
  })
  await b.use(forwardPlugin({ targets: [c] }))
  await expect(c.use(forwardPlugin({ targets: [a] }))).rejects.toMatchObject({
    source: 'logging',
    code: 'FORWARD_CYCLE'
  })
  await expect(c.use(forwardPlugin({ targets: [c] }))).rejects.toMatchObject({
    source: 'logging',
    code: 'FORWARD_SELF'
  })
  a.log('info', 'forwarded', payload)
  await a.flush()
  expect(output.records.map(messageOf)).toEqual(['forwarded'])
  expect(output.records[0].entry.args[0]).toBe(payload)
  expect(output.records[0].entry.data.topicChain).toEqual(['a', 'b', 'c'])
  await a.shutdown('manual')
  await b.shutdown('manual')
  await c.shutdown('manual')
}
it('forwards logical entries and rejects direct/self/multi-hop cycles', forwardGraph)
