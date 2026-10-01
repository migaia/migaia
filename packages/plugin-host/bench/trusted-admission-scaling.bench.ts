import { describe, expect, it } from 'vitest'
import { definePlugin, PluginHost } from '../src/index.js'
import { openComposition } from '../src/composition-entry.js'

/** Disables unrelated host deadlines while measuring only trusted admission. */
const HOST_OPTIONS = {
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
} as const

/** Supplies the same empty domain core used by the acceptance fixture. */
class AdmissionHost extends PluginHost<Record<string, never>, unknown> {
  /** The measured route does not need a domain-specific core. */
  protected createPluginDomainCore(): Record<string, never> {
    return {}
  }
}

/** Selects the middle elapsed-time sample without changing the declared limit. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]!
}

describe('trusted admission scaling', () => {
  it('PHV3-T10: bounds the 8k to 1k median ratio by 10', async () => {
    /** The four medians preserve the original 1k, 2k, 4k, 8k dataset. */
    const medians: number[] = []
    /** Raw samples remain available to inspect a noisy benchmark failure. */
    const rawSamples: number[][] = []
    for (const size of [1000, 2000, 4000, 8000]) {
      /** Fifteen independently prepared definition sets retain the original fixture. */
      const samples: number[] = []
      for (let repeat = 0; repeat < 15; repeat += 1) {
        const plugins = Array.from({ length: size }, (_, index) =>
          definePlugin(`scale-${size}-${repeat}-${index}`, () => ({}))
        )
        const host = new AdmissionHost(HOST_OPTIONS)
        for (const plugin of plugins) openComposition(host).createPluginAdmission(plugin)
        await host.dispose()
        /** Five timed admissions use a fresh host but reuse the definitions. */
        const batchSamples: number[] = []
        for (let batch = 0; batch < 5; batch += 1) {
          const measuredHost = new AdmissionHost(HOST_OPTIONS)
          const started = process.hrtime.bigint()
          for (const plugin of plugins) openComposition(measuredHost).createPluginAdmission(plugin)
          batchSamples.push(Number(process.hrtime.bigint() - started))
          await measuredHost.dispose()
        }
        samples.push(median(batchSamples))
      }
      medians.push(median(samples))
      rawSamples.push(samples)
    }
    console.info('[PHV3-T10]', JSON.stringify({ medians, rawSamples }))
    expect(medians.at(-1)! / medians[0]).toBeLessThanOrEqual(10)
  }, 120000)
})
