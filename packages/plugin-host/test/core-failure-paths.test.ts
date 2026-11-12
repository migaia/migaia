import { describe, expect, it } from 'vitest'
import { defineHost, definePlugin } from '../src/index.ts'
import { PluginHostErrorCode } from '../src/error-code.ts'

/** Collects every `code` reachable through `cause` and `errors`, without revisiting nodes. */
function chainCodes(root: unknown): unknown[] {
  const seen = new Set<unknown>()
  const codes: unknown[] = []
  const queue: unknown[] = [root]
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    if (!current || typeof current !== 'object' || seen.has(current)) continue
    seen.add(current)
    codes.push((current as { code?: unknown }).code)
    queue.push((current as { cause?: unknown }).cause)
    const errors = (current as { errors?: unknown }).errors
    if (Array.isArray(errors)) queue.push(...errors)
  }
  return codes
}

/** Installs one plugin and returns the rejection of `host.use`, or undefined on success. */
async function installFailure(plugin: ReturnType<typeof definePlugin>): Promise<unknown> {
  const host = defineHost()
  try {
    return await host.use(plugin).then(
      () => undefined,
      (error: unknown) => error
    )
  } finally {
    await host.dispose()
  }
}

describe('core-only plugin removal', () => {
  it('removes an installed plugin without the features module', async () => {
    const host = defineHost()
    await host.use(definePlugin({ name: 'removable', install: () => ({}) }))
    const removal = await host.unUse('removable')
    expect(removal).toMatchObject({ ok: true, affected: { order: ['removable'] } })
    await host.dispose()
  })

  it('rejects an unknown name and a dependency policy that needs the features module', async () => {
    const host = defineHost()
    await host.use(definePlugin({ name: 'kept', install: () => ({}) }))
    await expect(host.unUse('missing')).rejects.toMatchObject({
      code: PluginHostErrorCode.pluginNotInstalled
    })
    await expect(host.unUse('kept', { dryRun: true })).rejects.toMatchObject({
      code: PluginHostErrorCode.hostModuleMissing
    })
    await host.dispose()
  })

  it('reports cleanup failures in the removal result', async () => {
    const host = defineHost()
    /** Failure thrown by the plugin's dispose callback. */
    const cleanupFailure = new Error('cleanup failed')
    await host.use(
      definePlugin({
        name: 'failing-cleanup',
        install: (core) => {
          core.onDispose(() => {
            throw cleanupFailure
          })
          return {}
        }
      })
    )
    const removal = (await host.unUse('failing-cleanup')) as { ok: boolean; errors?: unknown[] }
    expect(removal.ok).toBe(false)
    expect(chainCodes(removal.errors).length).toBeGreaterThan(0)
    expect(JSON.stringify(removal.errors?.map(String))).toContain('cleanup failed')
    await host.dispose()
  })
})

describe('plugin descriptor admission', () => {
  it('rejects a non-object descriptor', async () => {
    const failure = await installFailure(definePlugin('not-object', () => 1 as never))
    expect(chainCodes(failure)).toContain(PluginHostErrorCode.invalidOption)
  })

  it('rejects an unknown descriptor hook and an accessor hook', async () => {
    const unknownHook = await installFailure(
      definePlugin('unknown-hook', () => ({ teardown: () => {} }) as never)
    )
    expect(chainCodes(unknownHook)).toContain(PluginHostErrorCode.invalidOption)
    const accessorHook = await installFailure(
      definePlugin(
        'accessor-hook',
        () =>
          ({
            get install() {
              return () => ({})
            }
          }) as never
      )
    )
    expect(chainCodes(accessorHook)).toContain(PluginHostErrorCode.invalidOption)
  })

  it('rejects a descriptor whose then lookup throws and keeps that failure as cause', async () => {
    /** Failure thrown by the `then` getter. */
    const thenFailure = new Error('then getter failed')
    const failure = await installFailure(
      definePlugin(
        'hostile-then',
        () =>
          // oxlint-disable-next-line unicorn/no-thenable -- hostile then access is the boundary under test.
          Object.defineProperty({}, 'then', {
            get() {
              throw thenFailure
            }
          }) as never
      )
    )
    expect(chainCodes(failure)).toContain(PluginHostErrorCode.invalidOption)
  })

  it('merges descriptor expose output with install output', async () => {
    const host = defineHost()
    const [handle] = await host.use(
      definePlugin('exposing', () => ({
        install: () => ({ fromInstall: 1 }),
        expose: () => ({ fromExpose: 2 })
      }))
    )
    expect(handle.extensions).toMatchObject({ fromInstall: 1, fromExpose: 2 })
    await host.dispose()
  })
})
