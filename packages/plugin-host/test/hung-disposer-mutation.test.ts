/** A disposer that outlives its bounded cleanup step must not keep the Host locked. */
import { describe, expect, it } from 'vitest'
import { defineHost, definePlugin } from '../src/index.ts'

/** Creates a Host whose bounded disposer step is short enough for real-time tests. */
function createHost() {
  return defineHost({
    host: {
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      disposeStepTimeoutMs: 10
    }
  })
}

describe('hung plugin disposer', () => {
  it('accepts new mutations once the bounded dispose step has returned', async () => {
    const host = createHost()
    /** Resolves the hung disposer at the end so the Host can finish cleanly. */
    let finish: (() => void) | undefined
    await host.use(
      definePlugin({
        name: 'hung',
        install: () => ({}),
        dispose: () =>
          new Promise<void>((resolve) => {
            finish = resolve
          })
      })
    )
    const removal = await host.unUse('hung')
    expect(removal.ok).toBe(false)
    await expect(
      host.use(definePlugin({ name: 'after', install: () => ({ ready: true }) }))
    ).resolves.toHaveLength(1)
    finish?.()
    await host.dispose()
  })

  it('does not clear a later hook mark when the hung disposer settles late', async () => {
    const host = createHost()
    /** Resolves the hung disposer while a later setup hook is still running. */
    let finish: (() => void) | undefined
    await host.use(
      definePlugin({
        name: 'hung',
        install: () => ({}),
        dispose: () =>
          new Promise<void>((resolve) => {
            finish = resolve
          })
      })
    )
    await host.unUse('hung')
    /** Releases the later setup hook after the late disposer settlement. */
    let releaseSetup: (() => void) | undefined
    /** Error from a mutation attempted inside the later hook, after the late settlement. */
    let nestedError: unknown
    const installing = host.use(
      definePlugin({
        name: 'slow',
        setup: async () => {
          await new Promise<void>((resolve) => {
            releaseSetup = resolve
          })
          try {
            void host.use(definePlugin({ name: 'nested', install: () => ({}) }))
          } catch (error) {
            nestedError = error
          }
        },
        install: () => ({})
      })
    )
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    finish?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    releaseSetup?.()
    await installing
    expect(nestedError).toMatchObject({ code: 'LIFECYCLE_MUTATION' })
    await host.dispose()
  })
})
