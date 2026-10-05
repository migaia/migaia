import { runtimeTestHost } from './fixture.js'
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { definePlugin, defineFeature } from '@migaia/plugin-host'
import { createThreadPlugin } from '../../src/threads/plugin.js'
import { runtimeSources } from './fixture.js'

/** Native cause and AggregateError membership must retain the exact original fixture error. */
function reaches(value: unknown, expected: Error): boolean {
  if (value === expected) return true
  if (value instanceof AggregateError && value.errors.some((error) => reaches(error, expected)))
    return true
  return value instanceof Error && reaches(value.cause, expected)
}

it('[A33][A34] a real prepared shared-slot candidate rolls back without revoking committed siblings', async () => {
  /** Original Host disposal reports retain the native failures from the failed batch. */
  const diagnostics: unknown[] = []
  /** Every registration belongs to a true managed Host and the original atomic batch owner. */
  const owner = runtimeTestHost({
    host: {
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      diagnostic: (_text, _code, error) => diagnostics.push(error)
    }
  })
  /** Separate physical endpoints cannot share pending, providers, stream or rollback resources. */
  const targets = [
    runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    }),
    runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
  ] as const
  /** Both sources prove actual capability agreement and deliver through the existing carrier owner. */
  const carriers = [runtimeSources(), runtimeSources()] as const
  /** The primary installation error must stay reachable independently of cleanup errors. */
  const primary = new TypeError('candidate batch fixture primary')
  /** A separately failing channel cleanup cannot replace the original batch failure. */
  const cleanup = new RangeError('candidate channel fixture cleanup')
  /** Canonical rollback invokes this acquired channel disposer exactly once. */
  let closes = 0
  /** Source reports retain the same native cleanup object if the original owner reports it there. */
  const reports: unknown[] = []
  try {
    for (const target of targets)
      await target.use(
        definePlugin({
          name: 'service',
          features: { data: defineFeature(() => ({ read: () => 42 })) },
          install: () => ({})
        })
      )
    await Promise.all([
      owner.use(
        createThreadPlugin({
          name: 'first',
          connect: carriers[0].sources[0],
          report: (error) => reports.push(error)
        })
      ),
      targets[0].use(
        createThreadPlugin({
          name: 'first',
          connect: carriers[0].sources[1],
          expose: ['service'],
          report: (error) => reports.push(error)
        })
      )
    ])
    /** The first facade was genuinely committed before this failing candidate was admitted. */
    const outlet = owner.thread!
    /** A later candidate must never leak readiness through the already committed facade. */
    const ready: string[] = []
    outlet.on('ready', (event) => ready.push(event.name))
    assert.equal(await outlet.request('first', 'service.read'), 42)
    /** Candidate construction uses the true public Peer through the ordinary managed definition. */
    const candidate = createThreadPlugin({
      name: 'candidate',
      connect: async (context) => {
        /** Only acquired channel cleanup is faulted; real envelope delivery remains unchanged. */
        const channel = await carriers[1].sources[0](context)
        return {
          ...channel,
          close: async () => {
            closes += 1
            await channel.close()
            throw cleanup
          }
        }
      },
      report: (error) => reports.push(error)
    })
    /** A later real installation in the same batch fails after candidate acquisition has completed. */
    const failing = definePlugin({
      name: 'failure',
      install: () => {
        throw primary
      }
    })
    /** Original batch rejection is observed before asserting the unchanged published facade. */
    const failed = owner.use(candidate, failing).then(
      () => undefined,
      (error: unknown) => error
    )
    await targets[1].use(
      createThreadPlugin({
        name: 'candidate',
        connect: carriers[1].sources[1],
        expose: ['service'],
        report: (error) => reports.push(error)
      })
    )
    /** The original install wrapper retains its primary error rather than the cleanup failure. */
    const rejection = await failed
    assert.equal((rejection as Error).cause, primary)
    assert.equal(closes, 1)
    assert.equal(owner.thread, outlet, '[A34] candidate rollback cannot retire the existing slot')
    assert.deepEqual(ready, [], '[A52] rollback publishes no candidate ready event')
    await assert.rejects(outlet.get('candidate'), { code: 'TARGET_UNKNOWN' })
    assert.equal(await outlet.request('first', 'service.read'), 42)
    /** The original Host diagnostic contains cleanup through its existing aggregate/detail shape. */
    assert.ok(
      diagnostics.some((error) => reaches(error, cleanup)),
      '[A33] original cleanup is reachable through the reported aggregate'
    )
  } finally {
    await owner.dispose()
    for (const target of targets) await target.dispose()
    for (const carrier of carriers) carrier.close()
  }
})
