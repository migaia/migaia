import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
/** The original repository export owner carries this package's finite five-entry inventory. */
const baseline = JSON.parse(
  readFileSync(
    new URL('../../../scripts/fixtures/public-exports.baseline.json', import.meta.url),
    'utf8'
  )
) as { packages: Record<string, Record<string, readonly string[]>> }
describe('SPARQL public entries', () => {
  it('keeps native adapters and Features behind their declared entries', async () => {
    const entries = {
      '.': await import('@migaia/storage-plugin-sparql'),
      './http': await import('@migaia/storage-plugin-sparql/http'),
      './oxigraph': await import('@migaia/storage-plugin-sparql/oxigraph'),
      './features/graph-store': await import('@migaia/storage-plugin-sparql/features/graph-store'),
      './features/ontology': await import('@migaia/storage-plugin-sparql/features/ontology')
    }
    for (const [entry, exports] of Object.entries(entries))
      expect(Object.keys(exports).sort()).toEqual(
        baseline.packages['@migaia/storage-plugin-sparql']![entry]
      )
    expect(entries['.'].ERROR_SOURCE).toBe('storage.backend.sparql')
    expect(entries['.']).not.toHaveProperty('oxigraphEndpoint')
    expect(entries['.']).not.toHaveProperty('graphStoreFeature')
  })
})
