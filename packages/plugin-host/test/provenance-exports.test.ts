import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import * as pluginHostPublic from '../src/index.js'

const forbiddenProvenanceExports = [
  'markPluginHostDisposalNode',
  'pluginHostDisposalProvenanceKey'
] as const

describe('PluginHost provenance authority', () => {
  it('keeps registration authority absent from source and built public exports', async () => {
    for (const exportName of forbiddenProvenanceExports)
      expect(pluginHostPublic).not.toHaveProperty(exportName)

    const builtRuntime = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8')
    const builtTypes = await readFile(new URL('../dist/index.d.ts', import.meta.url), 'utf8')
    for (const exportName of forbiddenProvenanceExports) {
      expect(builtRuntime).not.toContain(exportName)
      expect(builtTypes).not.toContain(exportName)
    }
  })
})
