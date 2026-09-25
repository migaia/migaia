import { describe, expect, it } from 'vitest'
import { definePlugin, PluginHost } from '../src/index.js'

/** Builds a real host with the requested number of unrelated committed registrations. */
const createHost = async (size: number): Promise<PluginHost<Record<string, never>>> => {
  /** Host whose config facade is measured after all installations finish. */
  const host = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  /** Independent registrations make lookup cost the only size-dependent read work. */
  const plugins = Array.from({ length: size }, (_, index) =>
    definePlugin({
      name: `config-${index}`,
      config: { value: index },
      install: () => ({})
    })
  )
  await host.use(...(plugins as never))
  return host
}

/** Measures one 10,000-read sample after a short JIT warmup. */
const measureConfigGet = (host: PluginHost<Record<string, never>>): number => {
  for (let index = 0; index < 1000; index += 1) host.config.get('config-0.value' as never)
  /** Monotonic clock around the exact A27 operation count. */
  const started = performance.now()
  /** Final observed value prevents timing an unused result. */
  let value: unknown
  for (let index = 0; index < 10000; index += 1) value = host.config.get('config-0.value' as never)
  expect(value).toBe(0)
  return (performance.now() - started) / 10000
}

describe('host mutation scaling', () => {
  it('A27 keeps config.get independent of unrelated registration count', async () => {
    /** Lower comparison scale from R19(d). */
    const small = await createHost(500)
    /** Higher comparison scale from R19(d). */
    const large = await createHost(4000)
    try {
      expect(measureConfigGet(large)).toBeLessThanOrEqual(2 * measureConfigGet(small))
    } finally {
      await small.dispose()
      await large.dispose()
    }
  })
})
