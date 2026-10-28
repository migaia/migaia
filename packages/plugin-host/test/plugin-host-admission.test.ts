import { describe, expect, it } from 'vitest'

import { PluginHostError } from '../src/error-text.js'
import { Host, plugin } from './plugin-host-fixtures.js'

describe('PluginHost', () => {
  it('snapshots plugin definitions at admission and preserves hook receiver', async () => {
    const host = new Host()
    const pluginInstance = {
      name: 'snapshot-a',
      count: 0,
      install() {
        this.count += 1
        return { marker: 'a' }
      }
    }
    const installing = host.use(pluginInstance as never)
    pluginInstance.name = 'snapshot-b'
    pluginInstance.install = () => ({ marker: 'b' })
    await installing
    expect(pluginInstance.count).toBe(1)
    expect(((await installing) as any)[0].extensions.marker).toBe('a')
  })

  it('uses the admitted install snapshot after caller mutation', async () => {
    const host = new Host()
    const secondPlugin = {
      name: 'queued-snapshot',
      install: () => ({ marker: 'admitted' })
    }
    const second = host.use(secondPlugin as never)
    secondPlugin.install = () => ({ marker: 'mutated' })
    const handles = (await second) as any
    expect(handles[0].extensions.marker).toBe('admitted')
  })

  it('rejects duplicate names in one use admission', async () => {
    const host = new Host()
    const first = plugin('same', () => ({}))
    expect(() => host.use(first, first)).toThrow(PluginHostError)
  })

  it('rejects malformed lifecycle hooks during admission', async () => {
    const host = new Host()
    expect(() => host.use({ name: 'invalid-hook', install: 1 } as never)).toThrow(TypeError)
  })

  it('rejects class and inherited-then extension results before mounting', async () => {
    const host = new Host()
    class Extension {}
    await expect(
      host.use(plugin('class-extension', () => new Extension() as never))
    ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
    const inheritedThen = Object.create({})
    const thenKey = ['t', 'h', 'e', 'n'].join('')
    Object.defineProperty(Object.getPrototypeOf(inheritedThen), thenKey, {
      get() {
        throw new Error('inherited then accessed')
      }
    })
    await expect(host.use(plugin('inherited-then', () => inheritedThen))).rejects.toThrow()
    expect(host).not.toHaveProperty('marker')
  })

  it('rejects an external mutation during another plugin lifecycle', async () => {
    const order: string[] = []
    const host = new Host()
    const first = host.use(
      plugin('a', async () => {
        order.push('a:start')
        await Promise.resolve()
        order.push('a:end')
        return {}
      })
    )
    expect(() => host.use(plugin('b', () => ({ marker: 'b' })))).toThrow(PluginHostError)
    await first
    expect(order).toEqual(['a:start', 'a:end'])
  })

  it('rejects a mutation admitted during an earlier lifecycle hook', async () => {
    const host = new Host()
    const order: string[] = []
    const first = host.use(
      plugin('queue-a', async () => {
        order.push('a:start')
        await Promise.resolve()
        order.push('a:end')
        return {}
      })
    )
    expect(() =>
      host.use(
        plugin('queue-b', () => {
          order.push('b')
          return {}
        })
      )
    ).toThrow(PluginHostError)
    await first
    const third = host.use(
      plugin('queue-c', () => {
        order.push('c')
        return {}
      })
    )
    await third
    expect(order).toEqual(['a:start', 'a:end', 'c'])
  })

  it('rolls back failed batch in reverse order without touching old registrations', async () => {
    const disposed: string[] = []
    const host = new Host()
    await host.use(
      plugin('old', () => ({}), {
        dispose: () => {
          disposed.push('old')
        }
      })
    )
    await expect(
      host.use(
        plugin('a', () => ({}), {
          dispose: () => {
            disposed.push('a')
          }
        }),
        plugin('b', () => {
          throw new Error('failed')
        }),
        plugin('c', () => ({ marker: 'c' }))
      )
    ).rejects.toThrow('failed')
    expect(disposed).toEqual(['a'])
    expect(host).not.toHaveProperty('marker')
    await host.dispose()
    expect(disposed).toEqual(['a', 'old'])
  })
})
