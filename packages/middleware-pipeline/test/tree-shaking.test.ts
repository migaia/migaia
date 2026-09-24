import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { build } from 'vite'

/** Type-and-constant-only fixture resolved through the package public boundary. */
const MODE_ENTRY_PATH = fileURLToPath(new URL('./fixtures/mode-entry.ts', import.meta.url))

/** Builds one fixture in memory and returns the emitted production code. */
const bundleFixture = async (entry: string): Promise<string> => {
  const result = (await build({
    configFile: false,
    logLevel: 'silent',
    build: { write: false, lib: { entry, formats: ['es'] } }
  })) as
    | { readonly output: readonly { readonly type: string; readonly code?: string }[] }
    | readonly {
        readonly output: readonly { readonly type: string; readonly code?: string }[]
      }[]
  const outputs = Array.isArray(result) ? result : [result]
  return outputs
    .flatMap((output) => output.output)
    .filter((item) => item.type === 'chunk')
    .map((item) => item.code ?? '')
    .join('\n')
}

describe('tree shaking', () => {
  it('A7 removes all runners from a type-and-constant-only bundle', async () => {
    /** Emitted fixture code must retain its function without retaining execution paths. */
    const code = await bundleFixture(MODE_ENTRY_PATH)

    expect(code).toContain('readSyncMode')
    expect(code).not.toContain('runSyncMiddleware')
    expect(code).not.toContain('runAsyncMiddleware')
    expect(code).not.toContain('runGeneratorMiddleware')
    expect(code).not.toContain('runAsyncGeneratorMiddleware')
  })
})
