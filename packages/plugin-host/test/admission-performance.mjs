import { definePlugin, PluginHost } from '../dist/index.js'

class BenchmarkHost extends PluginHost {
  createPluginDomainCore() {
    return {}
  }
}

const hostOptions = {
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
}

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

const elapsed = (callback) => {
  const started = process.hrtime.bigint()
  callback()
  return Number(process.hrtime.bigint() - started)
}

const genericSamples = []
const coldTrustedSamples = []
const warmTrustedSamples = []
const warmPlugin = definePlugin('benchmark-warm', () => ({}))
for (let index = 0; index < 15; index += 1) {
  const genericHost = new BenchmarkHost(hostOptions)
  genericSamples.push(
    elapsed(() =>
      genericHost.createPluginAdmission({
        name: `benchmark-generic-${index}`,
        config: { index },
        install: () => ({}),
        update: () => {},
        shared: () => ({}),
        dispose: () => {},
        marker: `benchmark-generic-${index}`
      })
    )
  )
  await genericHost.dispose()

  const coldHost = new BenchmarkHost(hostOptions)
  coldTrustedSamples.push(
    elapsed(() =>
      coldHost.createPluginAdmission(definePlugin(`benchmark-cold-${index}`, () => ({})))
    )
  )
  await coldHost.dispose()

  const warmHost = new BenchmarkHost(hostOptions)
  warmTrustedSamples.push(elapsed(() => warmHost.createPluginAdmission(warmPlugin)))
  await warmHost.dispose()
}

const scaling = []
for (const size of [1000, 2000, 4000, 8000]) {
  const samples = []
  for (let repeat = 0; repeat < 15; repeat += 1) {
    const plugins = Array.from({ length: size }, (_, index) =>
      definePlugin(`benchmark-scale-${size}-${repeat}-${index}`, () => ({}))
    )
    const warmHost = new BenchmarkHost(hostOptions)
    for (const plugin of plugins) warmHost.createPluginAdmission(plugin)
    await warmHost.dispose()
    const batchSamples = []
    for (let batch = 0; batch < 5; batch += 1) {
      const measuredHost = new BenchmarkHost(hostOptions)
      batchSamples.push(
        elapsed(() => {
          for (const plugin of plugins) measuredHost.createPluginAdmission(plugin)
        })
      )
      await measuredHost.dispose()
    }
    samples.push(median(batchSamples))
  }
  scaling.push({ size, samples, median: median(samples) })
}

const result = {
  node: process.version,
  t09: {
    genericSamples,
    coldTrustedSamples,
    warmTrustedSamples,
    medians: {
      generic: median(genericSamples),
      coldTrusted: median(coldTrustedSamples),
      warmTrusted: median(warmTrustedSamples)
    }
  },
  t10: scaling
}
const t09 = result.t09.medians
const ratios = scaling.slice(1).map((entry, index) => entry.median / scaling[index].median)
if (t09.coldTrusted > t09.generic * 1.1 || t09.warmTrusted > t09.generic * 0.8)
  throw new Error('PHV3-T09 performance oracle failed')
if (ratios.some((ratio) => ratio > 2.5)) throw new Error('PHV3-T10 scaling oracle failed')
console.log(JSON.stringify({ ...result, t10Ratios: ratios }))
