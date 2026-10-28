import { describe, it } from 'vitest'
import { SEEDS } from './link-edge-model-reference.ts'
import { createModelFixture } from './link-edge-model.fixture.ts'

describe('independent ordered Set graph model', () => {
  it.each(SEEDS)(
    'matches every edge and effect execution for seed %i over 2000 steps',
    (seed) => {
      /** Each seed owns an isolated runtime, graph, callback history and PRNG state. */
      const fixture = createModelFixture(seed)
      try {
        for (let step = 0; step < 2000; step++) fixture.step(step)
      } finally {
        fixture.dispose()
      }
    },
    30000
  )
})

describe('failed tracking preserves the entire graph', () => {
  it.each(['throw', 'disposed', 'cross-runtime'] as const)(
    'preserves views and original error identity after %s',
    (kind) => {
      /** Nonempty baseline edges make premature commit or lost rollback immediately observable. */
      const fixture = createModelFixture(101)
      try {
        fixture.failure(kind)
      } finally {
        fixture.dispose()
      }
    }
  )
})
