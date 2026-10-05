import { runtimeTestHost } from './fixture.js'
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { definePlugin, defineFeature } from '@migaia/plugin-host'
import { createThreadPlugin } from '../../src/threads/plugin.js'
import { runtimeSources } from './fixture.js'

it('[A11][A33] one genuine Host batch exposes the real Feature prepared before its connection', async () => {
  /** Both managed Hosts keep original batch visibility and commit semantics. */
  const hosts = [
    runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    }),
    runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
  ] as const
  /** Actual independent offers use the existing carrier rather than a fixture method dispatcher. */
  const carrier = runtimeSources()
  try {
    for (const host of hosts) {
      /** Ordinary multi-definition installation succeeds before the new mixed-batch assertion. */
      const [baseline] = await host.use(
        definePlugin({
          name: 'baseline',
          features: { data: defineFeature(() => ({ read: () => 42 })) },
          install: () => ({})
        }),
        definePlugin({ name: 'ordinary', install: () => ({}) })
      )
      assert.equal(baseline.getFeature('data').read(), 42)
    }
    /** The two true batches must prepare their prior Feature while endpoints exchange directories. */
    const results = await Promise.allSettled(
      hosts.map((host, index) =>
        host.use(
          definePlugin({
            name: 'service',
            features: { data: defineFeature(() => ({ read: () => 42 })) },
            install: () => ({})
          }),
          createThreadPlugin({
            name: 'remote',
            connect: carrier.sources[index]!,
            expose: ['service'],
            report: () => undefined
          })
        )
      )
    )
    assert.deepEqual(
      results.filter((result) => result.status === 'rejected'),
      [],
      '[A11] same-batch actual Feature exposure must prepare and commit'
    )
    for (const host of hosts) assert.equal(await host.thread!.request('remote', 'service.read'), 42)
  } finally {
    for (const host of hosts) await host.dispose()
    carrier.close()
  }
})
