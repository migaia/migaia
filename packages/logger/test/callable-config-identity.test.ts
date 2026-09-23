import { describe, expect, it } from 'vitest'
import { Logger } from '../src/log.js'
import { level, type ILevelPluginExt } from '../src/plugins/level.js'

/**
 * Callable config values keep their identity across the host's config copy.
 *
 * The case lives here rather than in `@migaia/plugin-host` because it needs a real downstream
 * consumer of the host, and `@migaia/logger` already depends on the host — the reverse edge would
 * be a dependency cycle. It observes the host's guarantee, not the logger's: a function stored in
 * plugin config must come back as the same reference, or `removeFilter` has nothing to match.
 */
describe('callable config identity', () => {
  it('supports logger filter removal', () => {
    /** Messages the sink actually received, so a blocked entry is observable as absence. */
    const seen: string[] = []
    /** The subject: stored in plugin config, later matched by identity rather than by value. */
    const filter = () => false
    const logger = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      plugins: [level({ filters: [filter] })]
    })
    logger.useSink((entry) => {
      seen.push(entry.message)
    })
    // The level plugin's extension is published onto the logger instance by its constructor; the
    // copy is made with `Object.defineProperty`, so the surface exists at runtime but not in the
    // class type.
    const extension = logger as unknown as ILevelPluginExt
    logger.log('info', 'blocked')
    expect(seen).toEqual([])
    extension.removeFilter(filter)
    logger.log('info', 'allowed')
    expect(seen).toEqual(['allowed'])
  })
})
