import { performance } from 'node:perf_hooks'
import { planResume } from '../dist/graph/dependency.js'
import { CapabilityGraphErrorCode } from '../dist/graph/error-code.js'
import { createCapabilityGraphError, graphMessageFor } from '../dist/graph/errors.js'
import { createTopologyIndex } from '../dist/graph/topology.js'

/** Measures planner time independently of the deterministic unit test suite. */
function measure(length) {
  const index = createTopologyIndex({
    onCycle: (path) => {
      throw createCapabilityGraphError(
        CapabilityGraphErrorCode.dependencyCycle,
        graphMessageFor(CapabilityGraphErrorCode.dependencyCycle),
        { detail: { path } }
      )
    },
    onInvalid: (reason, nodeId) => {
      throw createCapabilityGraphError(
        CapabilityGraphErrorCode.invalidNode,
        graphMessageFor(CapabilityGraphErrorCode.invalidNode),
        { detail: { reason, nodeId } }
      )
    }
  })
  index.add({ id: 'p', dependencies: [] })
  for (let position = 0; position < length; position += 1)
    index.add({
      id: `chain-${position}`,
      dependencies: [{ provider: position === 0 ? 'p' : `chain-${position - 1}`, required: true }]
    })
  const state = () => ({ activated: true, enabled: true, suspended: false, stale: false })
  const samples = []
  for (let run = 0; run < 3; run += 1) {
    const startedAt = performance.now()
    for (let iteration = 0; iteration < 1_000; iteration += 1)
      planResume(index, state, {
        provider: 'p',
        generationChanged: true,
        canRebind: () => false
      })
    samples.push(performance.now() - startedAt)
  }
  return samples.sort((left, right) => left - right)[1]
}

const small = measure(100)
const large = measure(2_000)
console.log(JSON.stringify({ smallMs: small, largeMs: large, ratio: large / small }))
