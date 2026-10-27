import { expect, it } from 'vitest'
import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'
import { collectorView } from './fixture.js'

it('bounds raw statistics to 4096 insertion-ordered pairs and exposes eviction', () => {
  /** Tiny event retention cannot reconstruct or hide the independent raw statistics budget. */
  const collector = devtoolsPlugin({ maxEvents: 1 }).collector
  /** Reusing one view isolates raw pair ownership from event-object retention. */
  const view = collectorView()
  try {
    for (let index = 0; index < 4096; index++) {
      view.method = `budget.method.${index}`
      collector.emit(view)
    }
    /** Updating the earliest pair must not refresh its first-insertion eviction order. */
    view.method = 'budget.method.0'
    collector.emit(view)
    view.method = 'budget.method.4096'
    collector.emit(view)
    /** The public read reports the bounded raw ownership and its lost pair count. */
    const stats = collector.stats()
    expect(stats.methods).toHaveLength(4096)
    expect(stats.evictedPairs).toBe(1)
    expect(stats.methods[0]?.method).toBe('budget.method.1')
    expect(stats.methods.at(-1)?.method).toBe('budget.method.4096')
    collector.clear()
    expect(collector.stats()).toMatchObject({ methods: [], evictedPairs: 0 })
  } finally {
    collector.close()
  }
})
