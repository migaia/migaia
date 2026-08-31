import { performance } from 'node:perf_hooks'
import { collect, get, parseObjectPath, probeObjectPathSegments } from '../dist/index.js'

/** Dataset sizes cover empty, tiny, medium, and throughput-sensitive collector workloads. */
const sizes = [1, 8, 64, 1_024, 100_000]
/** Field counts expose path-loop overhead without introducing data-dependent strategy changes. */
const fieldCounts = [1, 2, 4]

/** Builds deterministic nested records shared by every benchmark candidate. */
function createSource(size) {
  return Array.from({ length: size }, (_, index) => ({
    id: index,
    profile: {
      name0: index % 3 === 0 ? `World ${index}` : `User ${index}`,
      name1: index % 5 === 0 ? `World ${index}` : undefined,
      name2: index % 7 === 0 ? `World ${index}` : undefined,
      name3: index % 11 === 0 ? `World ${index}` : undefined
    }
  }))
}

/** Returns a stable median after warming the JIT without imposing a CI timing threshold. */
function measure(run, iterations) {
  for (let index = 0; index < 5; index++) run()
  const samples = []
  for (let sample = 0; sample < 7; sample++) {
    const startedAt = performance.now()
    for (let index = 0; index < iterations; index++) run()
    samples.push((performance.now() - startedAt) / iterations)
  }
  samples.sort((left, right) => left - right)
  return samples[Math.floor(samples.length / 2)]
}

/** Counts records using a direct loop baseline over the chosen dynamic field names. */
function directCount(source, names) {
  let count = 0
  for (const item of source) {
    for (const name of names) {
      const value = item.profile[name]
      if (typeof value === 'string' && value.toLowerCase().includes('world')) {
        count++
        break
      }
    }
  }
  return count
}

/** Counts matches through the existing public `get` helper. */
function getCount(source, paths) {
  let count = 0
  for (const item of source) {
    for (const path of paths) {
      const value = get(item, path)
      if (typeof value === 'string' && value.toLowerCase().includes('world')) {
        count++
        break
      }
    }
  }
  return count
}

/** Counts matches through pre-parsed diagnostic probes. */
function probeCount(source, paths) {
  let count = 0
  for (const item of source) {
    for (const path of paths) {
      const probe = probeObjectPathSegments(item, path)
      if (
        probe.kind === 'value' &&
        typeof probe.value === 'string' &&
        probe.value.toLowerCase().includes('world')
      ) {
        count++
        break
      }
    }
  }
  return count
}

/** Runs and prints the non-gating performance matrix as newline-delimited JSON. */
function main() {
  for (const size of sizes) {
    const source = createSource(size)
    const iterations = Math.max(1, Math.floor(100_000 / Math.max(1, size)))
    for (const fieldCount of fieldCounts) {
      const names = Array.from({ length: fieldCount }, (_, index) => `name${index}`)
      const paths = names.map((name) => `profile.${name}`)
      const parsedPaths = paths.map((path) => parseObjectPath(path))
      const cases = {
        direct: () => directCount(source, names),
        get: () => getCount(source, paths),
        probe: () => probeCount(source, parsedPaths),
        field: () => collect(source).fieldBy(...paths).result.length,
        fusedLike: () =>
          collect(source)
            .fieldBy(...paths)
            .like('world').result.length,
        orderedPipeline: () =>
          collect(source)
            .fieldBy(...paths)
            .where(() => true)
            .like('world').result.length
      }
      for (const [name, run] of Object.entries(cases)) {
        console.log(JSON.stringify({ size, fieldCount, name, medianMs: measure(run, iterations) }))
      }
    }
  }
}

main()
