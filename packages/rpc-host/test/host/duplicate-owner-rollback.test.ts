/** Original rollback side effects belong to the genuine native installation transaction. */
import { defineHost, definePlugin } from '@migaia/plugin-host'
import { expect, it } from 'vitest'

it('rolls back native resources and public publication without replacing the install cause', async () => {
  /** The native Host is the original batch, config and resource owner, with no RPC facade. */
  const host = defineHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Count only the resource actually acquired by the first native installation. */
  const lifetime = { cleanupCalls: 0 }
  /** A later install failure must remain the batch rejection's original cause. */
  const primary = new Error('candidate-007 failure')
  /** The first plugin lends its public extension and resource to this exact transaction. */
  const first = definePlugin({
    name: 'candidate-007-first',
    config: { enabled: true },
    install: (core) => {
      core.onDispose(() => {
        lifetime.cleanupCalls += 1
      })
      return { candidate007Extension: () => 'extension' }
    }
  })
  /** Reject after the first resource is owned, so native rollback must actually release it. */
  const second = definePlugin({
    name: 'candidate-007-second',
    install: () => {
      throw primary
    }
  })
  try {
    await expect(host.use(first, second)).rejects.toMatchObject({ cause: primary })
    expect(lifetime.cleanupCalls).toBe(1)
    expect(Object.hasOwn(host, 'candidate007Extension')).toBe(false)
    expect(host.config.get('candidate-007-first')).toBeUndefined()
  } finally {
    /** The failed native batch has released its real resources before this original terminal. */
    const outcome = await host.dispose()
    expect(outcome).toMatchObject({
      logicalTerminal: true,
      cleanupComplete: true,
      cleanupErrors: []
    })
  }
})
