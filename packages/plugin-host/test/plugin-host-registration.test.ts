import { describe, expect, it } from 'vitest'

import { PluginHostError } from '../src/error-text.ts'
import { type IExt, Host, plugin } from './plugin-host-fixtures.ts'

describe('PluginHost', () => {
  it('keeps plugin stage and resource registration available across async install', async () => {
    const host = new Host()
    await host.use(
      plugin('async-registration', async (core) => {
        core.usePipeline((value, next) => next(value + 1))
        await Promise.resolve()
        core.usePipeline((value, next) => next(value * 2))
        core.onDispose(() => undefined)
        return {}
      })
    )
    expect(host.run(1)).toBe(4)
  })

  it('drains resources registered by another resource disposer', async () => {
    const host = new Host()
    const calls: string[] = []
    await host.use(
      plugin('resource-drain', (core) => {
        core.onDispose(() => {
          calls.push('first')
          core.onDispose(() => {
            calls.push('late')
          })
        })
        return {}
      })
    )
    const result = await host.unUse('resource-drain')
    expect(result).toMatchObject({ ok: false, errors: expect.any(Array) })
    expect(calls).toEqual(['first'])
  })

  it('rejects pipeline registration during dispose and leaves no leaked stage', async () => {
    const host = new Host()
    let core: IExt | undefined
    await host.use(
      plugin(
        'dispose-stage',
        (received) => {
          core = received
          return {}
        },
        {
          dispose: () => {
            core?.usePipeline((value, next) => next(value + 100))
          }
        }
      )
    )
    const result = await host.unUse('dispose-stage')
    expect(result).toMatchObject({ ok: false, errors: expect.any(Array) })
    expect(host.run(1)).toBe(1)
  })

  it('rejects pipeline and resource registration during update', async () => {
    const host = new Host()
    let core: IExt | undefined
    await host.use(
      plugin(
        'update-lifecycle',
        (received) => {
          core = received
          return {}
        },
        {
          update: () => {
            expect(() =>
              core?.usePipeline((value, next: (value: number) => void) => next(value + 1))
            ).toThrow('install')
            expect(() => core?.onDispose(() => undefined)).toThrow('install')
          }
        }
      )
    )
    await host.config.update('update-lifecycle', () => ({}))
    expect(host.run(1)).toBe(1)
  })

  it.each(['sync', 'async', 'generator', 'async-generator'] as const)(
    'keeps stage/resource ownership aligned across %s lifecycle',
    async (mode) => {
      const host = new Host({ pipeline: { mode } })
      let core: IExt | undefined
      await host.use(
        plugin(
          `lifecycle-${mode}`,
          (received) => {
            core = received
            received.usePipeline((_value, next) => next(1))
            received.onDispose(() => undefined)
            return {}
          },
          {
            config: { enabled: true },
            update: () => {
              expect(() => core?.usePipeline((_value, next) => next(1))).toThrow('install')
              expect(() => core?.onDispose(() => undefined)).toThrow('install')
            },
            dispose: () => {
              expect(() => core?.usePipeline((_value, next) => next(1))).toThrow('install')
              expect(() => core?.onDispose(() => undefined)).toThrow('install')
            }
          }
        )
      )
      await host.config.update(`lifecycle-${mode}`, () => ({ enabled: false }))
      await expect(host.unUse(`lifecycle-${mode}`)).resolves.toMatchObject({ ok: true })
      const result = host.run(1)
      if (mode === 'async' || mode === 'async-generator') await expect(result).resolves.toBe(1)
      else expect(result).toBe(1)
    }
  )

  it('rejects stage registration during sync pipeline execution', () => {
    const host = new Host()
    expect(() =>
      host.usePipeline((value, next) => {
        expect(() => host.usePipeline((_value, nextValue) => nextValue)).toThrow('pipeline')
        next(value)
      })
    ).not.toThrow()
    expect(host.run(1)).toBe(1)
  })

  it.each(['async', 'generator'] as const)(
    'rejects nested stage registration during %s pipeline execution',
    async (mode) => {
      const host = new Host({ pipeline: { mode } })
      if (mode === 'async') {
        host.useAsyncPipeline(async (value, next) => {
          expect(() =>
            host.useAsyncPipeline(async (_nextValue, nextValue) => nextValue(1))
          ).toThrow(PluginHostError)
          await next(value)
        })
        await expect(host.run(1)).resolves.toBe(1)
      } else {
        host.useGeneratorPipeline(function* (value) {
          expect(() =>
            host.useGeneratorPipeline(function* (nextValue) {
              return nextValue
            })
          ).toThrow(PluginHostError)
          return value
        })
        expect(host.run(1)).toBe(1)
      }
    }
  )

  it('throws nested mutations from synchronous lifecycle callbacks', async () => {
    const host = new Host()
    await expect(
      host.use({
        name: 'outer-install',
        install: () => {
          expect(() => host.use({ name: 'nested-install', install: () => ({}) })).toThrow(
            PluginHostError
          )
          return {}
        }
      } as never)
    ).resolves.toHaveLength(1)
  })

  it('validates and isolates diagnostic callbacks', () => {
    expect(() => new Host({ diagnostic: 42 } as never)).toThrow(TypeError)
    const host = new Host({
      diagnostic: () => {
        throw new Error('diagnostic failed')
      }
    })
    expect(() => {
      host.usePipeline((_value, next) => {
        setTimeout(() => next(1), 0)
      })
    }).not.toThrow()
  })
})
