/** Proves transport override with genuine Process and Worker children at the public boundary. */
import { expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { schema } from '@migaia/rpc-host/plugins/schema'
import { FeatureScopeFixture as Fixture, featureScopeAuth } from './fixtures/feature-scope-child.js'

it('Process overrides Host auth once and scopes schema independently from Thread', async () => {
  /** Each row is one actual signer invocation for the unique business payload. */
  const signed: { key: string; namespace: string }[] = []
  /** The Process-only parser's original failure proves that native local placement really executes. */
  const schemaFailure = new TypeError('Process accepts string arguments only')
  /** Native children verify the exact expected key, so successful echo is independent proof. */
  const host = await createRpcHost({
    plugins: [
      featureScopeAuth(Fixture.hostKey, (value, context) => {
        if (value.includes(Fixture.marker))
          signed.push({ key: Fixture.hostKey, namespace: context.namespace })
      }),
      processPlugin({
        name: 'process-child',
        namespace: 'process',
        features: [
          featureScopeAuth(Fixture.processKey, (value, context) => {
            if (value.includes(Fixture.marker))
              signed.push({ key: Fixture.processKey, namespace: context.namespace })
          }),
          schema({
            schemas: {
              echo: {
                params: {
                  parse(value: unknown) {
                    if (typeof value !== 'string') throw schemaFailure
                    return value
                  }
                },
                result: { parse: (value: unknown) => value }
              }
            }
          })
        ],
        spawn: {
          entry: new URL('./fixtures/feature-scope-process-child.ts', import.meta.url),
          args: [Fixture.processKey]
        }
      }),
      threadPlugin({
        name: 'thread-child',
        namespace: 'thread',
        spawn: {
          entry: new URL('./fixtures/feature-scope-thread-child.ts', import.meta.url),
          data: Fixture.hostKey
        }
      })
    ] as const,
    report: () => undefined
  })
  try {
    expect(await host.process.send('process-child', 'echo', Fixture.marker)).toBe(Fixture.marker)
    expect(await host.thread.send('thread-child', 'echo', Fixture.marker)).toBe(Fixture.marker)
    expect(signed).toEqual([
      { key: Fixture.processKey, namespace: 'process' },
      { key: Fixture.hostKey, namespace: 'thread' }
    ])
    await expect(host.process.send('process-child', 'echo', 42)).rejects.toMatchObject({
      code: 'SCHEMA_INVALID',
      cause: schemaFailure
    })
    expect(await host.thread.send('thread-child', 'echo', 42)).toBe(42)
  } finally {
    await host.close()
  }
}, 15000)
