import { describe, expect, it, vi } from 'vitest'
import { defineFeature, definePlugin } from '@migaia/plugin-host'
import { createManualScheduler } from '@migaia/utils/scheduler'
import * as remotePlugin from '../../src/remote/plugin.js'
import { createNodeThreadChannelFactory } from '../../src/threads/adapters/node.js'
import { nativeFixture } from './fixture.js'

/** Public assembly must publish only after describe and use no message handshake. */
describe('thread Plugin facade', () => {
  it('[A1] installs a real Worker and immediately calls its declared Feature', async () => {
    const fixture = nativeFixture()
    try {
      const feature = await fixture.install()
      expect(await feature.read(['value'])).toBe('value')
      const stream = feature.stream(['stream item'])
      expect(await stream.next()).toMatchObject({ value: 'stream item', done: false })
      await stream.return?.(undefined)
      expect(fixture.frames[0]?.message.method).toBe('migaia.remote.describe')
      expect(fixture.frames.some(({ message }) => message.kind === 'hello')).toBe(false)
      expect(fixture.frames.every(({ transfer }) => transfer === undefined)).toBe(true)
      expect(fixture.budget.inUse).toBe(1)
    } finally {
      await fixture.close()
    }
    expect(fixture.budget.inUse).toBe(0)
    expect(fixture.handles).toHaveLength(1)
    expect(fixture.handles[0]?.identity.threadId).toBeGreaterThan(0)
  })
  it('[A1] prepares a dependent install and preserves scheduler identity at every boundary', async () => {
    const scheduler = createManualScheduler()
    const assembly = vi.spyOn(remotePlugin, 'createRemotePlugin')
    const fixture = nativeFixture({ scheduler })
    let firstCall: Promise<unknown> | undefined
    const dependent = definePlugin({
      name: 'dependent',
      features: {
        use: defineFeature(
          (_core, dependencies) => {
            firstCall = (dependencies.thread as { read(params: unknown[]): Promise<unknown> }).read(
              ['install call']
            )
            return {}
          },
          { thread: fixture.plugin.getFeature('f') }
        )
      },
      install: () => ({})
    })
    try {
      await fixture.host.use(fixture.plugin)
      await fixture.host.use(dependent)
      expect(await firstCall).toBe('install call')
      const options = assembly.mock.calls.at(-1)![0]
      expect(Object.hasOwn(options, 'retryPort')).toBe(false)
      expect(options.binding.scheduler).toBe(scheduler)
      const controller = new AbortController()
      const channel = await options.binding.openChannel(fixture.handles[0]!, controller.signal)
      expect(channel.scheduler).toBe(scheduler)
      expect(channel.peerId).toBe(fixture.handles[0]!.identity.fingerprint)
      await channel.close()
    } finally {
      await fixture.close()
      assembly.mockRestore()
    }
    expect(scheduler.pendingCount).toBe(0)
  })
  it('[A1] rejects scheduler mismatch before endpoint or business publication', async () => {
    const scheduler = createManualScheduler()
    const factory = vi.fn()
    const fixture = nativeFixture({
      scheduler,
      channelFactory: createNodeThreadChannelFactory({ scheduler: createManualScheduler() }),
      endpointFactory: factory
    })
    try {
      await expect(fixture.install()).rejects.toMatchObject({
        code: 'PLUGIN_INSTALL_FAILED',
        cause: { code: 'INVALID_CONFIG' }
      })
      expect(factory).not.toHaveBeenCalled()
      expect(fixture.frames).toHaveLength(0)
    } finally {
      await fixture.close()
    }
  })
  it('[A1] rejects missing stream capability before endpoint creation or business frame', async () => {
    const { createNodeThreadChannelFactory } = await import('../../src/threads/adapters/node.js')
    const { systemScheduler } = await import('@migaia/utils/scheduler')
    const fixture = nativeFixture({
      channelFactory: createNodeThreadChannelFactory({
        scheduler: systemScheduler,
        capabilities: []
      })
    })
    try {
      await expect(fixture.install()).rejects.toMatchObject({
        code: 'PLUGIN_INSTALL_FAILED',
        cause: { code: 'CAPABILITY_CONFLICT' }
      })
      expect(fixture.frames).toHaveLength(0)
      expect(fixture.budget.inUse).toBe(0)
    } finally {
      await fixture.close()
    }
  })
})
