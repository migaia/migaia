import { memoryNotificationsFeature } from '../../src/features/memory-notifications.js'
import { memoryChangeFeedFeature } from '../../src/features/memory-change-feed.js'
import { expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import {
  createStorageHost,
  defineFeature,
  definePlugin,
  memoryBackendKind,
  memoryBackendPlugin
} from '../../src/index.js'

/** The actual Feature borrows the same controlled backend object through its declared lazy port. */
const controllerFeature = defineFeature(memoryBackendKind, ({ featureExpose }) => ({
  capabilities: [],
  chain: {},
  api: {
    store: {
      async controller() {
        return featureExpose.getChangeController()!
      }
    },
    transaction: {}
  }
}))

it('rejects duplicate public ids before either native descriptor or install runs', async () => {
  const firstInstall = vi.fn(() => ({}))
  const secondInstall = vi.fn(() => ({}))
  const firstDescriptor = vi.fn(() => ({ install: firstInstall }))
  const secondDescriptor = vi.fn(() => ({ install: secondInstall }))
  const first = definePlugin('duplicate', firstDescriptor)
  const second = definePlugin('duplicate', secondDescriptor)
  await expect(createStorageHost({ plugins: [first, second] as never })).rejects.toMatchObject({
    code: 'BACKEND_INSTALL_FAILED',
    cause: { code: 'BACKEND_DUPLICATE' }
  })
  expect(firstDescriptor).not.toHaveBeenCalled()
  expect(secondDescriptor).not.toHaveBeenCalled()
  expect(firstInstall).not.toHaveBeenCalled()
  expect(secondInstall).not.toHaveBeenCalled()
  await using host = await createStorageHost({ plugins: [first] })
  await expect(Reflect.apply(host.use, host, [second])).rejects.toMatchObject({
    code: 'BACKEND_INSTALL_FAILED',
    cause: { code: 'PLUGIN_DUPLICATE' }
  })
  expect(secondDescriptor).not.toHaveBeenCalled()
})

it('commits once, reports listener failure, keeps failed writes silent and preserves disposal identity', async () => {
  await using host = await createStorageHost({
    plugins: [
      memoryBackendPlugin(undefined, {
        controller: controllerFeature,
        notifications: memoryNotificationsFeature(),
        changeFeed: memoryChangeFeedFeature()
      })
    ]
  })
  const store = host.backend('memory')
  const controller = await store.api.controller()
  expect(controller.snapshot.backend).toBe('memory')
  const events: unknown[] = []
  const failure = new Error('listener failure')
  const offFailure = controller.subscribe(() => {
    throw failure
  })
  const offObserver = controller.subscribe((event) => events.push(event))
  const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    await store.set('fixture-commit', 'value')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ channel: 'value', kind: 'put', keys: ['fixture-commit'] })
    expect(report).toHaveBeenCalled()
    await expect(store.set('invalid', 42 as never)).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    })
    expect(events).toHaveLength(1)
    expect(await store.get('fixture-commit')).toBe('value')
    const closing = store.dispose()
    expect(store.dispose()).toBe(closing)
    await closing
    expect(() => offFailure()).not.toThrow()
    offObserver()
  } finally {
    report.mockRestore()
  }
})

it('drains an admitted real memory transaction before disposal and publishes no failed draft', async () => {
  await using host = await createStorageHost({
    plugins: [
      memoryBackendPlugin(undefined, {
        controller: controllerFeature,
        notifications: memoryNotificationsFeature(),
        changeFeed: memoryChangeFeedFeature()
      })
    ]
  })
  const store = host.backend('memory')
  const controller = await store.api.controller()
  const events: unknown[] = []
  const stop = controller.subscribe((event) => events.push(event))
  const entered = deferred<void>()
  const ready = deferred<void>()
  const transaction = store.transaction(async (scope) => {
    entered.resolve()
    await ready.promise
    await scope.putRecord({ value: 1 }, 'late-transaction')
  })
  await entered.promise
  const closing = store.dispose()
  expect(store.dispose()).toBe(closing)
  let settled = false
  void closing.then(() => {
    settled = true
  })
  await Promise.resolve()
  expect(settled).toBe(false)
  ready.resolve()
  await expect(transaction).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
  await closing
  expect(events).toHaveLength(0)
  expect(() => stop()).not.toThrow()
})

it('publishes completed transactions and preserves exact multiple-backend publication through teardown', async () => {
  const features = { controller: controllerFeature }
  const host = await createStorageHost({
    plugins: [
      memoryBackendPlugin(
        { id: 'first' },
        {
          ...features,
          notifications: memoryNotificationsFeature(),
          changeFeed: memoryChangeFeedFeature()
        }
      ),
      memoryBackendPlugin(
        { id: 'second' },
        {
          ...features,
          notifications: memoryNotificationsFeature(),
          changeFeed: memoryChangeFeedFeature()
        }
      )
    ]
  })
  const first = host.backend('first')
  const second = host.backend('second')
  const controller = await first.api.controller()
  expect(await second.api.controller()).not.toBe(controller)
  const events: unknown[] = []
  const stop = controller.subscribe((event) => events.push(event))
  await expect(
    first.transaction((scope) => scope.putRecord({ value: 1 }, 'completed'))
  ).resolves.toBe('completed')
  expect(events).toHaveLength(1)
  await expect(
    Reflect.apply(host.use, host, [
      memoryBackendPlugin(
        { id: 'first' },
        {
          notifications: memoryNotificationsFeature(),
          changeFeed: memoryChangeFeedFeature()
        }
      )
    ])
  ).rejects.toMatchObject({ code: 'BACKEND_INSTALL_FAILED', cause: { code: 'BACKEND_DUPLICATE' } })
  expect([...host.backends().keys()]).toEqual(['first', 'second'])
  expect(host.backend('first')).toBe(first)
  expect(host.backend('second')).toBe(second)
  const closing = host.dispose()
  expect(host.dispose()).toBe(closing)
  await closing
  stop()
})
